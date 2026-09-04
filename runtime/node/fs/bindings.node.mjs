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
import os from "node:os";

let errno = 0;
globalThis.nts_errno = () => errno;
globalThis.nts_fs_o_creat = () => C.O_CREAT;
globalThis.nts_fs_o_excl = () => C.O_EXCL;
globalThis.nts_fs_o_trunc = () => C.O_TRUNC;
globalThis.nts_fs_o_append = () => C.O_APPEND;
globalThis.nts_fs_o_sync = () => C.O_SYNC;
globalThis.nts_fs_binding_warns_on_mkdtemp = () => true;
globalThis.nts_fs_eisdir = () => -os.constants.errno.EISDIR;

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

/** A value-producing syscall whose failure result is the negative uv errno. */
function attemptNumber(fn) {
  try {
    const value = fn();
    errno = 0;
    return value;
  } catch (error) {
    const code = typeof error?.errno === "number"
      ? (error.errno > 0 ? -error.errno : error.errno)
      : -1;
    errno = -code;
    return code;
  }
}

// The TypeScript layer has already normalized every timestamp to UNIX
// seconds. Passing a negative number through Node's public fs API would
// normalize it a second time and replace it with `Date.now()`; a Date preserves
// the negative instant and therefore matches the direct libuv C seam.
const dateFromUnixSeconds = (seconds) => new Date(seconds * 1000);

const statColumns = (s) => [
  s.dev, s.mode, s.nlink, s.uid, s.gid, s.rdev, s.blksize, s.ino, s.size,
  s.blocks, s.atimeMs, s.mtimeMs, s.ctimeMs, s.birthtimeMs,
];

const statBigIntColumns = (stats) => [
  stats.dev, stats.mode, stats.nlink, stats.uid, stats.gid, stats.rdev,
  stats.blksize, stats.ino, stats.size, stats.blocks,
  stats.atimeNs, stats.mtimeNs, stats.ctimeNs, stats.birthtimeNs,
].map((value) => value.toString());

const statFsColumns = (stats) => [
  stats.type, stats.bsize, stats.frsize, stats.blocks,
  stats.bfree, stats.bavail, stats.files, stats.ffree,
];

const statFsBigIntColumns = (stats) => statFsColumns(stats).map((value) => value.toString());

function direntType(entry) {
  if (entry.isFile()) return 1;
  if (entry.isDirectory()) return 2;
  if (entry.isSymbolicLink()) return 3;
  if (entry.isFIFO()) return 4;
  if (entry.isSocket()) return 5;
  if (entry.isCharacterDevice()) return 6;
  if (entry.isBlockDevice()) return 7;
  return 0;
}

function scandirRow(entry) {
  const name = Buffer.isBuffer(entry.name) ? entry.name : Buffer.from(entry.name);
  return [direntType(entry), ...name];
}

function scandirSync(path) {
  return attempt(
    () => fs.readdirSync(path, { encoding: "buffer", withFileTypes: true }).map(scandirRow),
    [],
  );
}

function scandir(path, callback) {
  fs.readdir(path, { encoding: "buffer", withFileTypes: true }, (error, entries) => {
    if (error) callback(codeOf(error), []);
    else callback(0, entries.map(scandirRow));
  });
}

let nextDirectoryIdentifier = 1;
const directories = new Map();

function registerDirectory(directory) {
  const identifier = nextDirectoryIdentifier++;
  directories.set(identifier, directory);
  return identifier;
}

function readDirectorySync(identifier, bufferSize) {
  return attempt(() => {
    const directory = directories.get(identifier);
    if (directory === undefined) {
      const error = new Error("Directory handle was closed");
      error.errno = -9;
      throw error;
    }
    const rows = [];
    for (let index = 0; index < bufferSize; index++) {
      const entry = directory.readSync();
      if (entry === null) break;
      rows.push(scandirRow(entry));
    }
    return rows;
  }, []);
}

function closeDirectorySync(identifier) {
  return status(() => {
    const directory = directories.get(identifier);
    if (directory === undefined) {
      const error = new Error("Directory handle was closed");
      error.errno = -9;
      throw error;
    }
    directory.closeSync();
    directories.delete(identifier);
  });
}

