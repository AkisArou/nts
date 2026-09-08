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
  _close as nts_fs_close,
  _open as nts_fs_open,
  _openBytes as nts_fs_open_bytes,
} from "./file-handle-binding.ts";
import {
  _fstatBigIntColumns as nts_fs_fstat_bigint,
  _fstatColumns as nts_fs_fstat,
  _statBigIntByteColumns as nts_fs_stat_bigint_bytes,
  _statBigIntColumns as nts_fs_stat_bigint,
  _statByteColumns as nts_fs_stat_bytes,
  _statColumns as nts_fs_stat,
} from "./stat-binding.ts";
import {
  bigintStatFs,
  BigIntStats,
  Dirent,
  numberStatFs,
  type StatFs,
  Stats,
  type StatOptions,
  type StatFsOptions,
  type StatSyncOptions,
} from "./stats.ts";
import * as constants from "./constants.ts";
import { flagsOf } from "./flags.ts";
import {
  dirname as dirnamePath,
  isAbsolute as isAbsolutePath,
  join as joinPath,
  resolve as resolvePath,
} from "../../path/src/posix.ts";
import {
  decodeScandirRows,
  normalizeReaddirOptions,
  type ReaddirOptions,
  type ReaddirResult,
} from "./readdir.ts";
import {
  direntFromStats,
  globSyncWithFileSystem,
  type GlobOptions,
  type GlobPatternInput,
  type SyncGlobFileSystem,
} from "./glob.ts";
import {
  bufferLengths,
  fillBuffers,
  flattenBuffers,
  validateBufferArray,
  vectorPosition,
} from "./vector-io.ts";
import { normalizeReadPosition } from "./read-position.ts";
import {
  cpInvalidPath,
  cpStatsAreIdentical,
  CpSystemError,
  isSrcSubdir,
  normalizeCpOptions,
  synchronousFilterAllows,
  type CopySyncOptions,
  type NormalizedCpOptions,
} from "./cp-common.ts";
import {
  appendMkdtempSuffix,
  bytePathForBinding,
  displayBytePath,
  encodeFileBytes,
  encodeFileName,
  encodeNormalizedFileBytes,
  emitRecursiveRmdirWarning,
  getOptions,
  getReadFileBuffer,
  getReadFileOptions,
  bothPathsAsBytes,
  getValidatedBytePath,
  getValidatedPath,
  normalizeRmOptions,
  normalizeRmdirOptions,
  normalizeFileResultEncoding,
  readFileBufferByteLengthName,
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
  type ReadFileOptions,
  type RmdirOptions,
  type RmOptions,
  type SymlinkType,
} from "./options.ts";

export { Stats, Dirent, constants };
export type { BigIntStats } from "./stats.ts";
export { BigIntStats as _BigIntStats } from "./stats.ts";
export type { ReadFileBuffer, ReadFileOptions, RmdirOptions, RmOptions } from "./options.ts";
export { Dir, opendir, opendirSync } from "./dir.ts";
export type { OpenDirOptions } from "./dir.ts";
export { flagsOf } from "./flags.ts";
export { toUnixTimestamp as _toUnixTimestamp } from "./options.ts";
export { openAsBlob } from "./blob.ts";
export type { OpenAsBlobOptions } from "./blob.ts";

// The callback surface, which shares this module's argument handling and its
// errors: the work is the same system call and only the route back differs.
export {
  access, appendFile, chmod, chown, close, copyFile, cp, exists, fdatasync, fstat, glob,
  fsync, ftruncate, lchown, link, lstat, mkdir, mkdtemp, open, read, readFile, readdir,
  readlink, realpath, rename, rm, rmdir, stat, symlink, truncate, unlink,
  utimes, lutimes, write, writeFile, writev, readv, fchmod, fchown, futimes,
  statfs, _realpathNative,
} from "./async.ts";

// `fs.promises` and `node:fs/promises` are the same object.
export * as promises from "./promises.ts";
export type { CopyOptions, CopySyncOptions } from "./cp-common.ts";
export type { GlobExclude, GlobOptions, GlobPatternInput } from "./glob.ts";

export { ReadStream, WriteStream, createReadStream, createWriteStream } from "./streams.ts";
export { Utf8Stream } from "./utf8-stream.ts";
export type { Utf8StreamOptions } from "./utf8-stream.ts";
export { watch, watchFile, unwatchFile } from "./watchers.ts";
export type {
  BigIntStatsListener,
  StatsListener,
  WatchFileOptions,
} from "./watchers.ts";

/** Named arguments accepted by the current `readSync` overload. */
export interface ReadOptions {
  offset?: number | undefined;
  length?: number | undefined;
  position?: number | bigint | null | undefined;
}

type ReadSyncArguments =
  | [options?: ReadOptions | null]
  | [offset: number | undefined, length?: number, position?: unknown];

