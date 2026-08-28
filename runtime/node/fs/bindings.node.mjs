// The native half of `node:fs`, for the node-side run only.
import "../internal/bindings.node.mjs";
// The file streams are built on `node:stream`, whose siblings need their
// native halves before this module is evaluated.
import "../stream/bindings.node.mjs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
//
// Each stand-in makes the same libuv call node's own binding makes, through
// node's `fs` — so a disagreement is about our assembly, not about the syscall.
// Errors come back as a negative errno through `nts_errno`, exactly as the C
// reports them, because the TypeScript builds the exception from that number
// and must do it identically both ways.
import fs from "node:fs";
import { Buffer } from "node:buffer";
import { constants as C } from "node:fs";

let errno = 0;
globalThis.nts_errno = () => errno;

/** Node throws; the C returns a negative errno. This is the adapter. */
function attempt(fn, onError) {
  try {
    const value = fn();
    errno = 0;
    return value;
  } catch (e) {
    errno = -(e.errno ?? -1);
    return onError;
  }
}

const statColumns = (s) => [
  s.dev, s.mode, s.nlink, s.uid, s.gid, s.rdev, s.blksize, s.ino, s.size,
  s.blocks, s.atimeMs, s.mtimeMs, s.ctimeMs, s.birthtimeMs,
];

globalThis.nts_fs_stat = (path, follow) =>
  attempt(() => statColumns(follow ? fs.statSync(path) : fs.lstatSync(path)), []);
globalThis.nts_fs_fstat = (fd) => attempt(() => statColumns(fs.fstatSync(fd)), []);

/** A call whose result is a negative errno on failure and 0 on success. */
function status(fn) {
  try {
    fn();
    errno = 0;
    return 0;
  } catch (e) {
    errno = -(e.errno ?? -1);
    return e.errno ?? -1;
  }
}

globalThis.nts_fs_open = (path, flags, mode) => {
  try {
    const fd = fs.openSync(path, flags, mode);
    errno = 0;
    return fd;
  } catch (e) {
    errno = -(e.errno ?? -1);
    return e.errno ?? -1;
  }
};
globalThis.nts_fs_close = (fd) => status(() => fs.closeSync(fd));
globalThis.nts_fs_read_file_utf8 = (path) => attempt(() => fs.readFileSync(path, "utf8"), "");
globalThis.nts_fs_read_file_bytes = (path) => attempt(() => Array.from(fs.readFileSync(path)), []);
const flagName = (flags) => (flags & 0o2000 ? "a" : "w");
globalThis.nts_fs_write_file_utf8 = (path, contents, flags) =>
  status(() => fs.writeFileSync(path, contents, { flag: flagName(flags) }));
globalThis.nts_fs_write_file_bytes = (path, bytes, flags) =>
  status(() => fs.writeFileSync(path, Buffer.from(bytes), { flag: flagName(flags) }));
globalThis.nts_fs_readdir = (path) => attempt(() => fs.readdirSync(path), []);
globalThis.nts_fs_readdir_types = (path) =>
  attempt(
    () =>
      fs.readdirSync(path, { withFileTypes: true }).map((d) =>
        d.isFile() ? 1 : d.isDirectory() ? 2 : d.isSymbolicLink() ? 3
        : d.isFIFO() ? 4 : d.isSocket() ? 5 : d.isCharacterDevice() ? 6
        : d.isBlockDevice() ? 7 : 0,
      ),
    [],
  );
globalThis.nts_fs_unlink = (path) => status(() => fs.unlinkSync(path));
globalThis.nts_fs_mkdir = (path, mode) => status(() => fs.mkdirSync(path, { mode }));
globalThis.nts_fs_rmdir = (path) => status(() => fs.rmdirSync(path));
globalThis.nts_fs_rename = (from, to) => status(() => fs.renameSync(from, to));
globalThis.nts_fs_copyfile = (from, to, flags) => status(() => fs.copyFileSync(from, to, flags));
globalThis.nts_fs_access = (path, mode) => status(() => fs.accessSync(path, mode));
globalThis.nts_fs_chmod = (path, mode) => status(() => fs.chmodSync(path, mode));
globalThis.nts_fs_chown = (path, uid, gid) => status(() => fs.chownSync(path, uid, gid));
globalThis.nts_fs_truncate = (path, length) => status(() => fs.truncateSync(path, length));
globalThis.nts_fs_utimes = (path, atime, mtime) => status(() => fs.utimesSync(path, atime, mtime));
globalThis.nts_fs_link = (from, to) => status(() => fs.linkSync(from, to));
globalThis.nts_fs_symlink = (target, at) => status(() => fs.symlinkSync(target, at));
globalThis.nts_fs_readlink = (path) => attempt(() => fs.readlinkSync(path), "");
globalThis.nts_fs_realpath = (path) => attempt(() => fs.realpathSync(path), "");
globalThis.nts_fs_mkdtemp = (template) => attempt(() => fs.mkdtempSync(template.replace(/X{6}$/, "")), "");


// libuv's wording, for the codes `fs` actually raises. `getSystemErrorMessage`
// is newer than the node this targets, so this is the fallback.
const MESSAGES = {
  "-2": "no such file or directory",
  "-13": "permission denied",
  "-17": "file already exists",
  "-20": "not a directory",
  "-21": "illegal operation on a directory",
  "-22": "invalid argument",
  "-39": "directory not empty",
  "-9": "bad file descriptor",
  "-1": "operation not permitted",
};
function messageFor(code) {
  return MESSAGES[String(code)] ?? "unknown error";
}