globalThis.nts_fs_stat = (path, follow) =>
  attempt(() => statColumns(follow ? fs.statSync(path) : fs.lstatSync(path)), []);
globalThis.nts_fs_stat_bytes = (path, follow) =>
  globalThis.nts_fs_stat(Buffer.from(path), follow);
globalThis.nts_fs_stat_bigint = (path, follow) =>
  attempt(
    () => statBigIntColumns(
      follow
        ? fs.statSync(path, { bigint: true })
        : fs.lstatSync(path, { bigint: true }),
    ),
    [],
  );
globalThis.nts_fs_stat_bigint_bytes = (path, follow) =>
  globalThis.nts_fs_stat_bigint(Buffer.from(path), follow);
globalThis.nts_fs_fstat = (fd) => attempt(() => statColumns(fs.fstatSync(fd)), []);
globalThis.nts_fs_fstat_bigint = (fd) =>
  attempt(() => statBigIntColumns(fs.fstatSync(fd, { bigint: true })), []);
globalThis.nts_fs_statfs = (path) =>
  attempt(() => statFsColumns(fs.statfsSync(path)), []);
globalThis.nts_fs_statfs_bytes = (path) =>
  globalThis.nts_fs_statfs(Buffer.from(path));
globalThis.nts_fs_statfs_bigint = (path) =>
  attempt(() => statFsBigIntColumns(fs.statfsSync(path, { bigint: true })), []);
globalThis.nts_fs_statfs_bigint_bytes = (path) =>
  globalThis.nts_fs_statfs_bigint(Buffer.from(path));

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
globalThis.nts_fs_open_bytes = (path, flags, mode) =>
  globalThis.nts_fs_open(Buffer.from(path), flags, mode);
globalThis.nts_fs_close = (fd) => status(() => fs.closeSync(fd));
globalThis.nts_fs_read_file_bytes_fd = (fd) =>
  attempt(() => Array.from(fs.readFileSync(fd)), []);
globalThis.nts_fs_write_file_utf8 = (path, contents, flags, mode, flush) =>
  status(() => fs.writeFileSync(path, contents, { flag: flags, mode, flush }));
globalThis.nts_fs_write_file_bytes = (path, bytes, flags, mode, flush) =>
  status(() => fs.writeFileSync(path, Buffer.from(bytes), { flag: flags, mode, flush }));
globalThis.nts_fs_write_file_bytes_fd = (fd, bytes, flush) =>
  status(() => fs.writeFileSync(fd, Buffer.from(bytes), { flush }));
globalThis.nts_fs_scandir = scandirSync;
globalThis.nts_fs_scandir_bytes = (path) => scandirSync(Buffer.from(path));
globalThis.nts_fs_opendir = (path) =>
  attempt(
    () => registerDirectory(fs.opendirSync(path, { encoding: "buffer" })),
    0,
  );
globalThis.nts_fs_opendir_bytes = (path) =>
  globalThis.nts_fs_opendir(Buffer.from(path));
globalThis.nts_fs_dir_read = readDirectorySync;
globalThis.nts_fs_dir_close = closeDirectorySync;
globalThis.nts_fs_unlink = (path) => status(() => fs.unlinkSync(path));
globalThis.nts_fs_mkdir = (path, mode) => status(() => fs.mkdirSync(path, { mode }));
globalThis.nts_fs_rmdir = (path) => status(() => fs.rmdirSync(path));
globalThis.nts_fs_rename = (from, to) => status(() => fs.renameSync(from, to));
globalThis.nts_fs_copyfile = (from, to, flags) => status(() => fs.copyFileSync(from, to, flags));
globalThis.nts_fs_access = (path, mode) => status(() => fs.accessSync(path, mode));
globalThis.nts_fs_access_bytes = (path, mode) =>
  status(() => fs.accessSync(Buffer.from(path), mode));
globalThis.nts_fs_chmod = (path, mode) => status(() => fs.chmodSync(path, mode));
globalThis.nts_fs_chown = (path, uid, gid) => status(() => fs.chownSync(path, uid, gid));
globalThis.nts_fs_lchown = (path, uid, gid) => status(() => fs.lchownSync(path, uid, gid));
globalThis.nts_fs_lchown_bytes = (path, uid, gid) =>
  status(() => fs.lchownSync(Buffer.from(path), uid, gid));
