// `node:fs`, synchronous surface, from node v24.20.0 `lib/fs.js`.
//
// # What is here and what is not
//
// The `*Sync` functions, `Stats`, `Dirent` and `constants`. The callback and
// promise forms are absent, and not because they are hard to write: they need
// an event loop and a thread pool to run the work on, and there is no point
// having `readFile(path, cb)` call `cb` before it returns. That is a runtime
// decision rather than a `node:fs` one, tracked in `docs/conformance/`.
//
// The callback forms are in `async.ts` and re-exported here. They were absent
// for as long as there was no event loop to run them on; there is one now, and
// each is the same system call handed to the loop's thread pool instead of run
// on the calling thread.

import { validateString } from "../../internal/validators.ts";
import { ERR_INVALID_ARG_TYPE } from "../../internal/errors.ts";
import { uvException } from "../../internal/uv.ts";
import { Buffer } from "../../buffer/src/main.ts";
import { Dirent, Stats } from "./stats.ts";
import * as constants from "./constants.ts";
import { getOptions, requireTextEncoding, type FileOptions } from "./options.ts";

export { Stats, Dirent, constants };

// The callback surface, which shares this module's argument handling and its
// errors: the work is the same system call and only the route back differs.
export {
  access, appendFile, chmod, chown, close, copyFile, exists, fdatasync, fstat,
  fsync, ftruncate, link, lstat, mkdir, mkdtemp, open, read, readFile, readdir,
  readlink, realpath, rename, rm, rmdir, stat, symlink, truncate, unlink,
  utimes, write, writeFile, fchmod, fchown, futimes,
} from "./async.ts";

// `fs.promises` and `node:fs/promises` are the same object.
export * as promises from "./promises.ts";

export { ReadStream, WriteStream, createReadStream, createWriteStream } from "./streams.ts";
export { FSWatcher, StatWatcher, watch, watchFile, unwatchFile } from "./watchers.ts";

import { createReadStream as makeReadStream, createWriteStream as makeWriteStream } from "./streams.ts";
import { setStreamFactories } from "./promises.ts";

// `FileHandle.createReadStream` calls through this, which `promises.ts` cannot
// import: `streams.ts` already imports `promises.ts` for the operations it
// drives.
setStreamFactories(makeReadStream as never, makeWriteStream as never);

// -------------------------------------------------------------- the bindings

declare function nts_fs_stat(path: string, follow: boolean): number[];
declare function nts_fs_fstat(fd: number): number[];
declare function nts_fs_open(path: string, flags: number, mode: number): number;
declare function nts_fs_close(fd: number): number;
declare function nts_fs_read_file_utf8(path: string): string;
declare function nts_fs_read_file_bytes(path: string): number[];
declare function nts_fs_write_file_utf8(
  path: string, contents: string, flags: number, mode: number,
): number;
declare function nts_fs_write_file_bytes(
  path: string, bytes: number[], flags: number, mode: number,
): number;
declare function nts_fs_readdir(path: string): string[];
declare function nts_fs_readdir_types(path: string): number[];
declare function nts_fs_unlink(path: string): number;
declare function nts_fs_mkdir(path: string, mode: number): number;
declare function nts_fs_rmdir(path: string): number;
declare function nts_fs_rename(from: string, to: string): number;
declare function nts_fs_copyfile(from: string, to: string, flags: number): number;
declare function nts_fs_access(path: string, mode: number): number;
declare function nts_fs_chmod(path: string, mode: number): number;
declare function nts_fs_chown(path: string, uid: number, gid: number): number;
declare function nts_fs_truncate(path: string, length: number): number;
declare function nts_fs_utimes(path: string, atime: number, mtime: number): number;
declare function nts_fs_link(from: string, to: string): number;
declare function nts_fs_symlink(target: string, at: string, flags: number): number;
declare function nts_fs_readlink(path: string): string;
declare function nts_fs_realpath(path: string): string;
declare function nts_fs_mkdtemp(template: string): string;
declare function nts_fs_read(
  fd: number, length: number, position: number,
): number[];
declare function nts_fs_write(
  fd: number, bytes: number[], position: number,
): number;
declare function nts_fs_fsync(fd: number): number;
declare function nts_fs_fdatasync(fd: number): number;
declare function nts_fs_ftruncate(fd: number, length: number): number;
declare function nts_errno(): number;

