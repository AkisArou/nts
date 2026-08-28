// `node:fs`, callback surface, from node v24.20.0 `lib/fs.js`.
//
// Every function here is the corresponding `*Sync` operation handed to the
// event loop's thread pool instead of run on the calling thread. That is the
// entire difference, and it is why the two sets share their argument handling
// and their errors: the work is the same system call, and only the answer's
// route back differs.
//
// One binding per operation, mirroring `uv_fs_*`. A single generic dispatch
// would be less code and would have to name operations with strings, which
// moves an error the compiler could catch to a place where it becomes "no such
// operation" at run time.
//
// The callback convention across the seam is `(errno, value)`: zero or a
// negative libuv code, and whatever the operation produced. Not node's
// `(error, value)`, because building an `Error` is this side's job -- the C
// side has an integer and no idea what syscall name or path to put in it.

import { validateFunction, validateString } from "../../internal/validators.ts";
import { uvException } from "../../internal/uv.ts";
import { Buffer } from "../../buffer/src/main.ts";
import { Dirent, Stats } from "./stats.ts";
import { getOptions, type FileOptions } from "./options.ts";
import { flagsOf } from "./main.ts";

declare function nts_fs_open_async(
  path: string, flags: number, mode: number, callback: (errno: number, fd: number) => void,
): void;
declare function nts_fs_close_async(
  fd: number, callback: (errno: number) => void,
): void;
declare function nts_fs_read_async(
  fd: number, buffer: number[], offset: number, length: number, position: number,
  callback: (errno: number, bytesRead: number, bytes: number[]) => void,
): void;
declare function nts_fs_write_async(
  fd: number, bytes: number[], offset: number, length: number, position: number,
  callback: (errno: number, written: number) => void,
): void;
declare function nts_fs_read_file_bytes_async(
  path: string, callback: (errno: number, bytes: number[]) => void,
): void;
declare function nts_fs_write_file_bytes_async(
  path: string, bytes: number[], flags: number, mode: number,
  callback: (errno: number) => void,
): void;
declare function nts_fs_stat_async(
  path: string, follow: boolean, callback: (errno: number, columns: number[]) => void,
): void;
declare function nts_fs_fstat_async(
  fd: number, callback: (errno: number, columns: number[]) => void,
): void;
declare function nts_fs_access_async(
  path: string, mode: number, callback: (errno: number) => void,
): void;
declare function nts_fs_readdir_async(
  path: string, callback: (errno: number, names: string[], types: number[]) => void,
): void;
declare function nts_fs_mkdir_async(
  path: string, mode: number, recursive: boolean, callback: (errno: number, first: string) => void,
): void;
declare function nts_fs_rmdir_async(path: string, callback: (errno: number) => void): void;
declare function nts_fs_rm_async(
  path: string, recursive: boolean, force: boolean, callback: (errno: number) => void,
): void;
declare function nts_fs_unlink_async(path: string, callback: (errno: number) => void): void;
declare function nts_fs_rename_async(
  from: string, to: string, callback: (errno: number) => void,
): void;
declare function nts_fs_copyfile_async(
  from: string, to: string, flags: number, callback: (errno: number) => void,
): void;
declare function nts_fs_link_async(
  from: string, to: string, callback: (errno: number) => void,
): void;
declare function nts_fs_symlink_async(
  target: string, at: string, flags: number, callback: (errno: number) => void,
): void;
declare function nts_fs_readlink_async(
  path: string, callback: (errno: number, target: string) => void,
): void;
declare function nts_fs_realpath_async(
  path: string, callback: (errno: number, resolved: string) => void,
): void;
declare function nts_fs_chmod_async(
  path: string, mode: number, callback: (errno: number) => void,
): void;
declare function nts_fs_chown_async(
  path: string, uid: number, gid: number, callback: (errno: number) => void,
): void;
declare function nts_fs_truncate_async(
  path: string, length: number, callback: (errno: number) => void,
): void;
declare function nts_fs_ftruncate_async(
  fd: number, length: number, callback: (errno: number) => void,
): void;
declare function nts_fs_utimes_async(
  path: string, atime: number, mtime: number, callback: (errno: number) => void,
): void;
declare function nts_fs_fsync_async(fd: number, callback: (errno: number) => void): void;
declare function nts_fs_fdatasync_async(fd: number, callback: (errno: number) => void): void;
declare function nts_fs_fchmod_async(
  fd: number, mode: number, callback: (errno: number) => void,
): void;
declare function nts_fs_fchown_async(
  fd: number, uid: number, gid: number, callback: (errno: number) => void,
): void;
declare function nts_fs_futimes_async(
  fd: number, atime: number, mtime: number, callback: (errno: number) => void,
): void;
declare function nts_fs_mkdtemp_async(
  template: string, callback: (errno: number, path: string) => void,
): void;