globalThis.nts_fs_utimes = (path, atime, mtime) =>
  status(() => fs.utimesSync(path, dateFromUnixSeconds(atime), dateFromUnixSeconds(mtime)));
globalThis.nts_fs_link = (from, to) => status(() => fs.linkSync(from, to));
globalThis.nts_fs_symlink = (target, at) => status(() => fs.symlinkSync(target, at));
globalThis.nts_fs_symlink_bytes = (target, at, flags) =>
  status(() =>
    fs.symlinkSync(
      Buffer.from(target),
      Buffer.from(at),
      flags === 1 ? "dir" : flags === 2 ? "junction" : "file",
    ));
globalThis.nts_fs_readlink = (path) => attempt(() => fs.readlinkSync(path), "");
globalThis.nts_fs_realpath = (path) => attempt(() => fs.realpathSync(path), "");
globalThis.nts_fs_realpath_bytes = (path) =>
  attempt(
    () => Array.from(fs.realpathSync(Buffer.from(path), { encoding: "buffer" })),
    [],
  );
globalThis.nts_fs_mkdtemp = (template) => attempt(() => fs.mkdtempSync(template.replace(/X{6}$/, "")), "");
globalThis.nts_fs_mkdtemp_bytes = (template) =>
  attempt(
    () => Array.from(fs.mkdtempSync(Buffer.from(template.slice(0, -6)), {
      encoding: "buffer",
    })),
    [],
  );


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
globalThis.nts_fs_open_bytes_async = (path, flags, mode, cb) =>
  fs.open(Buffer.from(path), flags, mode, relay(cb));
globalThis.nts_fs_close_async = (fd, cb) => fs.close(fd, relay(cb));

globalThis.nts_fs_read_async = (fd, length, position, cb) => {
  const buffer = Buffer.alloc(length);
  fs.read(fd, buffer, 0, length, position < 0 ? null : position, (error, bytesRead) => {
    if (error) cb(codeOf(error), 0, []);
    else cb(0, bytesRead, Array.from(buffer.subarray(0, bytesRead)));
  });
};

globalThis.nts_fs_read_bigint_async = (fd, length, position, cb) => {
  const buffer = Buffer.alloc(length);
  fs.read(fd, buffer, 0, length, position < 0n ? null : position, (error, bytesRead) => {
    if (error) cb(codeOf(error), 0, []);
    else cb(0, bytesRead, Array.from(buffer.subarray(0, bytesRead)));
  });
};

globalThis.nts_fs_readv_async = (fd, lengths, position, cb) => {
  const buffers = lengths.map((length) => Buffer.alloc(length));
  fs.readv(fd, buffers, position < 0 ? null : position, (error, bytesRead) => {
    if (error) cb(codeOf(error), 0, []);
    else cb(0, bytesRead, Array.from(Buffer.concat(buffers).subarray(0, bytesRead)));
  });
};

globalThis.nts_fs_write_async = (fd, bytes, position, cb) => {
  const buffer = Buffer.from(bytes);
  fs.write(fd, buffer, 0, buffer.length, position < 0 ? null : position, relay(cb));
};

globalThis.nts_fs_writev_async = (fd, bytes, lengths, position, cb) => {
  let offset = 0;
  const buffers = lengths.map((length) => {
    const buffer = Buffer.from(bytes.slice(offset, offset + length));
    offset += length;
    return buffer;
  });
  fs.writev(fd, buffers, position < 0 ? null : position, relay(cb));
};

// `statColumns` is the one defined for the synchronous binding above: the
// column order is a contract with `Stats`, and a second copy could drift.
globalThis.nts_fs_stat_async = (path, follow, cb) =>
  (follow ? fs.stat : fs.lstat)(path, relay(cb, statColumns));
globalThis.nts_fs_stat_bytes_async = (path, follow, cb) =>
  (follow ? fs.stat : fs.lstat)(Buffer.from(path), relay(cb, statColumns));