// ------------------------------------------------------- the callback surface
//
// Each of these is the same libuv call as its synchronous twin, dispatched to
// the thread pool instead of run on the calling thread. Node's async `fs` is
// what makes that call here, so a disagreement is again about our assembly
// rather than about the syscall.
//
// The seam's convention is `(errno, value)`: zero or a negative libuv code,
// and the result. Node hands back an `Error`; the errno is taken off it, since
// the TypeScript builds the exception and must build it identically whichever
// half produced the failure.

/** Node's error, as the negative errno the seam carries. */
const codeOf = (e) => (typeof e?.errno === "number" ? (e.errno > 0 ? -e.errno : e.errno) : -1);

/** Wrap a node callback so it reports through the seam's convention. */
const relay = (callback, map = (v) => v) => (error, value) => {
  if (error) callback(codeOf(error));
  else callback(0, map(value));
};

globalThis.nts_fs_open_async = (path, flags, mode, cb) =>
  fs.open(path, flags, mode, relay(cb));
globalThis.nts_fs_close_async = (fd, cb) => fs.close(fd, relay(cb));

globalThis.nts_fs_read_async = (fd, bytes, offset, length, position, cb) => {
  const buffer = Buffer.alloc(length);
  fs.read(fd, buffer, 0, length, position < 0 ? null : position, (error, bytesRead) => {
    if (error) cb(codeOf(error), 0, []);
    else cb(0, bytesRead, Array.from(buffer.subarray(0, bytesRead)));
  });
};

globalThis.nts_fs_write_async = (fd, bytes, offset, length, position, cb) => {
  const buffer = Buffer.from(bytes.slice(offset, offset + length));
  fs.write(fd, buffer, 0, length, position < 0 ? null : position, relay(cb));
};

globalThis.nts_fs_read_file_bytes_async = (path, cb) =>
  fs.readFile(path, relay(cb, (b) => Array.from(b)));

globalThis.nts_fs_write_file_bytes_async = (path, bytes, flags, mode, cb) =>
  fs.writeFile(path, Buffer.from(bytes), { flag: flags, mode }, relay(cb));

// `statColumns` is the one defined for the synchronous binding above: the
// column order is a contract with `Stats`, and a second copy could drift.
globalThis.nts_fs_stat_async = (path, follow, cb) =>
  (follow ? fs.stat : fs.lstat)(path, relay(cb, statColumns));
globalThis.nts_fs_fstat_async = (fd, cb) => fs.fstat(fd, relay(cb, statColumns));

globalThis.nts_fs_access_async = (path, mode, cb) => fs.access(path, mode, relay(cb));

globalThis.nts_fs_readdir_async = (path, cb) =>
  fs.readdir(path, { withFileTypes: true }, (error, entries) => {
    if (error) {
      cb(codeOf(error), [], []);
      return;
    }
    // Two columns rather than an array of objects, matching the synchronous
    // binding: the `Dirent`s are assembled on the TypeScript side so the class
    // has one definition.
    cb(0, entries.map((e) => e.name), entries.map((e) => (
      e.isFile() ? 1 : e.isDirectory() ? 2 : e.isSymbolicLink() ? 3 :
      e.isCharacterDevice() ? 4 : e.isBlockDevice() ? 5 :
      e.isFIFO() ? 6 : e.isSocket() ? 7 : 0
    )));
  });

globalThis.nts_fs_mkdir_async = (path, mode, recursive, cb) =>
  fs.mkdir(path, { mode, recursive }, (error, first) => {
    if (error) cb(codeOf(error), "");
    else cb(0, first ?? "");
  });

globalThis.nts_fs_rmdir_async = (path, cb) => fs.rmdir(path, relay(cb));
globalThis.nts_fs_rm_async = (path, recursive, force, cb) =>
  fs.rm(path, { recursive, force }, relay(cb));
globalThis.nts_fs_unlink_async = (path, cb) => fs.unlink(path, relay(cb));
globalThis.nts_fs_rename_async = (from, to, cb) => fs.rename(from, to, relay(cb));
globalThis.nts_fs_copyfile_async = (from, to, flags, cb) =>
  fs.copyFile(from, to, flags, relay(cb));
globalThis.nts_fs_link_async = (from, to, cb) => fs.link(from, to, relay(cb));
globalThis.nts_fs_symlink_async = (target, at, flags, cb) =>
  fs.symlink(target, at, flags === 1 ? "dir" : flags === 2 ? "junction" : null, relay(cb));
globalThis.nts_fs_readlink_async = (path, cb) => fs.readlink(path, relay(cb));
globalThis.nts_fs_realpath_async = (path, cb) => fs.realpath(path, relay(cb));
globalThis.nts_fs_chmod_async = (path, mode, cb) => fs.chmod(path, mode, relay(cb));
globalThis.nts_fs_chown_async = (path, uid, gid, cb) => fs.chown(path, uid, gid, relay(cb));
globalThis.nts_fs_truncate_async = (path, length, cb) => fs.truncate(path, length, relay(cb));
globalThis.nts_fs_ftruncate_async = (fd, length, cb) => fs.ftruncate(fd, length, relay(cb));
globalThis.nts_fs_utimes_async = (path, atime, mtime, cb) =>
  fs.utimes(path, atime, mtime, relay(cb));
globalThis.nts_fs_fsync_async = (fd, cb) => fs.fsync(fd, relay(cb));
globalThis.nts_fs_fdatasync_async = (fd, cb) => fs.fdatasync(fd, relay(cb));
globalThis.nts_fs_mkdtemp_async = (template, cb) =>
  fs.mkdtemp(template.replace(/X{6}$/, ""), relay(cb));