/** Raise whatever the last binding call failed with. */
function check(result: number, syscall: string, path?: string, dest?: string): void {
  if (result < 0) {
    throw uvException(result, syscall, path, dest);
  }
}

function checkErrno(syscall: string, path?: string, dest?: string): void {
  const code = nts_errno();
  if (code !== 0) {
    throw uvException(-code, syscall, path, dest);
  }
}

// ------------------------------------------------------------ descriptor I/O

/**
 * Read into `buffer`, returning how many bytes arrived.
 *
 * A short read is not an error and not the end: a pipe, a terminal or a slow
 * disk may all give back less than was asked for, and a caller that treats
 * fewer bytes as end-of-file truncates its own input.
 */
export function readSync(
  fd: number,
  buffer: Buffer,
  offset = 0,
  length = buffer.length - offset,
  position: number | null = null,
): number {
  const bytes = nts_fs_read(fd, length, position ?? -1);
  checkErrno("read");
  for (let i = 0; i < bytes.length; i++) {
    buffer[offset + i] = bytes[i] as number;
  }
  return bytes.length;
}

/** Write from `buffer`, returning how many bytes were taken. */
export function writeSync(
  fd: number,
  data: Buffer | string,
  offsetOrPosition: number | null = null,
  lengthOrEncoding?: number | string,
  position: number | null = null,
): number {
  // `write(fd, string, position, encoding)` and
  // `write(fd, buffer, offset, length, position)` are told apart by the type
  // of the second argument, as node tells them apart.
  const buffer = typeof data === "string"
    ? Buffer.from(data, typeof lengthOrEncoding === "string" ? lengthOrEncoding : "utf8")
    : data;
  const at = typeof data === "string" ? offsetOrPosition : position;
  const start = typeof data === "string" ? 0 : (offsetOrPosition ?? 0);
  const count = typeof data === "string"
    ? buffer.length
    : ((lengthOrEncoding as number | undefined) ?? buffer.length - start);

  const slice = Array.from(buffer.subarray(start, start + count)) as number[];
  const written = nts_fs_write(fd, slice, at ?? -1);
  check(written, "write");
  return written;
}

/** Flush the file's contents *and* its metadata to the storage device. */
export function fsyncSync(fd: number): void {
  check(nts_fs_fsync(fd), "fsync");
}

/**
 * Flush the contents but not necessarily the metadata.
 *
 * Cheaper than `fsync` and enough when the size and times can be recovered or
 * do not matter -- a database writing into a preallocated file, say.
 */
export function fdatasyncSync(fd: number): void {
  check(nts_fs_fdatasync(fd), "fdatasync");
}

export function ftruncateSync(fd: number, length = 0): void {
  check(nts_fs_ftruncate(fd, length), "ftruncate");
}

// ----------------------------------------------------------------- metadata

export function statSync(path: string): Stats {
  validateString(path, "path");
  const columns = nts_fs_stat(path, true);
  if (columns.length === 0) {
    throw uvException(-nts_errno(), "stat", path);
  }
  return new Stats(columns);
}

export function lstatSync(path: string): Stats {
  validateString(path, "path");
  const columns = nts_fs_stat(path, false);
  if (columns.length === 0) {
    throw uvException(-nts_errno(), "lstat", path);
  }
  return new Stats(columns);
}

export function fstatSync(fd: number): Stats {
  const columns = nts_fs_fstat(fd);
  if (columns.length === 0) {
    throw uvException(-nts_errno(), "fstat");
  }
  return new Stats(columns);
}

/**
 * Upstream `lib/fs.js`. Deprecated in node's documentation in favour of
 * `statSync` in a `try`, and still the most-called function in the module.
 */
export function existsSync(path: string): boolean {
  if (typeof path !== "string") {
    return false;
  }
  return nts_fs_stat(path, true).length > 0;
}

export function accessSync(path: string, mode = constants.F_OK): void {
  validateString(path, "path");
  check(nts_fs_access(path, mode), "access", path);
}

// --------------------------------------------------------------- whole file

/**
 * `readFileSync(path[, options])`, upstream `lib/fs.js`.
 *
 * A `Buffer` when no encoding is given, a string when there is one -- node's
 * signature, and the reason the return type is a union rather than a choice
 * made for the caller.
 */
