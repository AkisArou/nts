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

import {
  validateBoolean,
  parseFileMode,
  validateInteger,
  validateObject,
} from "../../internal/validators.ts";
import {
  ERR_FS_EISDIR,
  ERR_FS_FILE_TOO_LARGE,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_OUT_OF_RANGE,
} from "../../internal/errors.ts";
import { errMessage, errName, uvException } from "../../internal/uv.ts";
import { emitWarning } from "../../internal/process-warning.ts";
import { Buffer } from "../../buffer/src/main.ts";
import {
  bigintStatFs,
  BigIntStats,
  Dirent,
  numberStatFs,
  StatFs,
  Stats,
  type StatOptions,
  type StatFsOptions,
  type StatSyncOptions,
} from "./stats.ts";
import * as constants from "./constants.ts";
import { flagsOf } from "./flags.ts";
import { resolve as resolvePath } from "../../path/src/posix.ts";
import {
  decodeScandirRows,
  normalizeReaddirOptions,
  type ReaddirOptions,
  type ReaddirResult,
} from "./readdir.ts";
import {
  bufferLengths,
  fillBuffers,
  flattenBuffers,
  validateBufferArray,
  vectorPosition,
} from "./vector-io.ts";
import { normalizeReadPosition } from "./read-position.ts";
import {
  appendMkdtempSuffix,
  bytePathForBinding,
  displayBytePath,
  encodeFileBytes,
  encodeFileName,
  emitRecursiveRmdirWarning,
  getOptions,
  getValidatedBytePath,
  getValidatedPath,
  normalizeRmOptions,
  normalizeRmdirOptions,
  normalizeFileResultEncoding,
  requireTextEncoding,
  symlinkTypeFlags,
  toUnixTimestamp,
  validateAccessMode,
  validateFileDescriptor,
  validateOwnerId,
  warnOnNonPortableTemplate,
  type BytePathLike,
  type EncodedFileName,
  type FileOptions,
  type NormalizedRmOptions,
  type PathLike,
  type RmdirOptions,
  type RmOptions,
  type SymlinkType,
} from "./options.ts";

export { Stats, StatFs, Dirent, constants };
export type { BigIntStats } from "./stats.ts";
export type { RmdirOptions, RmOptions } from "./options.ts";
export { Dir, opendir, opendirSync } from "./dir.ts";
export type { OpenDirOptions } from "./dir.ts";
export { flagsOf } from "./flags.ts";
export { toUnixTimestamp as _toUnixTimestamp } from "./options.ts";

// The callback surface, which shares this module's argument handling and its
// errors: the work is the same system call and only the route back differs.
export {
  access, appendFile, chmod, chown, close, copyFile, exists, fdatasync, fstat,
  fsync, ftruncate, lchown, link, lstat, mkdir, mkdtemp, open, read, readFile, readdir,
  readlink, realpath, rename, rm, rmdir, stat, symlink, truncate, unlink,
  utimes, lutimes, write, writeFile, writev, readv, fchmod, fchown, futimes,
  statfs, _realpathNative,
} from "./async.ts";

// `fs.promises` and `node:fs/promises` are the same object.
export * as promises from "./promises.ts";

export { ReadStream, WriteStream, createReadStream, createWriteStream } from "./streams.ts";
export { FSWatcher, StatWatcher, watch, watchFile, unwatchFile } from "./watchers.ts";

/** Named arguments accepted by the current `readSync` overload. */
export interface ReadOptions {
  offset?: number | undefined;
  length?: number | undefined;
  position?: number | bigint | null | undefined;
}

/** Named arguments accepted by the current `writeSync` overload. */
export interface WriteOptions {
  offset?: number | undefined;
  length?: number | undefined;
  position?: number | null | undefined;
}

import { createReadStream as makeReadStream, createWriteStream as makeWriteStream } from "./streams.ts";
import { setStreamFactories } from "./promises.ts";

// `FileHandle.createReadStream` calls through this, which `promises.ts` cannot
// import: `streams.ts` already imports `promises.ts` for the operations it
// drives.
setStreamFactories(makeReadStream, makeWriteStream);

// -------------------------------------------------------------- the bindings