globalThis.nts_fs_stat_bigint_async = (path, follow, cb) =>
  (follow ? fs.stat : fs.lstat)(
    path,
    { bigint: true },
    relay(cb, statBigIntColumns),
  );
globalThis.nts_fs_stat_bigint_bytes_async = (path, follow, cb) =>
  (follow ? fs.stat : fs.lstat)(
    Buffer.from(path),
    { bigint: true },
    relay(cb, statBigIntColumns),
  );
globalThis.nts_fs_fstat_async = (fd, cb) => {
  // The real seam calls libuv directly, where a closed FileHandle's sentinel
  // descriptor produces UV_EBADF. Node's public fs.fstat wrapper rejects -1
  // before libuv, so it cannot stand in for this one case.
  if (fd < 0) {
    process.nextTick(cb, -9, []);
    return;
  }
  fs.fstat(fd, relay(cb, statColumns));
};
globalThis.nts_fs_fstat_bigint_async = (fd, cb) => {
  if (fd < 0) {
    process.nextTick(cb, -9, []);
    return;
  }
  fs.fstat(fd, { bigint: true }, relay(cb, statBigIntColumns));
};
globalThis.nts_fs_statfs_async = (path, cb) =>
  fs.statfs(path, relay(cb, statFsColumns));
globalThis.nts_fs_statfs_bytes_async = (path, cb) =>
  fs.statfs(Buffer.from(path), relay(cb, statFsColumns));
globalThis.nts_fs_statfs_bigint_async = (path, cb) =>
  fs.statfs(path, { bigint: true }, relay(cb, statFsBigIntColumns));
globalThis.nts_fs_statfs_bigint_bytes_async = (path, cb) =>
  fs.statfs(Buffer.from(path), { bigint: true }, relay(cb, statFsBigIntColumns));

globalThis.nts_fs_access_async = (path, mode, cb) => fs.access(path, mode, relay(cb));
globalThis.nts_fs_access_bytes_async = (path, mode, cb) =>
  fs.access(Buffer.from(path), mode, relay(cb));

globalThis.nts_fs_scandir_async = scandir;
globalThis.nts_fs_scandir_bytes_async = (path, cb) => scandir(Buffer.from(path), cb);

globalThis.nts_fs_opendir_async = (path, cb) => {
  fs.opendir(path, { encoding: "buffer" }, (error, directory) => {
    if (error) cb(codeOf(error), 0);
    else cb(0, registerDirectory(directory));
  });
};
globalThis.nts_fs_opendir_bytes_async = (path, cb) =>
  globalThis.nts_fs_opendir_async(Buffer.from(path), cb);
globalThis.nts_fs_dir_read_async = (identifier, bufferSize, cb) => {
  const directory = directories.get(identifier);
  if (directory === undefined) {
    process.nextTick(cb, -9, []);
    return;
  }
  const rows = [];
  const readNext = () => {
    if (rows.length === bufferSize) {
      cb(0, rows);
      return;
    }
    directory.read((error, entry) => {
      if (error) cb(codeOf(error), []);
      else if (entry === null) cb(0, rows);
      else {
        rows.push(scandirRow(entry));
        readNext();
      }
    });
  };
  readNext();
};
globalThis.nts_fs_dir_close_async = (identifier, cb) => {
  const directory = directories.get(identifier);
  if (directory === undefined) {
    process.nextTick(cb, -9);
    return;
  }
  directory.close((error) => {
    if (error) cb(codeOf(error));
    else {
      directories.delete(identifier);
      cb(0);
    }
  });
};

globalThis.nts_fs_mkdir_async = (path, mode, recursive, cb) =>
  fs.mkdir(path, { mode, recursive }, (error, first) => {
    if (error) cb(codeOf(error), "");
    else cb(0, first ?? "");
  });

globalThis.nts_fs_rmdir_async = (path, cb) => fs.rmdir(path, relay(cb));
globalThis.nts_fs_rm_async = (
  path,
  recursive,
  force,
  maxRetries,
  retryDelay,
  cb,
) => fs.rm(path, { recursive, force, maxRetries, retryDelay }, relay(cb));
globalThis.nts_fs_unlink_async = (path, cb) => fs.unlink(path, relay(cb));
globalThis.nts_fs_rename_async = (from, to, cb) => fs.rename(from, to, relay(cb));
globalThis.nts_fs_copyfile_async = (from, to, flags, cb) =>
  fs.copyFile(from, to, flags, relay(cb));