/** Named arguments accepted by the current `writeSync` overload. */
export interface WriteOptions {
  offset?: number | undefined;
  length?: number | undefined;
  position?: number | null | undefined;
}

// -------------------------------------------------------------- the bindings

declare function nts_fs_statfs(path: string): number[];
declare function nts_fs_statfs_bytes(path: number[]): number[];
declare function nts_fs_statfs_bigint(path: string): string[];
declare function nts_fs_statfs_bigint_bytes(path: number[]): string[];
declare function nts_fs_read_file_bytes_fd(fd: number, expectedSize: number): number[];
declare function nts_fs_read_file_utf8_fd(fd: number): string;
declare function nts_fs_write_file_utf8_fd(fd: number, contents: string): number;
declare function nts_fs_write_file_bytes_fd(
  fd: number, bytes: number[],
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
declare function nts_fs_unlink_bytes(path: number[]): number;
declare function nts_fs_mkdir_bytes(path: number[], mode: number): number;
declare function nts_fs_rmdir_bytes(path: number[]): number;
declare function nts_fs_chmod_bytes(path: number[], mode: number): number;
declare function nts_fs_chown_bytes(path: number[], uid: number, gid: number): number;
declare function nts_fs_utimes_bytes(path: number[], atime: number, mtime: number): number;
declare function nts_fs_lutimes_bytes(path: number[], atime: number, mtime: number): number;
declare function nts_fs_rename_bytes(from: number[], to: number[]): number;
declare function nts_fs_copyfile_bytes(from: number[], to: number[], flags: number): number;
declare function nts_fs_link_bytes(from: number[], to: number[]): number;
declare function nts_fs_readlink_bytes(path: number[]): number[];
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
declare function nts_fs_is_32_bit(): boolean;
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
  ...given: ReadSyncArguments
): number {
  if (!(buffer instanceof Uint8Array)) {
    throw new ERR_INVALID_ARG_TYPE("buffer", ["Buffer", "TypedArray", "DataView"], buffer);
  }

  let offset: number;
  let length: number;
  let position: unknown;
  const offsetOrOptions = given[0];
  const suppliedLength = given.length > 1 ? given[1] : undefined;
  const suppliedPosition = given.length > 2 ? given[2] : undefined;
  if (given.length <= 1 || typeof offsetOrOptions === "object") {
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
/** Legacy spelling used by Node's own internal UTF-8 writer. */
export function writeSync(
  fd: number,
  data: string,
  encoding?: string | null,
): number;
export function writeSync(
  fd: number,
  data: Buffer | Uint8Array | string,
  offsetOrOptions: number | string | WriteOptions | null = null,
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
    const encodingName = typeof lengthOrEncoding === "string"
      ? lengthOrEncoding
      : (typeof offsetOrOptions === "string" ? offsetOrOptions : "utf8");
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
    at = typeof offsetOrOptions === "string" ? null : offsetOrOptions;
  } else if (typeof offsetOrOptions === "object") {
    if (offsetOrOptions !== null) validateObject(offsetOrOptions, "options");
    start = offsetOrOptions?.offset ?? 0;
    count = offsetOrOptions?.length ?? buffer.length - start;
    at = offsetOrOptions?.position ?? null;
    validateInteger(start, "offset", 0);
    validateWriteBounds(start, count, buffer.length);
  } else {
    if (typeof offsetOrOptions === "string") {
      throw new ERR_INVALID_ARG_TYPE("offset", "integer", offsetOrOptions);
    }
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

export function existsSync(path: BytePathLike): boolean;
export function existsSync(path: unknown): boolean {
  let validatedPath: string | number[];
  try {
    validatedPath = getValidatedBytePath(path);
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
  return typeof validatedPath === "string"
    ? nts_fs_stat(validatedPath, true).length > 0
    : nts_fs_stat_bytes(validatedPath, true).length > 0;
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
export function readFileSync(path: BytePathLike | number, options?: null): Buffer;
export function readFileSync(
  path: BytePathLike | number,
  options: string | ReadFileOptions,
): string | Buffer;
export function readFileSync(
  path: BytePathLike | number,
  options?: string | ReadFileOptions | null,
): string | Buffer {
  const settings = getReadFileOptions(options);
  const ownsDescriptor = typeof path !== "number";
  const fd = ownsDescriptor
    ? openSync(path, settings.flag ?? "r", 0o666)
    : path;
  if (!ownsDescriptor) validateFileDescriptor(fd);

  try {
    // Node's exact-UTF-8 path reads fixed chunks directly, without allocating
    // a byte result or issuing the fstat needed to size one.
    if (
      settings.buffer === undefined &&
      (settings.encoding === "utf8" || settings.encoding === "utf-8")
    ) {
      const text = nts_fs_read_file_utf8_fd(fd);
      checkErrno("read");
      return text;
    }

    const stats = fstatSync(fd);
    const size = stats.isFile() ? stats.size : 0;
    if (size > 2 ** 31 - 1) throw new ERR_FS_FILE_TOO_LARGE(size);

    const supplied = getReadFileBuffer(settings, size);
    if (supplied !== undefined) {
      let position = 0;
      if (size > 0) {
        while (position < size) {
          const bytesRead = readSync(
            fd,
            supplied,
            position,
            size - position,
            null,
          );
          position += bytesRead;
          if (bytesRead === 0) break;
        }
      } else {
        while (position < supplied.byteLength) {
          const bytesRead = readSync(
            fd,
            supplied,
            position,
            supplied.byteLength - position,
            null,
          );
          position += bytesRead;
          if (bytesRead === 0) break;
        }
        if (position === supplied.byteLength) {
          const overflow = Buffer.allocUnsafeSlow(1);
          if (readSync(fd, overflow, 0, 1, null) !== 0) {
            throw new ERR_INVALID_ARG_VALUE(
              readFileBufferByteLengthName(settings),
              supplied.byteLength,
              "is too small to contain the entire file",
            );
          }
        }
      }

      const contents = supplied.subarray(0, position);
      if (!settings.encoding) return contents;
      return contents.toString(requireTextEncoding(settings.encoding, "options.encoding"));
    }

    // The native reader still handles growth and unknown-size files, but the
    // regular-file stat avoids repeated reallocations on the common path.
    const bytes = nts_fs_read_file_bytes_fd(fd, size);
    checkErrno("read");
    const contents = Buffer.from(bytes);
    if (!settings.encoding) return contents;
    return contents.toString(requireTextEncoding(settings.encoding, "options.encoding"));
  } finally {
    if (ownsDescriptor) closeSync(fd);
  }
}

export function writeFileSync(
  path: BytePathLike | number,
  data: string | ArrayBufferView,
  options?: string | FileOptions,
): void {
  const settings = getOptions(options, { encoding: "utf8", mode: 0o666, flag: "w" });
  const flag = settings.flag || "w";
  const flush = settings.flush ?? false;
  validateBoolean(flush, "options.flush");

  if (typeof data !== "string" && !ArrayBuffer.isView(data)) {
    throw new ERR_INVALID_ARG_TYPE(
      "data",
      ["string", "Buffer", "TypedArray", "DataView"],
      data,
    );
  }

  const usesUtf8FastPath = typeof data === "string" &&
    (settings.encoding === "utf8" || settings.encoding === "utf-8");
  let payload: string | number[];
  if (typeof data === "string") {
    const encoding = requireTextEncoding(settings.encoding || "utf8", "options.encoding");
    payload = usesUtf8FastPath
      ? data
      : Array.from(Buffer.from(data, encoding));
  } else {
    // After `getOptions` has validated the option, encoding applies only when
    // text has to be converted. An existing view is copied byte-for-byte.
    payload = Array.from(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }

  // Keep descriptor ownership and every failure stage visible here. A combined
  // open/write/close binding cannot tell `uvException` which syscall failed,
  // and a side-channel for that tag would make an otherwise synchronous
  // result depend on hidden native state.
  let ownsDescriptor = false;
  let fd: number;
  if (typeof path === "number") {
    // Node's UTF-8 binding evaluates these arguments even for a caller-owned
    // descriptor. Its ordinary byte path does not consult either option.
    if (usesUtf8FastPath) {
      flagsOf(flag);
      parseFileMode(settings.mode, "mode", 0o666);
    }
    validateFileDescriptor(path);
    fd = path;
  } else {
    const validatedPath = getValidatedBytePath(path);
    const flags = flagsOf(flag);
    const mode = parseFileMode(settings.mode, "mode", 0o666);
    fd = typeof validatedPath === "string"
      ? nts_fs_open(validatedPath, flags, mode)
      : nts_fs_open_bytes(validatedPath, flags, mode);
    check(fd, "open", displayBytePath(validatedPath));
    ownsDescriptor = true;
  }

  try {
    const result = typeof payload === "string"
      ? nts_fs_write_file_utf8_fd(fd, payload)
      : nts_fs_write_file_bytes_fd(fd, payload);
    check(result, "write");
    if (flush) fsyncSync(fd);
  } finally {
    if (ownsDescriptor) closeSync(fd);
  }
}

export function appendFileSync(
  path: BytePathLike | number,
  data: string | ArrayBufferView,
  options?: string | FileOptions,
): void {
  const settings = getOptions(options, { encoding: "utf8", mode: 0o666, flag: "a" });
  writeFileSync(path, data, {
    ...settings,
    flag: typeof path === "number" ? "a" : (settings.flag || "a"),
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
  options: ReaddirOptions & { encoding: "utf8"; withFileTypes: true },
): Dirent[];
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

class PublicSyncGlobFileSystem implements SyncGlobFileSystem {
  lstat(path: string): Dirent | null {
    try {
      return direntFromStats(path, lstatSync(path));
    } catch {
      return null;
    }
  }

  stat(path: string): Stats | null {
    try {
      return statSync(path);
    } catch {
      return null;
    }
  }

  readdir(path: string): Dirent[] {
    try {
      return readdirSync(path, { encoding: "utf8", withFileTypes: true });
    } catch {
      return [];
    }
  }

  realpath(path: string): string | null {
    try {
      return realpathSync(path);
    } catch {
      return null;
    }
  }
}

const publicSyncGlobFileSystem = new PublicSyncGlobFileSystem();

export function globSync(
  pattern: GlobPatternInput,
  options: GlobOptions & { withFileTypes: true },
): Dirent[];
export function globSync(pattern: GlobPatternInput, options?: GlobOptions): string[];
export function globSync(
  pattern: GlobPatternInput,
  options: GlobOptions,
): Array<string | Dirent>;
export function globSync(pattern: unknown, options?: unknown): Array<string | Dirent> {
  return globSyncWithFileSystem(pattern, options, publicSyncGlobFileSystem);
}

export interface MkdirOptions {
  recursive?: boolean;
  mode?: number | string;
}

/**
 * `mkdir` on a path that is bytes rather than text.
 *
 * The recursive walk splits on the byte `0x2f` rather than on a string `"/"`,
 * because the components either side of a separator need not decode as UTF-8
 * and re-encoding them would create a directory with a different name than the
 * caller asked for. The *return* value is still a string: node answers the first
 * created path as a string even when it was given a Buffer, which was read off
 * node rather than assumed.
 */
function mkdirBytes(
  path: number[],
  options?: number | string | MkdirOptions,
): string | undefined {
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
    check(nts_fs_mkdir_bytes(path, mode), "mkdir", displayBytePath(path));
    return undefined;
  }

  const SLASH = 0x2f;
  const prefix: number[] = [];
  let finalResult = 0;
  let firstCreated: string | undefined;
  let index = 0;
  while (index < path.length) {
    if (path[index] === SLASH) {
      prefix.push(SLASH);
      index++;
      continue;
    }
    while (index < path.length && path[index] !== SLASH) {
      prefix.push(path[index] ?? 0);
      index++;
    }
    const result = nts_fs_mkdir_bytes(prefix.slice(), mode);
    finalResult = result;
    if (result === 0 && firstCreated === undefined) {
      firstCreated = displayBytePath(prefix.slice());
    }
    // -17 is EEXIST: a component already there is not an error for a recursive
    // make, exactly as in the string path above.
    if (result < 0 && result !== -17) {
      check(result, "mkdir", displayBytePath(prefix.slice()));
    }
  }
  if (finalResult < 0 && finalResult !== -17) {
    check(finalResult, "mkdir", displayBytePath(path));
  }
  return firstCreated;
}

export function mkdirSync(
  path: BytePathLike,
  options?: number | string | MkdirOptions,
): string | undefined {
  const validated = getValidatedBytePath(path);
  if (typeof validated !== "string") return mkdirBytes(validated, options);
  const validatedPath = validated;
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

export function rmdirSync(path: BytePathLike, options?: RmdirOptions): void {
  const validatedPath = getValidatedBytePath(path);
  const settings = normalizeRmdirOptions(options);
  const asBytes = typeof validatedPath === "string" ? undefined : validatedPath;
  if (settings.recursive) {
    emitRecursiveRmdirWarning();
    const columns = asBytes === undefined
      ? nts_fs_stat(validatedPath as string, false)
      : nts_fs_stat_bytes(asBytes, false);
    if (columns.length === 0) {
      throw uvException(-nts_errno(), "stat", displayBytePath(validatedPath));
    }
    if (new Stats(columns).isDirectory()) {
      const recursiveOptions = {
        force: false,
        maxRetries: settings.maxRetries,
        recursive: true,
        retryDelay: settings.retryDelay,
      };
      if (asBytes === undefined) {
        rmSyncValidated(validatedPath as string, recursiveOptions);
      } else {
        rmSyncValidatedBytes(asBytes, recursiveOptions);
      }
      return;
    }
  }
  const result = asBytes === undefined
    ? nts_fs_rmdir(validatedPath as string)
    : nts_fs_rmdir_bytes(asBytes);
  check(result, "rmdir", displayBytePath(validatedPath));
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

/** A disposable temporary directory. */
export interface DisposableTempDirectorySync {
  readonly path: string;
  readonly remove: () => void;
  [Symbol.dispose](): void;
}

class DisposableTempDirectorySyncValue implements DisposableTempDirectorySync {
  readonly path: string;
  readonly remove: () => void;

  constructor(path: string, fullPath: string) {
    this.path = path;
    this.remove = () => rmSync(fullPath, { force: true, recursive: true });
  }

  [Symbol.dispose](): void {
    this.remove();
  }
}

/** Create a disposable temp directory whose cleanup remains correct after chdir. */
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

export function unlinkSync(path: BytePathLike): void {
  const validatedPath = getValidatedBytePath(path);
  const result = typeof validatedPath === "string"
    ? nts_fs_unlink(validatedPath)
    : nts_fs_unlink_bytes(validatedPath);
  check(result, "unlink", displayBytePath(validatedPath));
}

export function renameSync(from: BytePathLike, to: BytePathLike): void {
  const validatedFrom = getValidatedBytePath(from, "oldPath");
  const validatedTo = getValidatedBytePath(to, "newPath");
  const asBytes = bothPathsAsBytes(validatedFrom, validatedTo);
  const result = asBytes === null
    ? nts_fs_rename(validatedFrom as string, validatedTo as string)
    : nts_fs_rename_bytes(asBytes[0], asBytes[1]);
  check(result, "rename", displayBytePath(validatedFrom), displayBytePath(validatedTo));
}

export function copyFileSync(
  from: BytePathLike,
  to: BytePathLike,
  mode: number | null = 0,
): void {
  const validatedFrom = getValidatedBytePath(from, "src");
  const validatedTo = getValidatedBytePath(to, "dest");
  const flags = validateAccessMode(mode);
  const asBytes = bothPathsAsBytes(validatedFrom, validatedTo);
  const result = asBytes === null
    ? nts_fs_copyfile(validatedFrom as string, validatedTo as string, flags)
    : nts_fs_copyfile_bytes(asBytes[0], asBytes[1], flags);
  check(result, "copyfile", displayBytePath(validatedFrom), displayBytePath(validatedTo));
}

export function linkSync(from: BytePathLike, to: BytePathLike): void {
  const validatedFrom = getValidatedBytePath(from, "existingPath");
  const validatedTo = getValidatedBytePath(to, "newPath");
  const asBytes = bothPathsAsBytes(validatedFrom, validatedTo);
  const result = asBytes === null
    ? nts_fs_link(validatedFrom as string, validatedTo as string)
    : nts_fs_link_bytes(asBytes[0], asBytes[1]);
  check(result, "link", displayBytePath(validatedFrom), displayBytePath(validatedTo));
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

export function readlinkSync(path: BytePathLike): string;
export function readlinkSync(
  path: BytePathLike,
  options: string | FileOptions | null,
): EncodedFileName;
export function readlinkSync(
  path: BytePathLike,
  options?: string | FileOptions | null,
): EncodedFileName {
  const settings = getOptions(options);
  const validatedPath = getValidatedBytePath(path);
  // The byte path answers the target as bytes as well. A symlink target is no
  // more required to decode as UTF-8 than a filename is, so reading one back
  // through the string binding would flatten it to replacement characters
  // before the caller could ask for a Buffer.
  if (typeof validatedPath !== "string") {
    const bytes = nts_fs_readlink_bytes(validatedPath);
    checkErrno("readlink", displayBytePath(validatedPath));
    return encodeNormalizedFileBytes(
      bytes,
      normalizeFileResultEncoding(settings.encoding),
    );
  }
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

export function chmodSync(path: BytePathLike, mode: number | string): void {
  const validatedPath = getValidatedBytePath(path);
  const parsed = parseFileMode(mode, "mode");
  const result = typeof validatedPath === "string"
    ? nts_fs_chmod(validatedPath, parsed)
    : nts_fs_chmod_bytes(validatedPath, parsed);
  check(result, "chmod", displayBytePath(validatedPath));
}

export function chownSync(path: BytePathLike, uid: number, gid: number): void {
  const validatedPath = getValidatedBytePath(path);
  validateOwnerId(uid, "uid");
  validateOwnerId(gid, "gid");
  const result = typeof validatedPath === "string"
    ? nts_fs_chown(validatedPath, uid, gid)
    : nts_fs_chown_bytes(validatedPath, uid, gid);
  check(result, "chown", displayBytePath(validatedPath));
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
  path: BytePathLike,
  atime: number | string | Date,
  mtime: number | string | Date,
): void {
  const validatedPath = getValidatedBytePath(path);
  const at = toUnixTimestamp(atime, "atime");
  const mt = toUnixTimestamp(mtime, "mtime");
  const result = typeof validatedPath === "string"
    ? nts_fs_utimes(validatedPath, at, mt)
    : nts_fs_utimes_bytes(validatedPath, at, mt);
  check(result, "utime", displayBytePath(validatedPath));
}

export function lutimesSync(
  path: BytePathLike,
  atime: number | string | Date,
  mtime: number | string | Date,
): void {
  const validatedPath = getValidatedBytePath(path);
  const at = toUnixTimestamp(atime, "atime");
  const mt = toUnixTimestamp(mtime, "mtime");
  const result = typeof validatedPath === "string"
    ? nts_fs_lutimes(validatedPath, at, mt)
    : nts_fs_lutimes_bytes(validatedPath, at, mt);
  check(result, "lutime", displayBytePath(validatedPath));
}

function cpStatSync(
  path: string,
  options: NormalizedCpOptions,
): Stats | undefined {
  const statOptions: StatSyncOptions & {
    bigint: false;
    throwIfNoEntry: false;
  } = {
    bigint: false,
    throwIfNoEntry: false,
  };
  return options.dereference
    ? statSync(path, statOptions)
    : lstatSync(path, statOptions);
}

function cpBigIntStatSync(
  path: string,
  options: NormalizedCpOptions,
): BigIntStats | undefined {
  const statOptions: StatSyncOptions & {
    bigint: true;
    throwIfNoEntry: false;
  } = {
    bigint: true,
    throwIfNoEntry: false,
  };
  return options.dereference
    ? statSync(path, statOptions)
    : lstatSync(path, statOptions);
}

function checkCpPathKinds(
  source: BigIntStats,
  destination: BigIntStats,
  sourcePath: string,
  destinationPath: string,
): void {
  if (cpStatsAreIdentical(source, destination)) {
    throw cpInvalidPath("src and dest cannot be the same", destinationPath);
  }
  if (source.isDirectory() && !destination.isDirectory()) {
    throw new CpSystemError(
      "ERR_FS_CP_DIR_TO_NON_DIR",
      "EISDIR",
      `cannot overwrite non-directory ${destinationPath} with directory ${sourcePath}`,
      destinationPath,
    );
  }
  if (!source.isDirectory() && destination.isDirectory()) {
    throw new CpSystemError(
      "ERR_FS_CP_NON_DIR_TO_DIR",
      "ENOTDIR",
      `cannot overwrite directory ${destinationPath} with non-directory ${sourcePath}`,
      destinationPath,
    );
  }
}

function checkCpParentPathsSync(
  sourcePath: string,
  source: BigIntStats,
  destinationPath: string,
): void {
  const sourceParent = resolvePath(dirnamePath(sourcePath));
  let destinationParent = resolvePath(dirnamePath(destinationPath));
  while (
    destinationParent !== sourceParent &&
    destinationParent !== dirnamePath(destinationParent)
  ) {
    const parent = statSync(destinationParent, {
      bigint: true,
      throwIfNoEntry: false,
    });
    if (parent === undefined) return;
    if (cpStatsAreIdentical(source, parent)) {
      throw cpInvalidPath(
        `cannot copy ${sourcePath} to a subdirectory of self ${destinationPath}`,
        destinationPath,
      );
    }
    destinationParent = dirnamePath(destinationParent);
  }
}

function checkCpPathsSync(
  sourcePath: string,
  destinationPath: string,
  options: NormalizedCpOptions,
): void {
  const source = cpBigIntStatSync(sourcePath, options);
  if (source === undefined) {
    // The source stat is never optional in Node. Repeat through the throwing
    // overload so the original syscall code and path are retained.
    if (options.dereference) statSync(sourcePath);
    else lstatSync(sourcePath);
    throw new Error("fs cp source stat completed without metadata");
  }
  const destination = cpBigIntStatSync(destinationPath, options);
  if (destination !== undefined) {
    checkCpPathKinds(source, destination, sourcePath, destinationPath);
  }
  if (source.isDirectory() && isSrcSubdir(sourcePath, destinationPath)) {
    throw cpInvalidPath(
      `cannot copy ${sourcePath} to a subdirectory of self ${destinationPath}`,
      destinationPath,
    );
  }
  checkCpParentPathsSync(sourcePath, source, destinationPath);
  if (source.isDirectory() && !options.recursive) {
    throw new CpSystemError(
      "ERR_FS_EISDIR",
      "EISDIR",
      `${sourcePath} is a directory (not copied)`,
      sourcePath,
    );
  }
  if (source.isSocket()) {
    throw new CpSystemError(
      "ERR_FS_CP_SOCKET",
      "EINVAL",
      `cannot copy a socket file: ${destinationPath}`,
      destinationPath,
    );
  }
  if (source.isFIFO()) {
    throw new CpSystemError(
      "ERR_FS_CP_FIFO_PIPE",
      "EINVAL",
      `cannot copy a FIFO pipe: ${destinationPath}`,
      destinationPath,
    );
  }
}

function ensureCpParentSync(destinationPath: string): void {
  const parent = dirnamePath(destinationPath);
  if (statSync(parent, { throwIfNoEntry: false }) === undefined) {
    mkdirSync(parent, { recursive: true });
  }
}

function setCpDestinationMode(destinationPath: string, sourceMode: number): void {
  chmodSync(destinationPath, sourceMode);
}

function setCpDestinationTimestamps(
  sourcePath: string,
  destinationPath: string,
): void {
  // Copying may update atime, so Node deliberately stats the source again.
  const updatedSource = statSync(sourcePath);
  utimesSync(destinationPath, updatedSource.atime, updatedSource.mtime);
}

function copyCpFileSync(
  source: Stats,
  sourcePath: string,
  destinationPath: string,
  options: NormalizedCpOptions,
): void {
  copyFileSync(sourcePath, destinationPath, options.mode);
  if (options.preserveTimestamps) {
    if ((source.mode & 0o200) === 0) {
      setCpDestinationMode(destinationPath, source.mode | 0o200);
    }
    setCpDestinationTimestamps(sourcePath, destinationPath);
  }
  setCpDestinationMode(destinationPath, source.mode);
}

function onCpFileSync(
  source: Stats,
  destination: Stats | undefined,
  sourcePath: string,
  destinationPath: string,
  options: NormalizedCpOptions,
): void {
  if (destination === undefined) {
    copyCpFileSync(source, sourcePath, destinationPath, options);
    return;
  }
  if (options.force) {
    unlinkSync(destinationPath);
    copyCpFileSync(source, sourcePath, destinationPath, options);
    return;
  }
  if (options.errorOnExist) {
    throw new CpSystemError(
      "ERR_FS_CP_EEXIST",
      "EEXIST",
      `${destinationPath} already exists`,
      destinationPath,
    );
  }
}

function onCpDirectorySync(
  source: Stats,
  destination: Stats | undefined,
  sourcePath: string,
  destinationPath: string,
  options: NormalizedCpOptions,
): void {
  const made = destination === undefined;
  if (made) {
    mkdirSync(destinationPath);
  } else if (options.errorOnExist && !options.force) {
    throw new CpSystemError(
      "ERR_FS_CP_EEXIST",
      "EEXIST",
      `${destinationPath} already exists`,
      destinationPath,
    );
  }
  for (const name of readdirSync(sourcePath)) {
    copyCpEntrySync(
      joinPath(sourcePath, name),
      joinPath(destinationPath, name),
      options,
    );
  }
  if (made) setCpDestinationMode(destinationPath, source.mode);
}

function onCpLinkSync(
  destination: Stats | undefined,
  sourcePath: string,
  destinationPath: string,
  options: NormalizedCpOptions,
): void {
  let resolvedSource = readlinkSync(sourcePath);
  if (!options.verbatimSymlinks && !isAbsolutePath(resolvedSource)) {
    resolvedSource = resolvePath(dirnamePath(sourcePath), resolvedSource);
  }
  if (destination === undefined) {
    symlinkSync(resolvedSource, destinationPath);
    return;
  }

  let resolvedDestination: string;
  try {
    resolvedDestination = readlinkSync(destinationPath);
  } catch (error) {
    if (hasErrorCode(error, "EINVAL") || hasErrorCode(error, "UNKNOWN")) {
      symlinkSync(resolvedSource, destinationPath);
      return;
    }
    throw error;
  }
  if (!isAbsolutePath(resolvedDestination)) {
    resolvedDestination = resolvePath(
      dirnamePath(destinationPath),
      resolvedDestination,
    );
  }
  if (
    statSync(sourcePath).isDirectory() &&
    isSrcSubdir(resolvedSource, resolvedDestination)
  ) {
    throw cpInvalidPath(
      `cannot copy ${resolvedSource} to a subdirectory of self ${resolvedDestination}`,
      destinationPath,
    );
  }
  if (
    statSync(destinationPath).isDirectory() &&
    isSrcSubdir(resolvedDestination, resolvedSource)
  ) {
    throw new CpSystemError(
      "ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY",
      "EINVAL",
      `cannot overwrite ${resolvedDestination} with ${resolvedSource}`,
      destinationPath,
    );
  }
  unlinkSync(destinationPath);
  symlinkSync(resolvedSource, destinationPath);
}

function copyCpEntrySync(
  sourcePath: string,
  destinationPath: string,
  options: NormalizedCpOptions,
): void {
  if (!synchronousFilterAllows(options.filter, sourcePath, destinationPath)) {
    return;
  }
  checkCpPathsSync(sourcePath, destinationPath, options);
  ensureCpParentSync(destinationPath);
  const source = cpStatSync(sourcePath, options);
  if (source === undefined) {
    throw new Error("fs cp source stat completed without metadata");
  }
  const destination = cpStatSync(destinationPath, options);
  if (source.isDirectory()) {
    onCpDirectorySync(source, destination, sourcePath, destinationPath, options);
  } else if (
    source.isFile() || source.isCharacterDevice() || source.isBlockDevice()
  ) {
    onCpFileSync(source, destination, sourcePath, destinationPath, options);
  } else if (source.isSymbolicLink()) {
    onCpLinkSync(destination, sourcePath, destinationPath, options);
  } else {
    throw new CpSystemError(
      "ERR_FS_CP_UNKNOWN",
      "EINVAL",
      `cannot copy an unknown file type: ${destinationPath}`,
      destinationPath,
    );
  }
}

/** Upstream `fs.cpSync`, using the same primitives as the rest of this module. */
export function cpSync(
  source: PathLike,
  destination: PathLike,
  options?: CopySyncOptions,
): void;
export function cpSync(
  source: unknown,
  destination: unknown,
  options?: unknown,
): void {
  const settings = normalizeCpOptions(options);
  const sourcePath = getValidatedPath(source, "src");
  const destinationPath = getValidatedPath(destination, "dest");
  if (settings.preserveTimestamps && nts_fs_is_32_bit()) {
    emitWarning(
      "Using the preserveTimestamps option in 32-bit node is not recommended",
      "TimestampPrecisionWarning",
      "",
    );
  }
  copyCpEntrySync(sourcePath, destinationPath, settings);
}

/** Upstream `lib/fs.js`. `rm -r`, assembled here from the one-syscall bindings. */
export function rmSync(path: BytePathLike, options?: RmOptions): void {
  const validatedPath = getValidatedBytePath(path);
  const settings = normalizeRmOptions(options);
  if (typeof validatedPath === "string") {
    rmSyncValidated(validatedPath, settings);
    return;
  }
  rmSyncValidatedBytes(validatedPath, settings);
}

/**
 * Raw export for Node's `internal/fs/utils.validateRmOptionsSync` fixture.
 *
 * Public `rmSync` performs the same checks inline. Keeping this entry explicit
 * lets the upstream mixed public/internal test observe our validator without
 * making a private helper part of the `node:fs` object.
 */
export function _validateRmOptionsSync(
  path: BytePathLike,
  options?: RmOptions,
  expectDirectory = false,
): NormalizedRmOptions | false {
  const settings = normalizeRmOptions(options);
  if (!settings.force || expectDirectory || !settings.recursive) {
    const stats = lstatSync(path, { throwIfNoEntry: !settings.force });
    const isDirectory = stats?.isDirectory() === true;
    if (expectDirectory && !isDirectory) return false;
    if (isDirectory && !settings.recursive) {
      const validatedPath = getValidatedBytePath(path);
      const displayPath = displayBytePath(validatedPath);
      const errno = nts_fs_eisdir();
      throw new ERR_FS_EISDIR(
        errno,
        errName(errno),
        errMessage(errno),
        displayPath,
      );
    }
  }
  return settings;
}

/** Traverse with options that were validated once at the public boundary. */
/**
 * `rm` on a path that is bytes rather than text.
 *
 * The string version above joins children with a template literal, which cannot
 * be used here: a directory entry need not decode as UTF-8, and building the
 * child path through a string would ask the kernel to remove a *different* file
 * than the one `readdir` just reported. So children are joined as bytes, and the
 * entry names come from `nts_fs_scandir_bytes` rather than from `readdirSync`.
 *
 * `displayBytePath` is still used for the error paths, because an exception's
 * `path` property is a string on node too -- lossy there and lossy here, and
 * that is node's answer rather than a shortcut.
 */
function rmSyncValidatedBytes(path: number[], options: NormalizedRmOptions): void {
  const columns = nts_fs_stat_bytes(path, false);
  if (columns.length === 0) {
    const errno = -nts_errno();
    const code = errName(errno);
    if (options.force && (code === "ENOENT" || code === "ENOTDIR")) {
      return;
    }
    throw uvException(errno, "lstat", displayBytePath(path));
  }

  const stats = new Stats(columns);
  if (!stats.isDirectory()) {
    check(nts_fs_unlink_bytes(path), "unlink", displayBytePath(path));
    return;
  }
  if (!options.recursive) {
    const errno = nts_fs_eisdir();
    throw new ERR_FS_EISDIR(errno, errName(errno), errMessage(errno), displayBytePath(path));
  }
  const rows = nts_fs_scandir_bytes(path);
  for (const row of rows) {
    if (row === undefined || row.length < 2) continue;
    const child = path.slice();
    child.push(0x2f);
    for (let index = 1; index < row.length; index++) {
      child.push(row[index] ?? 0);
    }
    rmSyncValidatedBytes(child, options);
  }
  check(nts_fs_rmdir_bytes(path), "rmdir", displayBytePath(path));
}

function rmSyncValidated(validatedPath: string, options: NormalizedRmOptions): void {
  const columns = nts_fs_stat(validatedPath, false);
  if (columns.length === 0) {
    const errno = -nts_errno();
    const code = errName(errno);
    if (options.force && (code === "ENOENT" || code === "ENOTDIR")) {
      return;
    }
    throw uvException(errno, "lstat", validatedPath);
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