declare function nts_fs_stat(path: string, follow: boolean): number[];
declare function nts_fs_stat_bytes(path: number[], follow: boolean): number[];
declare function nts_fs_stat_bigint(path: string, follow: boolean): string[];
declare function nts_fs_stat_bigint_bytes(path: number[], follow: boolean): string[];
declare function nts_fs_fstat(fd: number): number[];
declare function nts_fs_fstat_bigint(fd: number): string[];
declare function nts_fs_statfs(path: string): number[];
declare function nts_fs_statfs_bytes(path: number[]): number[];
declare function nts_fs_statfs_bigint(path: string): string[];
declare function nts_fs_statfs_bigint_bytes(path: number[]): string[];
declare function nts_fs_open(path: string, flags: number, mode: number): number;
declare function nts_fs_open_bytes(path: number[], flags: number, mode: number): number;
declare function nts_fs_close(fd: number): number;
declare function nts_fs_read_file_bytes_fd(fd: number): number[];
declare function nts_fs_write_file_utf8(
  path: string, contents: string, flags: number, mode: number, flush: boolean,
): number;
declare function nts_fs_write_file_bytes(
  path: string, bytes: number[], flags: number, mode: number, flush: boolean,
): number;
declare function nts_fs_write_file_bytes_fd(
  fd: number, bytes: number[], flush: boolean,
): number;
declare function nts_fs_scandir(path: string): number[][];
declare function nts_fs_scandir_bytes(path: number[]): number[][];
declare function nts_fs_unlink(path: string): number;
declare function nts_fs_mkdir(path: string, mode: number): number;
declare function nts_fs_rmdir(path: string): number;
declare function nts_fs_rename(from: string, to: string): number;
declare function nts_fs_copyfile(from: string, to: string, flags: number): number;
declare function nts_fs_access(path: string, mode: number): number;
declare function nts_fs_access_bytes(path: number[], mode: number): number;
declare function nts_fs_chmod(path: string, mode: number): number;
declare function nts_fs_chown(path: string, uid: number, gid: number): number;
declare function nts_fs_lchown(path: string, uid: number, gid: number): number;
declare function nts_fs_lchown_bytes(path: number[], uid: number, gid: number): number;
declare function nts_fs_utimes(path: string, atime: number, mtime: number): number;
declare function nts_fs_link(from: string, to: string): number;
declare function nts_fs_symlink(target: string, at: string, flags: number): number;
declare function nts_fs_symlink_bytes(
  target: number[], at: number[], flags: number,
): number;
declare function nts_fs_readlink(path: string): string;
declare function nts_fs_realpath(path: string): string;
declare function nts_fs_realpath_bytes(path: number[]): number[];
declare function nts_fs_mkdtemp(template: string): string;
declare function nts_fs_mkdtemp_bytes(template: number[]): number[];
declare function nts_fs_read(
  fd: number, length: number, position: number,
): number[];
declare function nts_fs_read_bigint(
  fd: number, length: number, position: bigint,
): number[];
declare function nts_fs_write(
  fd: number, bytes: number[], position: number,
): number;
declare function nts_fs_fsync(fd: number): number;
declare function nts_fs_fdatasync(fd: number): number;
declare function nts_fs_ftruncate(fd: number, length: number): number;
declare function nts_fs_fchmod(fd: number, mode: number): number;
declare function nts_fs_fchown(fd: number, uid: number, gid: number): number;
declare function nts_fs_futimes(fd: number, atime: number, mtime: number): number;
declare function nts_fs_lutimes(path: string, atime: number, mtime: number): number;
declare function nts_fs_readv(
  fd: number, lengths: number[], position: number,
): number[];
declare function nts_fs_writev(
  fd: number, bytes: number[], lengths: number[], position: number,
): number;
declare function nts_fs_eisdir(): number;
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

function validateIoPosition(position: number | null): number {
  if (position === null) return -1;
  validateInteger(position, "position", -1);
  return position;
}

function readAt(fd: number, length: number, position: number | bigint): number[] {
  if (typeof position === "bigint") {
    return nts_fs_read_bigint(fd, length, position);
  }
  return nts_fs_read(fd, length, position);
}

function validateReadBounds(offset: number, length: number, size: number): void {
  if (offset < 0) throw new ERR_OUT_OF_RANGE("offset", ">= 0", offset);
  if (length < 0) throw new ERR_OUT_OF_RANGE("length", ">= 0", length);
  if (offset + length > size) {
    throw new ERR_OUT_OF_RANGE("length", `<= ${size - offset}`, length);
  }
}

function validateWriteBounds(offset: number, length: number, size: number): void {
  if (offset > size) throw new ERR_OUT_OF_RANGE("offset", `<= ${size}`, offset);
  if (length > size - offset) {
    throw new ERR_OUT_OF_RANGE("length", `<= ${size - offset}`, length);
  }
  validateInteger(length, "length", 0, 2_147_483_647);
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
  offset: number,
  length: number,
  position: number | bigint | null,
): number;
export function readSync(
  fd: number,
  buffer: Buffer,
  options?: ReadOptions | null,
): number;
export function readSync(
  fd: number,
  buffer: Buffer,
  offsetOrOptions?: number | ReadOptions | null,
  suppliedLength?: number,
  suppliedPosition?: unknown,
): number {
  if (!(buffer instanceof Uint8Array)) {
    throw new ERR_INVALID_ARG_TYPE("buffer", ["Buffer", "TypedArray", "DataView"], buffer);
  }

  let offset: number;
  let length: number;
  let position: unknown;
  if (arguments.length <= 3 || typeof offsetOrOptions === "object") {
    if (offsetOrOptions !== undefined && offsetOrOptions !== null) {
      // Besides validating the JS boundary, this rejects arrays while still
      // accepting Node's historical boxed-string options object.
      validateObject(offsetOrOptions, "options");
    }
    const options = typeof offsetOrOptions === "object" && offsetOrOptions !== null
      ? offsetOrOptions
      : undefined;
    offset = options?.offset ?? 0;
    length = options?.length === undefined ? buffer.length - offset : options.length;
    position = options?.position ?? null;
  } else {
    if (typeof offsetOrOptions !== "number") {
      throw new ERR_INVALID_ARG_TYPE("offset", "number", offsetOrOptions);
    }
    offset = offsetOrOptions;
    length = suppliedLength ?? buffer.length - offset;
    position = suppliedPosition ?? null;
  }

  validateInteger(offset, "offset");
  // Node coerces the requested read length to a signed 32-bit count before
  // checking its bounds.
  length |= 0;
  if (length < 0) throw new ERR_OUT_OF_RANGE("length", ">= 0", length);
  const normalizedPosition = normalizeReadPosition(position, length);
  if (length === 0) return 0;
  if (buffer.length === 0) {
    throw new ERR_INVALID_ARG_VALUE("buffer", buffer, "is empty and cannot be written");
  }
  validateReadBounds(offset, length, buffer.length);
  validateFileDescriptor(fd);
  const bytes = readAt(fd, length, normalizedPosition);
  checkErrno("read");
  let target = offset;
  for (const byte of bytes) {
    buffer[target++] = byte;
  }
  return bytes.length;
}