globalThis.nts_fs_link_async = (from, to, cb) => fs.link(from, to, relay(cb));
globalThis.nts_fs_symlink_async = (target, at, flags, cb) =>
  fs.symlink(target, at, flags === 1 ? "dir" : flags === 2 ? "junction" : null, relay(cb));
globalThis.nts_fs_symlink_bytes_async = (target, at, flags, cb) =>
  fs.symlink(
    Buffer.from(target),
    Buffer.from(at),
    flags === 1 ? "dir" : flags === 2 ? "junction" : "file",
    relay(cb),
  );
globalThis.nts_fs_readlink_async = (path, cb) => fs.readlink(path, relay(cb));
globalThis.nts_fs_realpath_async = (path, cb) => fs.realpath(path, relay(cb));
globalThis.nts_fs_realpath_bytes_async = (path, cb) =>
  fs.realpath(
    Buffer.from(path),
    { encoding: "buffer" },
    relay(cb, (resolved) => Array.from(resolved)),
  );
globalThis.nts_fs_chmod_async = (path, mode, cb) => fs.chmod(path, mode, relay(cb));
globalThis.nts_fs_chown_async = (path, uid, gid, cb) => fs.chown(path, uid, gid, relay(cb));
globalThis.nts_fs_lchown_async = (path, uid, gid, cb) =>
  fs.lchown(path, uid, gid, relay(cb));
globalThis.nts_fs_lchown_bytes_async = (path, uid, gid, cb) =>
  fs.lchown(Buffer.from(path), uid, gid, relay(cb));
globalThis.nts_fs_ftruncate_async = (fd, length, cb) => fs.ftruncate(fd, length, relay(cb));
globalThis.nts_fs_utimes_async = (path, atime, mtime, cb) =>
  fs.utimes(path, dateFromUnixSeconds(atime), dateFromUnixSeconds(mtime), relay(cb));
globalThis.nts_fs_lutimes_async = (path, atime, mtime, cb) =>
  fs.lutimes(path, dateFromUnixSeconds(atime), dateFromUnixSeconds(mtime), relay(cb));
globalThis.nts_fs_fsync_async = (fd, cb) => fs.fsync(fd, relay(cb));
globalThis.nts_fs_fdatasync_async = (fd, cb) => fs.fdatasync(fd, relay(cb));
globalThis.nts_fs_mkdtemp_async = (template, cb) =>
  fs.mkdtemp(template.replace(/X{6}$/, ""), relay(cb));
globalThis.nts_fs_mkdtemp_bytes_async = (template, cb) =>
  fs.mkdtemp(
    Buffer.from(template.slice(0, -6)),
    { encoding: "buffer" },
    relay(cb, (path) => Array.from(path)),
  );

// The synchronous descriptor operations. `read` returns just the bytes it got
// rather than filling a buffer across the seam: a short read is normal, and
// the length of what comes back is the answer.
globalThis.nts_fs_read = (fd, length, position) => {
  const buffer = Buffer.alloc(length);
  const read = attempt(
    () => fs.readSync(fd, buffer, 0, length, position < 0 ? null : position),
    -1,
  );
  return read < 0 ? [] : Array.from(buffer.subarray(0, read));
};

globalThis.nts_fs_read_bigint = (fd, length, position) => {
  const buffer = Buffer.alloc(length);
  const read = attempt(
    () => fs.readSync(fd, buffer, 0, length, position < 0n ? null : position),
    -1,
  );
  return read < 0 ? [] : Array.from(buffer.subarray(0, read));
};

globalThis.nts_fs_readv = (fd, lengths, position) => {
  const buffers = lengths.map((length) => Buffer.alloc(length));
  const read = attempt(
    () => fs.readvSync(fd, buffers, position < 0 ? null : position),
    -1,
  );
  return read < 0
    ? []
    : Array.from(Buffer.concat(buffers).subarray(0, read));
};