export function readFileSync(path: string, options?: null): Buffer;
export function readFileSync(path: string, options: string | FileOptions): string;
export function readFileSync(
  path: string,
  options?: string | FileOptions | null,
): string | Buffer {
  validateString(path, "path");
  const settings = getOptions(options);

  if (settings.encoding === null || settings.encoding === undefined) {
    const bytes = nts_fs_read_file_bytes(path);
    checkErrno("open", path);
    return Buffer.from(bytes);
  }

  requireTextEncoding(settings.encoding, "options.encoding");
  const contents = nts_fs_read_file_utf8(path);
  checkErrno("open", path);
  return contents;
}

export function writeFileSync(
  path: string,
  data: string | Uint8Array,
  options?: string | FileOptions,
): void {
  validateString(path, "path");
  const settings = getOptions(options, { encoding: "utf8", mode: 0o666, flag: "w" });
  const flags = flagsOf(settings.flag ?? "w");
  const mode = settings.mode ?? 0o666;

  // A `Buffer` goes out as bytes and a string goes out encoded. Encoding the
  // buffer into a string to reuse one binding would re-encode every byte above
  // 0x7f, which is the bug that made this two functions.
  if (data instanceof Uint8Array) {
    check(nts_fs_write_file_bytes(path, Array.from(data), flags, mode), "open", path);
    return;
  }
  validateString(data, "data");
  requireTextEncoding(settings.encoding, "options.encoding");
  check(nts_fs_write_file_utf8(path, data, flags, mode), "open", path);
}

export function appendFileSync(
  path: string,
  data: string,
  options?: string | FileOptions,
): void {
  validateString(path, "path");
  validateString(data, "data");
  const settings = getOptions(options, { encoding: "utf8", mode: 0o666, flag: "a" });
  requireTextEncoding(settings.encoding, "options.encoding");
  check(nts_fs_write_file_utf8(path, data, flagsOf(settings.flag ?? "a"), settings.mode ?? 0o666),
        "open", path);
}

/**
 * `stringToFlags`, upstream `lib/internal/fs/utils.js`. The `O_*` values are
 * POSIX's, so the arithmetic is the same everywhere `node:fs` runs.
 */
export function flagsOf(flags: string | number): number {
  if (typeof flags === "number") {
    return flags;
  }
  const O_CREAT = 0o100;
  const O_EXCL = 0o200;
  const O_TRUNC = 0o1000;
  const O_APPEND = 0o2000;
  switch (flags) {
    case "r": return constants.O_RDONLY;
    case "rs": case "sr": return constants.O_RDONLY;
    case "r+": return constants.O_RDWR;
    case "rs+": case "sr+": return constants.O_RDWR;
    case "w": return O_TRUNC | O_CREAT | constants.O_WRONLY;
    case "wx": case "xw": return O_TRUNC | O_CREAT | constants.O_WRONLY | O_EXCL;
    case "w+": return O_TRUNC | O_CREAT | constants.O_RDWR;
    case "wx+": case "xw+": return O_TRUNC | O_CREAT | constants.O_RDWR | O_EXCL;
    case "a": return O_APPEND | O_CREAT | constants.O_WRONLY;
    case "ax": case "xa": return O_APPEND | O_CREAT | constants.O_WRONLY | O_EXCL;
    case "a+": return O_APPEND | O_CREAT | constants.O_RDWR;
    case "ax+": case "xa+": return O_APPEND | O_CREAT | constants.O_RDWR | O_EXCL;
    default:
      throw new ERR_INVALID_ARG_TYPE("flags", "string", flags);
  }
}

// ------------------------------------------------------------- descriptors

export function openSync(path: string, flags: string | number = "r", mode = 0o666): number {
  validateString(path, "path");
  const fd = nts_fs_open(path, flagsOf(flags), mode);
  check(fd, "open", path);
  return fd;
}

export function closeSync(fd: number): void {
  check(nts_fs_close(fd), "close");
}

// ------------------------------------------------------------- directories

export interface ReaddirOptions {
  withFileTypes?: boolean;
}

export function readdirSync(path: string): string[];
export function readdirSync(path: string, options: ReaddirOptions): string[] | Dirent[];
export function readdirSync(path: string, options?: ReaddirOptions): string[] | Dirent[] {
  validateString(path, "path");
  const names = nts_fs_readdir(path);
  checkErrno("scandir", path);
  if (!options?.withFileTypes) {
    return names;
  }
  const types = nts_fs_readdir_types(path);
  const entries: Dirent[] = [];
  for (let i = 0; i < names.length; i++) {
    entries.push(new Dirent(names[i]!, types[i]!, path));
  }
  return entries;
}