/** Write from `buffer`, returning how many bytes were taken. */
export function writeSync(
  fd: number,
  data: Buffer | Uint8Array,
  options?: WriteOptions | null,
): number;
export function writeSync(
  fd: number,
  data: Buffer | Uint8Array,
  offset?: number | null,
  length?: number | null,
  position?: number | null,
): number;
export function writeSync(
  fd: number,
  data: string,
  position?: number | null,
  encoding?: string | null,
): number;
export function writeSync(
  fd: number,
  data: Buffer | Uint8Array | string,
  offsetOrOptions: number | WriteOptions | null = null,
  lengthOrEncoding?: number | string | null,
  position: number | null = null,
): number {
  if (typeof data !== "string" && !(data instanceof Uint8Array)) {
    throw new ERR_INVALID_ARG_TYPE(
      "buffer",
      ["Buffer", "TypedArray", "DataView", "string"],
      data,
    );
  }

  // `write(fd, string, position, encoding)` and
  // `write(fd, buffer, offset, length, position)` are told apart by the type
  // of the second argument, as node tells them apart.
  let buffer: Uint8Array;
  if (typeof data === "string") {
    const encodingName = typeof lengthOrEncoding === "string" ? lengthOrEncoding : "utf8";
    const encoding = requireTextEncoding(encodingName, "encoding");
    if (encoding === "hex" && data.length % 2 !== 0) {
      throw new ERR_INVALID_ARG_VALUE(
        "encoding",
        encodingName,
        `is invalid for data of length ${data.length}`,
      );
    }
    buffer = Buffer.from(data, encoding);
  } else {
    buffer = data;
  }

  let start = 0;
  let count = buffer.length;
  let at: number | null;
  if (typeof data === "string") {
    if (typeof offsetOrOptions === "object" && offsetOrOptions !== null) {
      throw new ERR_INVALID_ARG_TYPE("position", "integer", offsetOrOptions);
    }
    at = offsetOrOptions;
  } else if (typeof offsetOrOptions === "object") {
    if (offsetOrOptions !== null) validateObject(offsetOrOptions, "options");
    start = offsetOrOptions?.offset ?? 0;
    count = offsetOrOptions?.length ?? buffer.length - start;
    at = offsetOrOptions?.position ?? null;
    validateInteger(start, "offset", 0);
    validateWriteBounds(start, count, buffer.length);
  } else {
    start = offsetOrOptions ?? 0;
    count = typeof lengthOrEncoding === "number" ? lengthOrEncoding : buffer.length - start;
    at = position;
    validateInteger(start, "offset", 0);
    validateWriteBounds(start, count, buffer.length);
  }
  validateFileDescriptor(fd);

  const slice = Array.from(buffer.subarray(start, start + count));
  const written = nts_fs_write(fd, slice, validateIoPosition(at));
  check(written, "write");
  return written;
}

/** Read sequentially into several buffers with one `readv(2)` operation. */
export function readvSync(
  fd: number,
  buffers: readonly ArrayBufferView[],
  position: number | null = null,
): number {
  validateBufferArray(buffers);
  validateFileDescriptor(fd);
  const lengths = bufferLengths(buffers);
  const bytes = nts_fs_readv(fd, lengths, vectorPosition(position));
  checkErrno("read");

  fillBuffers(buffers, bytes, bytes.length);
  return bytes.length;
}

/** Write several buffers atomically through one `writev(2)` operation. */
export function writevSync(
  fd: number,
  buffers: readonly ArrayBufferView[],
  position: number | null = null,
): number {
  validateBufferArray(buffers);
  if (buffers.length === 0) return 0;
  validateFileDescriptor(fd);

  const lengths = bufferLengths(buffers);
  const bytes = flattenBuffers(buffers);
  const written = nts_fs_writev(fd, bytes, lengths, vectorPosition(position));
  check(written, "write");
  return written;
}

/** Flush the file's contents *and* its metadata to the storage device. */
export function fsyncSync(fd: number): void {
  validateFileDescriptor(fd);
  check(nts_fs_fsync(fd), "fsync");
}