globalThis.nts_fs_write = (fd, bytes, position) =>
  attemptNumber(
    () => fs.writeSync(fd, Buffer.from(bytes), 0, bytes.length, position < 0 ? null : position),
  );

globalThis.nts_fs_writev = (fd, bytes, lengths, position) => {
  let offset = 0;
  const buffers = lengths.map((length) => {
    const buffer = Buffer.from(bytes.slice(offset, offset + length));
    offset += length;
    return buffer;
  });
  return attemptNumber(
    () => fs.writevSync(fd, buffers, position < 0 ? null : position),
  );
};

globalThis.nts_fs_fsync = (fd) => status(() => fs.fsyncSync(fd));
globalThis.nts_fs_fdatasync = (fd) => status(() => fs.fdatasyncSync(fd));
globalThis.nts_fs_ftruncate = (fd, length) => status(() => fs.ftruncateSync(fd, length));
globalThis.nts_fs_fchmod = (fd, mode) => status(() => fs.fchmodSync(fd, mode));
globalThis.nts_fs_fchown = (fd, uid, gid) => status(() => fs.fchownSync(fd, uid, gid));
globalThis.nts_fs_futimes = (fd, atime, mtime) =>
  status(() => fs.futimesSync(fd, dateFromUnixSeconds(atime), dateFromUnixSeconds(mtime)));
globalThis.nts_fs_lutimes = (path, atime, mtime) =>
  status(() => fs.lutimesSync(path, dateFromUnixSeconds(atime), dateFromUnixSeconds(mtime)));

globalThis.nts_fs_fchmod_async = (fd, mode, cb) => fs.fchmod(fd, mode, relay(cb));
globalThis.nts_fs_fchown_async = (fd, uid, gid, cb) => fs.fchown(fd, uid, gid, relay(cb));
globalThis.nts_fs_futimes_async = (fd, atime, mtime, cb) =>
  fs.futimes(fd, dateFromUnixSeconds(atime), dateFromUnixSeconds(mtime), relay(cb));

// The watchers. Node's own `fs.watch` and `fs.watchFile` are the loop's
// file-watching handles here; the handle is a number across the seam because
// that is what the C side has.
let nextWatchHandle = 1;
const watchers = new Map();

globalThis.nts_fs_watch_start = (
  path,
  recursive,
  persistent,
  throwIfNoEntry,
  cb,
) => {
  try {
    const w = fs.watch(
      path,
      { recursive, persistent, throwIfNoEntry, encoding: "buffer" },
      (event, filename) => {
        if (filename === null) {
          cb(event, null);
          return;
        }
        // Node's recursive Linux watcher currently reports a string even when
        // `encoding: "buffer"` was requested. The native seam is byte-oriented,
        // so normalize that host inconsistency here just as the real C binding
        // does before TypeScript applies the caller's requested encoding.
        const bytes = typeof filename === "string" ? Buffer.from(filename) : filename;
        cb(event, Array.from(bytes));
      },
    );
    const handle = nextWatchHandle++;
    watchers.set(handle, w);
    return handle;
  } catch (e) {
    return codeOf(e);
  }
};
globalThis.nts_fs_watch_stop = (handle) => {
  watchers.get(handle)?.close();
  watchers.delete(handle);
};
globalThis.nts_fs_watch_ref = (handle) => watchers.get(handle)?.ref();
globalThis.nts_fs_watch_unref = (handle) => watchers.get(handle)?.unref();

globalThis.nts_fs_watchfile_start = (path, interval, persistent, cb) => {
  const listener = (current, previous) => cb(statColumns(current), statColumns(previous));
  const handle = nextWatchHandle++;
  const watcher = fs.watchFile(path, { interval, persistent }, listener);
  watchers.set(handle, { path, listener, watcher });
  return handle;
};
globalThis.nts_fs_watchfile_stop = (handle) => {
  const entry = watchers.get(handle);
  if (entry) fs.unwatchFile(entry.path, entry.listener);
  watchers.delete(handle);
};
globalThis.nts_fs_watchfile_ref = (handle) => watchers.get(handle)?.watcher.ref();
globalThis.nts_fs_watchfile_unref = (handle) => watchers.get(handle)?.watcher.unref();