export interface MkdirOptions {
  recursive?: boolean;
  mode?: number;
}

export function mkdirSync(path: string, options?: number | MkdirOptions): void {
  validateString(path, "path");
  const mode = typeof options === "number" ? options : (options?.mode ?? 0o777);
  const recursive = typeof options === "object" && options.recursive === true;

  if (!recursive) {
    check(nts_fs_mkdir(path, mode), "mkdir", path);
    return;
  }

  // Node makes each missing component in turn and treats an existing one as
  // success. Doing it here rather than in the binding keeps the C to one
  // syscall per function.
  const parts = path.split("/");
  let at = path.startsWith("/") ? "" : ".";
  for (const part of parts) {
    if (part === "") {
      continue;
    }
    at = `${at}/${part}`;
    const result = nts_fs_mkdir(at, mode);
    // -17 is EEXIST: a component that is already there is not an error for a
    // recursive make.
    if (result < 0 && result !== -17) {
      throw uvException(result, "mkdir", at);
    }
  }
}

export function rmdirSync(path: string): void {
  validateString(path, "path");
  check(nts_fs_rmdir(path), "rmdir", path);
}

export function mkdtempSync(prefix: string): string {
  validateString(prefix, "prefix");
  const made = nts_fs_mkdtemp(`${prefix}XXXXXX`);
  checkErrno("mkdtemp", prefix);
  return made;
}

// ------------------------------------------------------------------- links

export function unlinkSync(path: string): void {
  validateString(path, "path");
  check(nts_fs_unlink(path), "unlink", path);
}

export function renameSync(from: string, to: string): void {
  validateString(from, "oldPath");
  validateString(to, "newPath");
  check(nts_fs_rename(from, to), "rename", from, to);
}

export function copyFileSync(from: string, to: string, mode = 0): void {
  validateString(from, "src");
  validateString(to, "dest");
  check(nts_fs_copyfile(from, to, mode), "copyfile", from, to);
}

export function linkSync(from: string, to: string): void {
  validateString(from, "existingPath");
  validateString(to, "newPath");
  check(nts_fs_link(from, to), "link", from, to);
}

export function symlinkSync(target: string, at: string): void {
  validateString(target, "target");
  validateString(at, "path");
  check(nts_fs_symlink(target, at, 0), "symlink", target, at);
}

export function readlinkSync(path: string): string {
  validateString(path, "path");
  const target = nts_fs_readlink(path);
  checkErrno("readlink", path);
  return target;
}

export function realpathSync(path: string): string {
  validateString(path, "path");
  const resolved = nts_fs_realpath(path);
  checkErrno("realpath", path);
  return resolved;
}

// ------------------------------------------------------------- permissions

export function chmodSync(path: string, mode: number): void {
  validateString(path, "path");
  check(nts_fs_chmod(path, mode), "chmod", path);
}

export function chownSync(path: string, uid: number, gid: number): void {
  validateString(path, "path");
  check(nts_fs_chown(path, uid, gid), "chown", path);
}

export function truncateSync(path: string, length = 0): void {
  validateString(path, "path");
  check(nts_fs_truncate(path, length), "truncate", path);
}

export function utimesSync(path: string, atime: number, mtime: number): void {
  validateString(path, "path");
  check(nts_fs_utimes(path, atime, mtime), "utime", path);
}

export interface RmOptions {
  recursive?: boolean;
  force?: boolean;
}

/** Upstream `lib/fs.js`. `rm -r`, assembled here from the one-syscall bindings. */
export function rmSync(path: string, options?: RmOptions): void {
  validateString(path, "path");
  const columns = nts_fs_stat(path, false);
  if (columns.length === 0) {
    if (options?.force) {
      return;
    }
    throw uvException(-nts_errno(), "stat", path);
  }

  const stats = new Stats(columns);
  if (!stats.isDirectory()) {
    check(nts_fs_unlink(path), "unlink", path);
    return;
  }
  if (!options?.recursive) {
    check(nts_fs_rmdir(path), "rmdir", path);
    return;
  }
  for (const name of nts_fs_readdir(path)) {
    rmSync(`${path}/${name}`, options);
  }
  check(nts_fs_rmdir(path), "rmdir", path);
}