/**
 * Flush the contents but not necessarily the metadata.
 *
 * Cheaper than `fsync` and enough when the size and times can be recovered or
 * do not matter -- a database writing into a preallocated file, say.
 */
export function fdatasyncSync(fd: number): void {
  validateFileDescriptor(fd);
  check(nts_fs_fdatasync(fd), "fdatasync");
}

export function ftruncateSync(fd: number, length = 0): void {
  validateFileDescriptor(fd);
  validateInteger(length, "len");
  check(nts_fs_ftruncate(fd, Math.max(0, length)), "ftruncate");
}

export function fchmodSync(fd: number, mode: number | string): void {
  const parsedMode = parseFileMode(mode, "mode");
  validateFileDescriptor(fd);
  check(nts_fs_fchmod(fd, parsedMode), "fchmod");
}

export function fchownSync(fd: number, uid: number, gid: number): void {
  validateOwnerId(uid, "uid");
  validateOwnerId(gid, "gid");
  validateFileDescriptor(fd);
  check(nts_fs_fchown(fd, uid, gid), "fchown");
}

export function futimesSync(
  fd: number,
  atime: number | string | Date,
  mtime: number | string | Date,
): void {
  const accessTime = toUnixTimestamp(atime, "atime");
  const modificationTime = toUnixTimestamp(mtime, "mtime");
  validateFileDescriptor(fd);
  check(nts_fs_futimes(fd, accessTime, modificationTime), "futime");
}

// ----------------------------------------------------------------- metadata

export function statSync(path: BytePathLike, options?: undefined): Stats;
export function statSync(
  path: BytePathLike,
  options: StatSyncOptions & { bigint?: false; throwIfNoEntry: false },
): Stats | undefined;
export function statSync(
  path: BytePathLike,
  options: StatSyncOptions & { bigint: true; throwIfNoEntry: false },
): BigIntStats | undefined;
export function statSync(
  path: BytePathLike,
  options: StatSyncOptions & { bigint?: false },
): Stats;
export function statSync(
  path: BytePathLike,
  options: StatSyncOptions & { bigint: true },
): BigIntStats;
export function statSync(
  path: BytePathLike,
  options?: StatSyncOptions,
): Stats | BigIntStats | undefined;
export function statSync(
  path: BytePathLike,
  options?: StatSyncOptions,
): Stats | BigIntStats | undefined {
  const validatedPath = getValidatedBytePath(path);
  const displayPath = displayBytePath(validatedPath);
  if (options?.bigint === true) {
    const columns = typeof validatedPath === "string"
      ? nts_fs_stat_bigint(validatedPath, true)
      : nts_fs_stat_bigint_bytes(validatedPath, true);
    if (columns.length !== 0) return new BigIntStats(columns);
  } else {
    const columns = typeof validatedPath === "string"
      ? nts_fs_stat(validatedPath, true)
      : nts_fs_stat_bytes(validatedPath, true);
    if (columns.length !== 0) return new Stats(columns);
  }
  const errno = -nts_errno();
  if (options?.throwIfNoEntry === false) {
    const code = errName(errno);
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
  }
  throw uvException(errno, "stat", displayPath);
}

export function lstatSync(path: BytePathLike, options?: undefined): Stats;
export function lstatSync(
  path: BytePathLike,
  options: StatSyncOptions & { bigint?: false; throwIfNoEntry: false },
): Stats | undefined;
export function lstatSync(
  path: BytePathLike,
  options: StatSyncOptions & { bigint: true; throwIfNoEntry: false },
): BigIntStats | undefined;
export function lstatSync(
  path: BytePathLike,
  options: StatSyncOptions & { bigint?: false },
): Stats;
export function lstatSync(
  path: BytePathLike,
  options: StatSyncOptions & { bigint: true },
): BigIntStats;
export function lstatSync(
  path: BytePathLike,
  options?: StatSyncOptions,
): Stats | BigIntStats | undefined;
export function lstatSync(
  path: BytePathLike,
  options?: StatSyncOptions,
): Stats | BigIntStats | undefined {
  const validatedPath = getValidatedBytePath(path);
  const displayPath = displayBytePath(validatedPath);
  if (options?.bigint === true) {
    const columns = typeof validatedPath === "string"
      ? nts_fs_stat_bigint(validatedPath, false)
      : nts_fs_stat_bigint_bytes(validatedPath, false);
    if (columns.length !== 0) return new BigIntStats(columns);
  } else {
    const columns = typeof validatedPath === "string"
      ? nts_fs_stat(validatedPath, false)
      : nts_fs_stat_bytes(validatedPath, false);
    if (columns.length !== 0) return new Stats(columns);
  }
  const errno = -nts_errno();
  if (options?.throwIfNoEntry === false) {
    const code = errName(errno);
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
  }
  throw uvException(errno, "lstat", displayPath);
}