export type Callback<T = void> = (error: unknown, value?: T) => void;

/**
 * Turn the seam's `(errno, value)` into node's `(error, value)`.
 *
 * The syscall name and path are closed over here rather than sent across,
 * because they are only needed to build the message and sending them would
 * mean marshalling two strings on every successful call as well.
 */
function settle<T>(
  callback: Callback<T>,
  syscall: string,
  path?: string,
  dest?: string,
): (errno: number, value?: T) => void {
  return (errno: number, value?: T) => {
    if (errno < 0) callback(uvException(errno, syscall, path, dest));
    else callback(null, value as T);
  };
}

/** The last argument, checked to be a callback, as node checks it. */
function requireCallback(callback: unknown): void {
  validateFunction(callback, "cb");
}

export function open(
  path: string,
  flags?: string | number | Callback<number>,
  mode?: number | Callback<number>,
  callback?: Callback<number>,
): void {
  // `open(path, cb)`, `open(path, flags, cb)`, `open(path, flags, mode, cb)`.
  if (typeof flags === "function") {
    callback = flags;
    flags = "r";
    mode = 0o666;
  } else if (typeof mode === "function") {
    callback = mode;
    mode = 0o666;
  }
  validateString(path, "path");
  requireCallback(callback);
  nts_fs_open_async(
    path,
    flagsOf((flags as string | number | undefined) ?? "r"),
    (mode as number) ?? 0o666,
    settle(callback as Callback<number>, "open", path),
  );
}

export function close(fd: number, callback?: Callback): void {
  requireCallback(callback);
  nts_fs_close_async(fd, settle(callback as Callback, "close"));
}

export function read(
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number | null,
  callback: (error: unknown, bytesRead?: number, buffer?: Buffer) => void,
): void {
  requireCallback(callback);
  nts_fs_read_async(
    fd,
    Array.from(buffer) as number[],
    offset,
    length,
    position ?? -1,
    (errno: number, bytesRead: number, bytes: number[]) => {
      if (errno < 0) {
        callback(uvException(errno, "read"));
        return;
      }
      // Copied back into the caller's buffer: the contract is that the buffer
      // they passed is the one that was filled, and a caller holding a
      // subarray of a larger allocation depends on that.
      for (let i = 0; i < bytesRead; i++) buffer[offset + i] = bytes[i] as number;
      callback(null, bytesRead, buffer);
    },
  );
}

export function write(
  fd: number,
  buffer: Buffer,
  offset: number,
  length: number,
  position: number | null,
  callback: (error: unknown, written?: number, buffer?: Buffer) => void,
): void {
  requireCallback(callback);
  nts_fs_write_async(
    fd,
    Array.from(buffer) as number[],
    offset,
    length,
    position ?? -1,
    (errno: number, written: number) => {
      if (errno < 0) callback(uvException(errno, "write"));
      else callback(null, written, buffer);
    },
  );
}

export function readFile(
  path: string,
  options: FileOptions | Callback<string | Buffer>,
  callback?: Callback<string | Buffer>,
): void {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  validateString(path, "path");
  requireCallback(callback);
  const { encoding } = getOptions(options);

  nts_fs_read_file_bytes_async(path, (errno: number, bytes: number[]) => {
    if (errno < 0) {
      (callback as Callback<string | Buffer>)(uvException(errno, "open", path));
      return;
    }
    const buffer = Buffer.from(bytes);
    (callback as Callback<string | Buffer>)(
      null,
      encoding ? buffer.toString(encoding) : buffer,
    );
  });
}

export function writeFile(
  path: string,
  data: string | Buffer,
  options: FileOptions | Callback,
  callback?: Callback,
): void {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  validateString(path, "path");
  requireCallback(callback);
  const { encoding, mode, flag } = getOptions(options);
  const bytes = typeof data === "string"
    ? Array.from(Buffer.from(data, encoding ?? "utf8"))
    : Array.from(data);

  nts_fs_write_file_bytes_async(
    path,
    bytes as number[],
    flagsOf(flag ?? "w"),
    mode ?? 0o666,
    settle(callback as Callback, "open", path),
  );
}

export function appendFile(
  path: string,
  data: string | Buffer,
  options: FileOptions | Callback,
  callback?: Callback,
): void {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  // Appending is writing with a different flag, and saying so keeps one
  // implementation rather than two that must agree about encodings.
  writeFile(path, data, { flag: "a", ...(options as FileOptions) }, callback as Callback);
}

