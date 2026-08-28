// The native half of `node:fs`, for the node-side run only.
import "../internal/bindings.node.mjs";
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