export function fstatSync(
  fd: number,
  options: StatOptions & { bigint: true },
): BigIntStats;
export function fstatSync(
  fd: number,
  options?: StatOptions & { bigint?: false },
): Stats;
export function fstatSync(
  fd: number,
  options?: StatOptions,
): Stats | BigIntStats;
export function fstatSync(
  fd: number,
  options?: StatOptions,
): Stats | BigIntStats {
  validateFileDescriptor(fd);
  if (options?.bigint === true) {
    const columns = nts_fs_fstat_bigint(fd);
    if (columns.length !== 0) return new BigIntStats(columns);
  } else {
    const columns = nts_fs_fstat(fd);
    if (columns.length !== 0) return new Stats(columns);
  }
  throw uvException(-nts_errno(), "fstat");
}

export function statfsSync(
  path: BytePathLike,
  options: { bigint: true },
): StatFs<bigint>;
export function statfsSync(
  path: BytePathLike,
  options?: StatFsOptions,
): StatFs<number>;
export function statfsSync(
  path: BytePathLike,
  options?: StatFsOptions,
): StatFs<number> | StatFs<bigint> {
  const validatedPath = getValidatedBytePath(path);
  const displayPath = displayBytePath(validatedPath);
  if (options?.bigint === true) {
    const columns = typeof validatedPath === "string"
      ? nts_fs_statfs_bigint(validatedPath)
      : nts_fs_statfs_bigint_bytes(validatedPath);
    if (columns.length === 0) {
      throw uvException(-nts_errno(), "statfs", displayPath);
    }
    return bigintStatFs(columns);
  }
  const columns = typeof validatedPath === "string"
    ? nts_fs_statfs(validatedPath)
    : nts_fs_statfs_bytes(validatedPath);
  if (columns.length === 0) {
    throw uvException(-nts_errno(), "statfs", displayPath);
  }
  return numberStatFs(columns);
}

/**
 * Upstream `lib/fs.js`. Deprecated in node's documentation in favour of
 * `statSync` in a `try`, and still the most-called function in the module.
 */
let showExistsDeprecation = true;

function hasErrorCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" &&
    "code" in error && error.code === code;
}

export function existsSync(path: unknown): boolean {
  let validatedPath: string;
  try {
    validatedPath = getValidatedPath(path);
  } catch (error) {
    if (showExistsDeprecation && hasErrorCode(error, "ERR_INVALID_ARG_TYPE")) {
      showExistsDeprecation = false;
      emitWarning(
        "Passing invalid argument types to fs.existsSync is deprecated",
        "DeprecationWarning",
        "DEP0187",
      );
    }
    return false;
  }
  return nts_fs_stat(validatedPath, true).length > 0;
}

export function accessSync(path: BytePathLike, mode: number | null = constants.F_OK): void {
  const validatedPath = getValidatedBytePath(path);
  const accessMode = validateAccessMode(mode);
  const result = typeof validatedPath === "string"
    ? nts_fs_access(validatedPath, accessMode)
    : nts_fs_access_bytes(validatedPath, accessMode);
  check(
    result,
    "access",
    displayBytePath(validatedPath),
  );
}

// --------------------------------------------------------------- whole file

/**
 * `readFileSync(path[, options])`, upstream `lib/fs.js`.
 *
 * A `Buffer` when no encoding is given, a string when there is one -- node's
 * signature, and the reason the return type is a union rather than a choice
 * made for the caller.
 */
export function readFileSync(path: PathLike | number, options?: null): Buffer;
export function readFileSync(path: PathLike | number, options: string | FileOptions): string;
export function readFileSync(
  path: PathLike | number,
  options?: string | FileOptions | null,
): string | Buffer {
  const settings = getOptions(options, { flag: "r" });
  const ownsDescriptor = typeof path !== "number";
  const fd = ownsDescriptor
    ? openSync(path, settings.flag ?? "r", 0o666)
    : path;
  if (!ownsDescriptor) validateFileDescriptor(fd);

  try {
    const size = fstatSync(fd).size;
    if (size > 2 ** 31 - 1) throw new ERR_FS_FILE_TOO_LARGE(size);
    const bytes = nts_fs_read_file_bytes_fd(fd);
    checkErrno("read");
    const contents = Buffer.from(bytes);
    if (settings.encoding === null || settings.encoding === undefined) return contents;
    return contents.toString(requireTextEncoding(settings.encoding, "options.encoding"));
  } finally {
    if (ownsDescriptor) closeSync(fd);
  }
}

export function writeFileSync(
  path: PathLike | number,
  data: string | ArrayBufferView,
  options?: string | FileOptions,
): void {
  const settings = getOptions(options, { encoding: "utf8", mode: 0o666, flag: "w" });
  const flags = flagsOf(settings.flag ?? "w");
  const mode = parseFileMode(settings.mode, "mode", 0o666);
  const flush = settings.flush ?? false;
  validateBoolean(flush, "options.flush");

  if (typeof data !== "string" && !ArrayBuffer.isView(data)) {
    throw new ERR_INVALID_ARG_TYPE(
      "data",
      ["string", "Buffer", "TypedArray", "DataView"],
      data,
    );
  }

  const encoding = requireTextEncoding(settings.encoding ?? "utf8", "options.encoding");
  const bytes = typeof data === "string"
    ? Buffer.from(data, encoding)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof path === "number") {
    validateFileDescriptor(path);
    check(nts_fs_write_file_bytes_fd(path, Array.from(bytes), flush), "write");
    return;
  }

  const validatedPath = getValidatedPath(path);
  const result = typeof data === "string" && (encoding === "utf8" || encoding === "utf-8")
    ? nts_fs_write_file_utf8(validatedPath, data, flags, mode, flush)
    : nts_fs_write_file_bytes(
      validatedPath,
      Array.from(bytes),
      flags,
      mode,
      flush,
    );
  check(result, "open", validatedPath);
}