function statLike(follow: boolean, syscall: string) {
  return function statAsync(path: string, callback?: Callback<Stats>): void {
    validateString(path, "path");
    requireCallback(callback);
    nts_fs_stat_async(path, follow, (errno: number, columns: number[]) => {
      if (errno < 0) (callback as Callback<Stats>)(uvException(errno, syscall, path));
      else (callback as Callback<Stats>)(null, new Stats(columns));
    });
  };
}

export const stat = statLike(true, "stat");
export const lstat = statLike(false, "lstat");

export function fstat(fd: number, callback?: Callback<Stats>): void {
  requireCallback(callback);
  nts_fs_fstat_async(fd, (errno: number, columns: number[]) => {
    if (errno < 0) (callback as Callback<Stats>)(uvException(errno, "fstat"));
    else (callback as Callback<Stats>)(null, new Stats(columns));
  });
}

export function access(
  path: string,
  mode: number | Callback,
  callback?: Callback,
): void {
  if (typeof mode === "function") {
    callback = mode;
    mode = 0;
  }
  validateString(path, "path");
  requireCallback(callback);
  nts_fs_access_async(path, mode as number, settle(callback as Callback, "access", path));
}

/**
 * `fs.exists`, which is deprecated and whose callback takes no error.
 *
 * Kept because programs call it. The reason it is deprecated is worth knowing:
 * a positive answer is out of date by the time the caller acts on it, so the
 * only correct use is to open the file and handle the failure.
 */
export function exists(path: string, callback: (exists: boolean) => void): void {
  access(path, 0, (error) => callback(!error));
}

export function readdir(
  path: string,
  options: { withFileTypes?: boolean; encoding?: string } | Callback<string[] | Dirent[]>,
  callback?: Callback<string[] | Dirent[]>,
): void {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  validateString(path, "path");
  requireCallback(callback);
  const withFileTypes = Boolean((options as { withFileTypes?: boolean }).withFileTypes);

  nts_fs_readdir_async(path, (errno: number, names: string[], types: number[]) => {
    if (errno < 0) {
      (callback as Callback<string[]>)(uvException(errno, "scandir", path));
      return;
    }
    if (!withFileTypes) {
      (callback as Callback<string[]>)(null, names);
      return;
    }
    const entries: Dirent[] = [];
    for (let i = 0; i < names.length; i++) {
      entries.push(new Dirent(names[i] as string, types[i] as number, path));
    }
    (callback as Callback<Dirent[]>)(null, entries);
  });
}

export function mkdir(
  path: string,
  options: number | { recursive?: boolean; mode?: number } | Callback<string | undefined>,
  callback?: Callback<string | undefined>,
): void {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  validateString(path, "path");
  requireCallback(callback);

  const recursive = typeof options === "object" && Boolean(options.recursive);
  const mode = typeof options === "number"
    ? options
    : ((options as { mode?: number }).mode ?? 0o777);

  nts_fs_mkdir_async(path, mode, recursive, (errno: number, first: string) => {
    if (errno < 0) {
      (callback as Callback<string>)(uvException(errno, "mkdir", path));
    } else {
      // Recursive `mkdir` reports the *first* directory it had to create, so
      // a caller can undo exactly what it did.
      (callback as Callback<string | undefined>)(null, recursive ? (first || undefined) : undefined);
    }
  });
}

export function rmdir(path: string, callback?: Callback): void {
  validateString(path, "path");
  requireCallback(callback);
  nts_fs_rmdir_async(path, settle(callback as Callback, "rmdir", path));
}

export function rm(
  path: string,
  options: { recursive?: boolean; force?: boolean } | Callback,
  callback?: Callback,
): void {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  validateString(path, "path");
  requireCallback(callback);
  const { recursive = false, force = false } = options as { recursive?: boolean; force?: boolean };
  nts_fs_rm_async(path, recursive, force, settle(callback as Callback, "rm", path));
}

export function unlink(path: string, callback?: Callback): void {
  validateString(path, "path");
  requireCallback(callback);
  nts_fs_unlink_async(path, settle(callback as Callback, "unlink", path));
}

export function rename(from: string, to: string, callback?: Callback): void {
  validateString(from, "oldPath");
  validateString(to, "newPath");
  requireCallback(callback);
  nts_fs_rename_async(from, to, settle(callback as Callback, "rename", from, to));
}

export function copyFile(
  from: string,
  to: string,
  flags: number | Callback,
  callback?: Callback,
): void {
  if (typeof flags === "function") {
    callback = flags;
    flags = 0;
  }
  validateString(from, "src");
  validateString(to, "dest");
  requireCallback(callback);
  nts_fs_copyfile_async(from, to, flags as number, settle(callback as Callback, "copyfile", from, to));
}

export function link(from: string, to: string, callback?: Callback): void {
  validateString(from, "existingPath");
  validateString(to, "newPath");
  requireCallback(callback);
  nts_fs_link_async(from, to, settle(callback as Callback, "link", from, to));
}