export function appendFileSync(
  path: PathLike | number,
  data: string | ArrayBufferView,
  options?: string | FileOptions,
): void {
  const settings = getOptions(options, { encoding: "utf8", mode: 0o666, flag: "a" });
  writeFileSync(path, data, {
    ...settings,
    flag: typeof path === "number" ? "a" : (settings.flag ?? "a"),
  });
}

// ------------------------------------------------------------- descriptors

export function openSync(
  path: BytePathLike,
  flags: string | number | null = "r",
  mode: number | string | null = 0o666,
): number {
  const validatedPath = getValidatedBytePath(path);
  const openFlags = flagsOf(flags);
  const openMode = parseFileMode(mode, "mode", 0o666);
  const fd = typeof validatedPath === "string"
    ? nts_fs_open(validatedPath, openFlags, openMode)
    : nts_fs_open_bytes(validatedPath, openFlags, openMode);
  check(fd, "open", displayBytePath(validatedPath));
  return fd;
}

export function closeSync(fd: number): void {
  validateFileDescriptor(fd);
  check(nts_fs_close(fd), "close");
}

// ------------------------------------------------------------- directories

export type { ReaddirOptions } from "./readdir.ts";

export function readdirSync(path: BytePathLike): string[];
export function readdirSync(
  path: BytePathLike,
  options: string | ReaddirOptions | null,
): ReaddirResult;
export function readdirSync(
  path: BytePathLike,
  options?: string | ReaddirOptions | null,
): ReaddirResult {
  const validatedPath = getValidatedBytePath(path);
  const settings = normalizeReaddirOptions(options);
  const rows = typeof validatedPath === "string"
    ? nts_fs_scandir(validatedPath)
    : nts_fs_scandir_bytes(validatedPath);
  const displayPath = displayBytePath(validatedPath);
  checkErrno("scandir", displayPath);
  return decodeScandirRows(rows, displayPath, settings);
}

export interface MkdirOptions {
  recursive?: boolean;
  mode?: number | string;
}

export function mkdirSync(
  path: PathLike,
  options?: number | string | MkdirOptions,
): string | undefined {
  const validatedPath = getValidatedPath(path);
  const requestedMode = typeof options === "number" || typeof options === "string"
    ? options
    : (options?.mode ?? 0o777);
  const mode = parseFileMode(requestedMode, "mode", 0o777);
  let recursive = false;
  if (options !== null && typeof options === "object" && options.recursive !== undefined) {
    validateBoolean(options.recursive, "options.recursive");
    recursive = options.recursive;
  }

  if (!recursive) {
    check(nts_fs_mkdir(validatedPath, mode), "mkdir", validatedPath);
    return undefined;
  }

  // Node makes each missing component in turn and treats an existing one as
  // success. Doing it here rather than in the binding keeps the C to one
  // syscall per function.
  const parts = validatedPath.split("/");
  let at = validatedPath.startsWith("/") ? "" : ".";
  let finalResult = 0;
  let firstCreated: string | undefined;
  for (const part of parts) {
    if (part === "") {
      continue;
    }
    at = `${at}/${part}`;
    const result = nts_fs_mkdir(at, mode);
    finalResult = result;
    if (result === 0 && firstCreated === undefined) {
      firstCreated = at.startsWith("./") ? at.substring(2) : at;
    }
    // -17 is EEXIST: a component that is already there is not an error for a
    // recursive make.
    if (result < 0 && result !== -17) {
      throw uvException(result, "mkdir", validatedPath);
    }
  }
  if (finalResult === -17) {
    const columns = nts_fs_stat(validatedPath, true);
    if (columns.length === 0 || !new Stats(columns).isDirectory()) {
      throw uvException(finalResult, "mkdir", validatedPath);
    }
  }
  return firstCreated;
}

export function rmdirSync(path: PathLike, options?: RmdirOptions): void {
  const validatedPath = getValidatedPath(path);
  const settings = normalizeRmdirOptions(options);
  if (settings.recursive) {
    emitRecursiveRmdirWarning();
    const columns = nts_fs_stat(validatedPath, false);
    if (columns.length === 0) {
      throw uvException(-nts_errno(), "stat", validatedPath);
    }
    if (new Stats(columns).isDirectory()) {
      rmSyncValidated(validatedPath, {
        force: false,
        maxRetries: settings.maxRetries,
        recursive: true,
        retryDelay: settings.retryDelay,
      });
      return;
    }
  }
  check(nts_fs_rmdir(validatedPath), "rmdir", validatedPath);
}

export function mkdtempSync(prefix: BytePathLike): string;
export function mkdtempSync(
  prefix: BytePathLike,
  options: string | FileOptions | null,
): EncodedFileName;
export function mkdtempSync(
  prefix: BytePathLike,
  options?: string | FileOptions | null,
): EncodedFileName {
  const settings = getOptions(options);
  const validatedPrefix = getValidatedBytePath(prefix, "prefix");
  warnOnNonPortableTemplate(validatedPrefix);
  if (typeof validatedPrefix === "string") {
    const made = nts_fs_mkdtemp(`${validatedPrefix}XXXXXX`);
    checkErrno("mkdtemp", validatedPrefix);
    return encodeFileName(made, settings.encoding);
  }

  const made = nts_fs_mkdtemp_bytes(appendMkdtempSuffix(validatedPrefix));
  checkErrno("mkdtemp", Buffer.from(validatedPrefix).toString());
  return encodeFileBytes(made, settings.encoding);
}

/** The statically representable portion of Node's disposable temp directory. */
export interface DisposableTempDirectorySync {
  readonly path: string;
  readonly remove: () => void;
}

class DisposableTempDirectorySyncValue implements DisposableTempDirectorySync {
  readonly path: string;
  readonly remove: () => void;

  constructor(path: string, fullPath: string) {
    this.path = path;
    this.remove = () => rmSync(fullPath, { force: true, recursive: true });
  }
}

/**
 * Create a temp directory whose explicit cleanup remains correct after chdir.
 * Symbol.dispose belongs to the profile's runtime-Symbol non-goals; `remove`
 * is the ordinary typed cleanup operation.
 */
export function mkdtempDisposableSync(
  prefix: BytePathLike,
  options?: string | FileOptions | null,
): DisposableTempDirectorySync {
  const made = options === undefined
    ? mkdtempSync(prefix)
    : mkdtempSync(prefix, options);
  if (typeof made !== "string") {
    throw new ERR_INVALID_ARG_TYPE("path", "string", made);
  }
  return new DisposableTempDirectorySyncValue(made, resolvePath(made));
}

// ------------------------------------------------------------------- links

export function unlinkSync(path: PathLike): void {
  const validatedPath = getValidatedPath(path);
  check(nts_fs_unlink(validatedPath), "unlink", validatedPath);
}

export function renameSync(from: PathLike, to: PathLike): void {
  const validatedFrom = getValidatedPath(from, "oldPath");
  const validatedTo = getValidatedPath(to, "newPath");
  check(nts_fs_rename(validatedFrom, validatedTo), "rename", validatedFrom, validatedTo);
}

export function copyFileSync(
  from: PathLike,
  to: PathLike,
  mode: number | null = 0,
): void {
  const validatedFrom = getValidatedPath(from, "src");
  const validatedTo = getValidatedPath(to, "dest");
  check(
    nts_fs_copyfile(validatedFrom, validatedTo, validateAccessMode(mode)),
    "copyfile",
    validatedFrom,
    validatedTo,
  );
}

export function linkSync(from: PathLike, to: PathLike): void {
  const validatedFrom = getValidatedPath(from, "existingPath");
  const validatedTo = getValidatedPath(to, "newPath");
  check(nts_fs_link(validatedFrom, validatedTo), "link", validatedFrom, validatedTo);
}

export function symlinkSync(
  target: BytePathLike,
  at: BytePathLike,
  type?: SymlinkType,
): void {
  const flags = symlinkTypeFlags(type);
  const validatedTarget = getValidatedBytePath(target, "target");
  const validatedPath = getValidatedBytePath(at);
  const result = typeof validatedTarget === "string" && typeof validatedPath === "string"
    ? nts_fs_symlink(validatedTarget, validatedPath, flags)
    : nts_fs_symlink_bytes(
      bytePathForBinding(validatedTarget),
      bytePathForBinding(validatedPath),
      flags,
    );
  check(
    result,
    "symlink",
    displayBytePath(validatedTarget),
    displayBytePath(validatedPath),
  );
}

export function readlinkSync(path: PathLike): string;
export function readlinkSync(
  path: PathLike,
  options: string | FileOptions | null,
): EncodedFileName;
export function readlinkSync(
  path: PathLike,
  options?: string | FileOptions | null,
): EncodedFileName {
  const settings = getOptions(options);
  const validatedPath = getValidatedPath(path);
  const target = nts_fs_readlink(validatedPath);
  checkErrno("readlink", validatedPath);
  return encodeFileName(target, settings.encoding);
}