export function symlink(
  target: string,
  at: string,
  type: string | Callback | null,
  callback?: Callback,
): void {
  if (typeof type === "function") {
    callback = type;
    type = null;
  }
  validateString(target, "target");
  validateString(at, "path");
  requireCallback(callback);
  // The type only means anything on Windows, where a link to a directory and
  // a link to a file are different objects.
  const flags = type === "dir" ? 1 : type === "junction" ? 2 : 0;
  nts_fs_symlink_async(target, at, flags, settle(callback as Callback, "symlink", target, at));
}

export function readlink(path: string, callback?: Callback<string>): void {
  validateString(path, "path");
  requireCallback(callback);
  nts_fs_readlink_async(path, (errno: number, resolved: string) => {
    if (errno < 0) (callback as Callback<string>)(uvException(errno, "readlink", path));
    else (callback as Callback<string>)(null, resolved);
  });
}

export function realpath(
  path: string,
  options: unknown | Callback<string>,
  callback?: Callback<string>,
): void {
  if (typeof options === "function") {
    callback = options as Callback<string>;
  }
  validateString(path, "path");
  requireCallback(callback);
  nts_fs_realpath_async(path, (errno: number, resolved: string) => {
    if (errno < 0) (callback as Callback<string>)(uvException(errno, "realpath", path));
    else (callback as Callback<string>)(null, resolved);
  });
}

export function chmod(path: string, mode: number, callback?: Callback): void {
  validateString(path, "path");
  requireCallback(callback);
  nts_fs_chmod_async(path, mode, settle(callback as Callback, "chmod", path));
}

export function chown(path: string, uid: number, gid: number, callback?: Callback): void {
  validateString(path, "path");
  requireCallback(callback);
  nts_fs_chown_async(path, uid, gid, settle(callback as Callback, "chown", path));
}

export function truncate(
  path: string,
  length: number | Callback,
  callback?: Callback,
): void {
  if (typeof length === "function") {
    callback = length;
    length = 0;
  }
  validateString(path, "path");
  requireCallback(callback);
  nts_fs_truncate_async(path, length as number, settle(callback as Callback, "truncate", path));
}

export function ftruncate(
  fd: number,
  length: number | Callback,
  callback?: Callback,
): void {
  if (typeof length === "function") {
    callback = length;
    length = 0;
  }
  requireCallback(callback);
  nts_fs_ftruncate_async(fd, length as number, settle(callback as Callback, "ftruncate"));
}

export function utimes(
  path: string,
  atime: number | Date,
  mtime: number | Date,
  callback?: Callback,
): void {
  validateString(path, "path");
  requireCallback(callback);
  const toSeconds = (t: number | Date): number =>
    t instanceof Date ? t.getTime() / 1000 : t;
  nts_fs_utimes_async(
    path,
    toSeconds(atime),
    toSeconds(mtime),
    settle(callback as Callback, "utime", path),
  );
}

export function fsync(fd: number, callback?: Callback): void {
  requireCallback(callback);
  nts_fs_fsync_async(fd, settle(callback as Callback, "fsync"));
}

export function fdatasync(fd: number, callback?: Callback): void {
  requireCallback(callback);
  nts_fs_fdatasync_async(fd, settle(callback as Callback, "fdatasync"));
}

export function mkdtemp(
  prefix: string,
  options: unknown | Callback<string>,
  callback?: Callback<string>,
): void {
  if (typeof options === "function") {
    callback = options as Callback<string>;
  }
  validateString(prefix, "prefix");
  requireCallback(callback);
  nts_fs_mkdtemp_async(`${prefix}XXXXXX`, (errno: number, created: string) => {
    if (errno < 0) (callback as Callback<string>)(uvException(errno, "mkdtemp", prefix));
    else (callback as Callback<string>)(null, created);
  });
}

export function fchmod(fd: number, mode: number, callback?: Callback): void {
  requireCallback(callback);
  nts_fs_fchmod_async(fd, mode, settle(callback as Callback, "fchmod"));
}

export function fchown(fd: number, uid: number, gid: number, callback?: Callback): void {
  requireCallback(callback);
  nts_fs_fchown_async(fd, uid, gid, settle(callback as Callback, "fchown"));
}

export function futimes(
  fd: number,
  atime: number | Date,
  mtime: number | Date,
  callback?: Callback,
): void {
  requireCallback(callback);
  const toSeconds = (t: number | Date): number =>
    t instanceof Date ? t.getTime() / 1000 : t;
  nts_fs_futimes_async(fd, toSeconds(atime), toSeconds(mtime), settle(callback as Callback, "futime"));
}