export function realpathSync(path: BytePathLike): string;
export function realpathSync(
  path: BytePathLike,
  options: string | FileOptions | null,
): EncodedFileName;
export function realpathSync(
  path: BytePathLike,
  options?: string | FileOptions | null,
): EncodedFileName {
  const settings = getOptions(options);
  let resolved = resolvePath(displayBytePath(getValidatedBytePath(path)));
  const knownHard = new Set<string>();
  const seenLinks = new Map<string, string>();
  let current = "/";
  let position = 1;

  while (position < resolved.length) {
    const separator = resolved.indexOf("/", position);
    const previous = current;
    let base: string;
    if (separator === -1) {
      const last = resolved.substring(position);
      current += last;
      base = previous + last;
      position = resolved.length;
    } else {
      current += resolved.substring(position, separator + 1);
      base = previous + resolved.substring(position, separator);
      position = separator + 1;
    }

    if (knownHard.has(base)) continue;
    const stats = lstatSync(base);
    if (!stats.isSymbolicLink()) {
      knownHard.add(base);
      if (stats.isFIFO() || stats.isSocket()) break;
      continue;
    }

    const linkId = `${stats.dev}:${stats.ino}`;
    let target = seenLinks.get(linkId);
    if (target === undefined) {
      // Node stats the target before reading the link so a dangling link
      // reports `stat`, not a later, less precise path error.
      statSync(base);
      target = readlinkSync(base);
      seenLinks.set(linkId, target);
    }
    resolved = resolvePath(previous, target, resolved.substring(position));
    current = "/";
    position = 1;
  }

  return encodeFileName(resolved, settings.encoding);
}

export function _realpathSyncNative(path: BytePathLike): string;
export function _realpathSyncNative(
  path: BytePathLike,
  options: string | FileOptions | null,
): EncodedFileName;
export function _realpathSyncNative(
  path: BytePathLike,
  options?: string | FileOptions | null,
): EncodedFileName {
  const settings = getOptions(options);
  const encoding = normalizeFileResultEncoding(settings.encoding);
  const validatedPath = getValidatedBytePath(path);
  if (typeof validatedPath === "string" && (encoding === undefined || encoding === "utf8")) {
    const resolved = nts_fs_realpath(validatedPath);
    checkErrno("realpath", validatedPath);
    return resolved;
  }

  const resolved = nts_fs_realpath_bytes(bytePathForBinding(validatedPath));
  checkErrno("realpath", displayBytePath(validatedPath));
  return encodeFileBytes(resolved, encoding);
}

// ------------------------------------------------------------- permissions

export function chmodSync(path: PathLike, mode: number | string): void {
  const validatedPath = getValidatedPath(path);
  check(
    nts_fs_chmod(validatedPath, parseFileMode(mode, "mode")),
    "chmod",
    validatedPath,
  );
}

export function chownSync(path: PathLike, uid: number, gid: number): void {
  const validatedPath = getValidatedPath(path);
  validateOwnerId(uid, "uid");
  validateOwnerId(gid, "gid");
  check(nts_fs_chown(validatedPath, uid, gid), "chown", validatedPath);
}

export function lchownSync(path: BytePathLike, uid: number, gid: number): void {
  const validatedPath = getValidatedBytePath(path);
  validateOwnerId(uid, "uid");
  validateOwnerId(gid, "gid");
  const result = typeof validatedPath === "string"
    ? nts_fs_lchown(validatedPath, uid, gid)
    : nts_fs_lchown_bytes(validatedPath, uid, gid);
  check(result, "lchown", displayBytePath(validatedPath));
}

export function truncateSync(path: BytePathLike, length = 0): void {
  const fd = openSync(path, "r+");
  try {
    ftruncateSync(fd, length);
  } finally {
    closeSync(fd);
  }
}

export function utimesSync(
  path: PathLike,
  atime: number | string | Date,
  mtime: number | string | Date,
): void {
  const validatedPath = getValidatedPath(path);
  check(
    nts_fs_utimes(
      validatedPath,
      toUnixTimestamp(atime, "atime"),
      toUnixTimestamp(mtime, "mtime"),
    ),
    "utime",
    validatedPath,
  );
}

export function lutimesSync(
  path: PathLike,
  atime: number | string | Date,
  mtime: number | string | Date,
): void {
  const validatedPath = getValidatedPath(path);
  check(
    nts_fs_lutimes(
      validatedPath,
      toUnixTimestamp(atime, "atime"),
      toUnixTimestamp(mtime, "mtime"),
    ),
    "lutime",
    validatedPath,
  );
}

/** Upstream `lib/fs.js`. `rm -r`, assembled here from the one-syscall bindings. */
export function rmSync(path: PathLike, options?: RmOptions): void {
  const validatedPath = getValidatedPath(path);
  rmSyncValidated(validatedPath, normalizeRmOptions(options));
}

/** Traverse with options that were validated once at the public boundary. */
function rmSyncValidated(validatedPath: string, options: NormalizedRmOptions): void {
  const columns = nts_fs_stat(validatedPath, false);
  if (columns.length === 0) {
    if (options.force) {
      return;
    }
    throw uvException(-nts_errno(), "stat", validatedPath);
  }

  const stats = new Stats(columns);
  if (!stats.isDirectory()) {
    check(nts_fs_unlink(validatedPath), "unlink", validatedPath);
    return;
  }
  if (!options.recursive) {
    const errno = nts_fs_eisdir();
    throw new ERR_FS_EISDIR(
      errno,
      errName(errno),
      errMessage(errno),
      validatedPath,
    );
  }
  for (const name of readdirSync(validatedPath)) {
    rmSyncValidated(`${validatedPath}/${name}`, options);
  }
  check(nts_fs_rmdir(validatedPath), "rmdir", validatedPath);
}
