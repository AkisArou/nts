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

import {
  AbortError,
  aggregateTwoErrors,
  ERR_FS_EISDIR,
  ERR_FS_FILE_TOO_LARGE,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_OUT_OF_RANGE,
} from "../../internal/errors.ts";
import {
  parseFileMode,
  validateAbortSignal,
  validateBoolean,
  validateFunction,
  validateInteger,
  validateObject,
} from "../../internal/validators.ts";
import { errMessage, errName, uvException } from "../../internal/uv.ts";
import { Buffer } from "../../buffer/src/main.ts";
import {
  bigintStatFs,
  BigIntStats,
  Dirent,
  numberStatFs,
  type StatOptions,
  type StatFs,
  type StatFsOptions,
  type StatSyncOptions,
  Stats,
} from "./stats.ts";
import {
  direntFromStats,
  globIteratorWithFileSystem,
  globWithFileSystem,
  type AsyncGlobFileSystem,
  type GlobOptions,
  type GlobPatternInput,
} from "./glob.ts";
import {
  decodeScandirRows,
  normalizeReaddirOptions,
  type ReaddirOptions,
  type ReaddirResult,
} from "./readdir.ts";
import { normalizeReadPosition } from "./read-position.ts";
import {
  cpInvalidPath,
  cpStatsAreIdentical,
  CpSystemError,
  isSrcSubdir,
  normalizeCpOptions,
  type CopyOptions,
  type NormalizedCpOptions,
} from "./cp-common.ts";
import {
  appendMkdtempSuffix,
  bytePathForBinding,
  displayBytePath,
  encodeFileBytes,
  encodeFileName,
  emitRecursiveRmdirWarning,
  getOptions,
  getReadFileBuffer,
  getReadFileOptions,
  getValidatedBytePath,
  getValidatedPath,
  isFileDescriptor,
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
  type AbortSignalLike,
  type BytePathLike,
  type EncodedFileName,
  type FileOptions,
  type PathLike,
  type ReadFileOptions,
  type RmdirOptions,
  type RmOptions,
  type SymlinkType,
} from "./options.ts";
import { flagsOf } from "./flags.ts";
import {
  dirname as dirnamePath,
  isAbsolute as isAbsolutePath,
  join as joinPath,
  resolve as resolvePath,
} from "../../path/src/posix.ts";
import {
  bufferLengths,
  fillBuffers,
  flattenBuffers,
  validateBufferArray,
  vectorPosition,
} from "./vector-io.ts";
import { nextTick } from "../../internal/tick.ts";
import { emitWarning } from "../../internal/process-warning.ts";
import { asRequest, type Callback } from "./request.ts";

export type { Callback } from "./request.ts";

class PublicAsyncGlobFileSystem implements AsyncGlobFileSystem {
  lstat(path: string): Promise<Dirent | null> {
    return new Promise<Dirent | null>((resolve) => {
      lstat(path, (error: unknown, stats?: AnyStats) => {
        if (error !== null && error !== undefined || !(stats instanceof Stats)) {
          resolve(null);
        } else {
          resolve(direntFromStats(path, stats));
        }
      });
    });
  }

  stat(path: string): Promise<Stats | null> {
    return new Promise<Stats | null>((resolve) => {
      stat(path, (error: unknown, stats?: AnyStats) => {
        if (error !== null && error !== undefined || !(stats instanceof Stats)) resolve(null);
        else resolve(stats);
      });
    });
  }

  readdir(path: string): Promise<Dirent[]> {
    return new Promise<Dirent[]>((resolve, reject) => {
      readdir(
        path,
        { encoding: "utf8", withFileTypes: true },
        (error: unknown, value?: ReaddirResult) => {
          if (error !== null && error !== undefined || value === undefined) {
            resolve([]);
            return;
          }
          const entries = new Array<Dirent>(value.length);
          for (let index = 0; index < value.length; index++) {
            const entry = value[index];
            if (!isTextDirent(entry)) {
              reject(new Error(`fs readdir returned a non-text entry at index ${index}`));
              return;
            }
            entries[index] = entry;
          }
          resolve(entries);
        },
      );
    });
  }

  realpath(path: string): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      realpath(path, (error: unknown, value?: EncodedFileName) => {
        if (error !== null && error !== undefined || typeof value !== "string") resolve(null);
        else resolve(value);
      });
    });
  }
}

function isTextDirent(
  value: EncodedFileName | Dirent<EncodedFileName> | undefined,
): value is Dirent {
  return value instanceof Dirent && typeof value.name === "string";
}

const publicAsyncGlobFileSystem = new PublicAsyncGlobFileSystem();

/** Incremental source shared by fs/promises.glob and callback fs.glob. */
export function globIterator(
  pattern: GlobPatternInput,
  options: GlobOptions & { withFileTypes: true },
): AsyncIterableIterator<Dirent>;
export function globIterator(
  pattern: GlobPatternInput,
  options?: GlobOptions,
): AsyncIterableIterator<string>;
export function globIterator(
  pattern: unknown,
  options?: unknown,
): AsyncIterableIterator<string | Dirent>;
export function globIterator(
  pattern: unknown,
  options?: unknown,
): AsyncIterableIterator<string | Dirent> {
  return globIteratorWithFileSystem(
    pattern,
    options,
    publicAsyncGlobFileSystem,
  );
}

declare function nts_fs_open_async(
  path: string, flags: number, mode: number, callback: (errno: number, fd: number) => void,
): void;
declare function nts_fs_open_bytes_async(
  path: number[], flags: number, mode: number,
  callback: (errno: number, fd: number) => void,
): void;
declare function nts_fs_close_async(
  fd: number, callback: (errno: number) => void,
): void;
declare function nts_fs_read_async(
  fd: number, length: number, position: number,
  callback: (errno: number, bytesRead: number, bytes: number[]) => void,
): void;
declare function nts_fs_read_bigint_async(
  fd: number, length: number, position: bigint,
  callback: (errno: number, bytesRead: number, bytes: number[]) => void,
): void;
declare function nts_fs_write_async(
  fd: number, bytes: number[], position: number,
  callback: (errno: number, written: number) => void,
): void;
declare function nts_fs_readv_async(
  fd: number, lengths: number[], position: number,
  callback: (errno: number, bytesRead: number, bytes: number[]) => void,
): void;
declare function nts_fs_writev_async(
  fd: number, bytes: number[], lengths: number[], position: number,
  callback: (errno: number, written: number) => void,
): void;
declare function nts_fs_stat_async(
  path: string, follow: boolean, callback: (errno: number, columns: number[]) => void,
): void;
declare function nts_fs_stat_bytes_async(
  path: number[], follow: boolean, callback: (errno: number, columns: number[]) => void,
): void;
declare function nts_fs_stat_bigint_async(
  path: string, follow: boolean, callback: (errno: number, columns: string[]) => void,
): void;
declare function nts_fs_stat_bigint_bytes_async(
  path: number[], follow: boolean, callback: (errno: number, columns: string[]) => void,
): void;
declare function nts_fs_fstat_async(
  fd: number, callback: (errno: number, columns: number[]) => void,
): void;
declare function nts_fs_fstat_bigint_async(
  fd: number, callback: (errno: number, columns: string[]) => void,
): void;
declare function nts_fs_statfs_async(
  path: string, callback: (errno: number, columns: number[]) => void,
): void;
declare function nts_fs_statfs_bytes_async(
  path: number[], callback: (errno: number, columns: number[]) => void,
): void;
declare function nts_fs_statfs_bigint_async(
  path: string, callback: (errno: number, columns: string[]) => void,
): void;
declare function nts_fs_statfs_bigint_bytes_async(
  path: number[], callback: (errno: number, columns: string[]) => void,
): void;
declare function nts_fs_access_async(
  path: string, mode: number, callback: (errno: number) => void,
): void;
declare function nts_fs_access_bytes_async(
  path: number[], mode: number, callback: (errno: number) => void,
): void;
declare function nts_fs_scandir_async(
  path: string, callback: (errno: number, rows: number[][]) => void,
): void;
declare function nts_fs_scandir_bytes_async(
  path: number[], callback: (errno: number, rows: number[][]) => void,
): void;
declare function nts_fs_mkdir_async(
  path: string, mode: number, recursive: boolean, callback: (errno: number, first: string) => void,
): void;
declare function nts_fs_rmdir_async(path: string, callback: (errno: number) => void): void;
declare function nts_fs_rm_async(
  path: string, recursive: boolean, force: boolean, maxRetries: number, retryDelay: number,
  callback: (errno: number) => void,
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
declare function nts_fs_symlink_bytes_async(
  target: number[], at: number[], flags: number, callback: (errno: number) => void,
): void;
declare function nts_fs_readlink_async(
  path: string, callback: (errno: number, target: string) => void,
): void;
declare function nts_fs_realpath_async(
  path: string, callback: (errno: number, resolved: string) => void,
): void;
declare function nts_fs_realpath_bytes_async(
  path: number[], callback: (errno: number, resolved: number[]) => void,
): void;
declare function nts_fs_chmod_async(
  path: string, mode: number, callback: (errno: number) => void,
): void;
declare function nts_fs_chown_async(
  path: string, uid: number, gid: number, callback: (errno: number) => void,
): void;
declare function nts_fs_lchown_async(
  path: string, uid: number, gid: number, callback: (errno: number) => void,
): void;
declare function nts_fs_lchown_bytes_async(
  path: number[], uid: number, gid: number, callback: (errno: number) => void,
): void;
declare function nts_fs_ftruncate_async(
  fd: number, length: number, callback: (errno: number) => void,
): void;
declare function nts_fs_utimes_async(
  path: string, atime: number, mtime: number, callback: (errno: number) => void,
): void;
declare function nts_fs_lutimes_async(
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
declare function nts_fs_mkdtemp_bytes_async(
  template: number[], callback: (errno: number, path: number[]) => void,
): void;
declare function nts_fs_is_32_bit(): boolean;
declare function nts_fs_eisdir(): number;

/**
 * Turn the seam's `(errno, value)` into node's `(error, value)`.
 *
 * The syscall name and path are closed over here rather than sent across,
 * because they are only needed to build the message and sending them would
 * mean marshalling two strings on every successful call as well.
 */
function settle(
  callback: Callback,
  syscall: string,
  path?: string,
  dest?: string,
): (errno: number) => void {
  return (errno: number) => {
    if (errno < 0) callback(uvException(errno, syscall, path, dest));
    else callback(null);
  };
}

function settleValue<T>(
  callback: Callback<T>,
  syscall: string,
  path?: string,
  dest?: string,
): (errno: number, value: T) => void {
  return (errno: number, value: T) => {
    if (errno < 0) callback(uvException(errno, syscall, path, dest));
    else callback(null, value);
  };
}

export function open(
  path: BytePathLike,
  flags?: string | number | null | Callback<number>,
  mode?: number | string | null | Callback<number>,
  callback?: Callback<number>,
): void {
  const validatedPath = getValidatedBytePath(path);
  // `open(path, cb)`, `open(path, flags, cb)`, `open(path, flags, mode, cb)`.
  let openFlags: string | number | null | undefined;
  let openMode: number;
  if (typeof flags === "function") {
    callback = flags;
    openFlags = "r";
    openMode = 0o666;
  } else if (typeof mode === "function") {
    callback = mode;
    openFlags = flags;
    openMode = 0o666;
  } else {
    openFlags = flags;
    openMode = parseFileMode(mode, "mode", 0o666);
  }
  callback = asRequest(callback, "open");
  const displayPath = displayBytePath(validatedPath);
  const settled = settleValue(callback, "open", displayPath);
  const numericFlags = flagsOf(openFlags);
  if (typeof validatedPath === "string") {
    nts_fs_open_async(validatedPath, numericFlags, openMode, settled);
  } else {
    nts_fs_open_bytes_async(validatedPath, numericFlags, openMode, settled);
  }
}

function defaultCloseCallback(error: unknown): void {
  if (error !== null && error !== undefined) throw error;
}

export function close(fd: number, callback?: Callback): void {
  const closeCallback = callback === undefined ? defaultCloseCallback : callback;
  const request = asRequest(closeCallback, "close");
  validateFileDescriptor(fd);
  nts_fs_close_async(fd, settle(request, "close"));
}

type ReadCallback = (
  error: unknown,
  bytesRead?: number,
  buffer?: ArrayBufferView,
) => void;

interface AsyncReadOptions {
  buffer?: ArrayBufferView;
  offset?: number | null;
  length?: number | null;
  position?: number | bigint | null;
}

function isReadCallback(value: unknown): value is ReadCallback {
  return typeof value === "function";
}

function requireReadCallback(value: unknown): ReadCallback {
  if (!isReadCallback(value)) {
    throw new ERR_INVALID_ARG_TYPE("cb", "Function", value);
  }
  return value;
}

export function read(fd: number, callback: ReadCallback): void;
export function read(
  fd: number,
  buffer: ArrayBufferView,
  callback: ReadCallback,
): void;
export function read(
  fd: number,
  options: AsyncReadOptions | null,
  callback: ReadCallback,
): void;
export function read(
  fd: number,
  buffer: ArrayBufferView,
  options: AsyncReadOptions | null,
  callback: ReadCallback,
): void;
export function read(
  fd: number,
  buffer: ArrayBufferView,
  offset: number,
  length: number,
  position: number | bigint | null,
  callback: ReadCallback,
): void;
export function read(
  fd: number,
  bufferOrOptionsOrCallback?: unknown,
  offsetOrOptionsOrCallback?: unknown,
  lengthOrCallback?: unknown,
  position?: unknown,
  suppliedCallback?: unknown,
): void {
  validateFileDescriptor(fd);

  let buffer: ArrayBufferView;
  let options: AsyncReadOptions | null | undefined;
  let callback: ReadCallback;
  let usesDefaults = false;
  if (isReadCallback(bufferOrOptionsOrCallback)) {
    buffer = Buffer.alloc(16_384);
    callback = bufferOrOptionsOrCallback;
    usesDefaults = true;
  } else if (ArrayBuffer.isView(bufferOrOptionsOrCallback)) {
    buffer = bufferOrOptionsOrCallback;
    if (isReadCallback(offsetOrOptionsOrCallback)) {
      callback = offsetOrOptionsOrCallback;
      usesDefaults = true;
    } else if (isReadCallback(lengthOrCallback)) {
      if (offsetOrOptionsOrCallback !== null && offsetOrOptionsOrCallback !== undefined) {
        validateObject(offsetOrOptionsOrCallback, "options");
        options = offsetOrOptionsOrCallback;
      } else {
        options = offsetOrOptionsOrCallback;
      }
      callback = lengthOrCallback;
    } else {
      callback = requireReadCallback(suppliedCallback);
    }
  } else {
    if (
      lengthOrCallback !== undefined ||
      position !== undefined ||
      suppliedCallback !== undefined
    ) {
      throw new ERR_INVALID_ARG_TYPE(
        "buffer",
        ["Buffer", "TypedArray", "DataView"],
        bufferOrOptionsOrCallback,
      );
    }
    if (bufferOrOptionsOrCallback !== null && bufferOrOptionsOrCallback !== undefined) {
      validateObject(bufferOrOptionsOrCallback, "options");
      options = bufferOrOptionsOrCallback;
    } else {
      options = bufferOrOptionsOrCallback;
    }
    const optionBuffer = options?.buffer;
    buffer = optionBuffer === undefined ? Buffer.alloc(16_384) : optionBuffer;
    callback = requireReadCallback(offsetOrOptionsOrCallback);
  }

  if (!ArrayBuffer.isView(buffer)) {
    throw new ERR_INVALID_ARG_TYPE("buffer", ["Buffer", "TypedArray", "DataView"], buffer);
  }

  let offset: number;
  let length: number;
  let readAt: number | bigint | null;
  if (options !== undefined) {
    offset = options?.offset ?? 0;
    const optionLength = options?.length;
    length = optionLength === null ? 0 : (optionLength ?? buffer.byteLength - offset);
    readAt = options?.position ?? null;
  } else if (usesDefaults) {
    offset = 0;
    length = buffer.byteLength;
    readAt = null;
  } else {
    if (offsetOrOptionsOrCallback === null || offsetOrOptionsOrCallback === undefined) {
      offset = 0;
    } else {
      validateInteger(offsetOrOptionsOrCallback, "offset", 0);
      offset = offsetOrOptionsOrCallback;
    }
    if (typeof lengthOrCallback !== "number") {
      throw new ERR_INVALID_ARG_TYPE("length", "number", lengthOrCallback);
    }
    length = lengthOrCallback | 0;
    if (position === null || position === undefined) {
      readAt = null;
    } else if (typeof position === "number" || typeof position === "bigint") {
      readAt = position;
    } else {
      throw new ERR_INVALID_ARG_TYPE("position", ["integer", "bigint"], position);
    }
  }

  validateInteger(offset, "offset", 0);
  if (length < 0) {
    throw new ERR_OUT_OF_RANGE("length", ">= 0", length);
  }
  const normalizedPosition = normalizeReadPosition(readAt, length);
  if (length === 0) {
    nextTick(() => callback(null, 0, buffer));
    return;
  }
  if (buffer.byteLength === 0) {
    throw new ERR_INVALID_ARG_VALUE("buffer", buffer, "is empty and cannot be written");
  }
  if (offset + length > buffer.byteLength) {
    throw new ERR_OUT_OF_RANGE("length", `<= ${buffer.byteLength - offset}`, length);
  }

  const request = asRequest(callback, "read");
  const target = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const complete = (errno: number, bytesRead: number, bytes: number[]): void => {
    if (errno < 0) {
      request(uvException(errno, "read"));
      return;
    }
    if (bytesRead < 0 || bytesRead > length || bytesRead > bytes.length) {
      request(new Error("fs read returned an invalid byte count"));
      return;
    }
    for (let i = 0; i < bytesRead; i++) {
      const byte = bytes[i];
      if (byte === undefined) {
        request(new Error("fs read returned fewer bytes than it reported"));
        return;
      }
      target[offset + i] = byte;
    }
    request(null, bytesRead, buffer);
  };
  if (typeof normalizedPosition === "bigint") {
    nts_fs_read_bigint_async(fd, length, normalizedPosition, complete);
  } else {
    nts_fs_read_async(fd, length, normalizedPosition, complete);
  }
}

type VectorCallback = (
  error: unknown,
  transferred?: number,
  buffers?: readonly ArrayBufferView[],
) => void;

function isVectorCallback(value: unknown): value is VectorCallback {
  return typeof value === "function";
}

function requireVectorCallback(value: unknown): VectorCallback {
  if (!isVectorCallback(value)) {
    throw new ERR_INVALID_ARG_TYPE("cb", "Function", value);
  }
  return value;
}

export function readv(
  fd: number,
  buffers: readonly ArrayBufferView[],
  callback: VectorCallback,
): void;
export function readv(
  fd: number,
  buffers: readonly ArrayBufferView[],
  position: number | null,
  callback: VectorCallback,
): void;
export function readv(
  fd: number,
  buffers: unknown,
  positionOrCallback?: unknown,
  suppliedCallback?: unknown,
): void {
  validateFileDescriptor(fd);
  validateBufferArray(buffers);
  const callback = requireVectorCallback(
    typeof positionOrCallback === "function"
      ? positionOrCallback
      : suppliedCallback,
  );
  const request = asRequest(callback, "readv");
  const lengths = bufferLengths(buffers);
  nts_fs_readv_async(
    fd,
    lengths,
    vectorPosition(positionOrCallback),
    (errno: number, bytesRead: number, bytes: number[]) => {
      if (errno < 0) {
        request(uvException(errno, "read"));
        return;
      }
      if (bytesRead < 0 || bytesRead > bytes.length) {
        request(new Error("fs readv returned an invalid byte count"));
        return;
      }
      try {
        fillBuffers(buffers, bytes, bytesRead);
      } catch (error) {
        request(error);
        return;
      }
      request(null, bytesRead, buffers);
    },
  );
}

export function writev(
  fd: number,
  buffers: readonly ArrayBufferView[],
  callback: VectorCallback,
): void;
export function writev(
  fd: number,
  buffers: readonly ArrayBufferView[],
  position: number | null,
  callback: VectorCallback,
): void;
export function writev(
  fd: number,
  buffers: unknown,
  positionOrCallback?: unknown,
  suppliedCallback?: unknown,
): void {
  validateFileDescriptor(fd);
  validateBufferArray(buffers);
  const callback = requireVectorCallback(
    typeof positionOrCallback === "function"
      ? positionOrCallback
      : suppliedCallback,
  );
  if (buffers.length === 0) {
    nextTick(() => callback(null, 0, buffers));
    return;
  }
  const request = asRequest(callback, "writev");
  nts_fs_writev_async(
    fd,
    flattenBuffers(buffers),
    bufferLengths(buffers),
    vectorPosition(positionOrCallback),
    (errno: number, written: number) => {
      if (errno < 0) request(uvException(errno, "write"));
      else request(null, written, buffers);
    },
  );
}

type WriteSource = string | ArrayBufferView;
type WriteCallback = (
  error: unknown,
  written?: number,
  buffer?: WriteSource,
) => void;

function isWriteCallback(value: unknown): value is WriteCallback {
  return typeof value === "function";
}

function requireWriteCallback(value: unknown): WriteCallback {
  if (!isWriteCallback(value)) {
    throw new ERR_INVALID_ARG_TYPE("cb", "Function", value);
  }
  return value;
}

interface AsyncWriteOptions {
  offset?: number;
  length?: number | null;
  position?: number | null;
}

function dispatchWrite(
  fd: number,
  bytes: Buffer,
  offset: number,
  length: number,
  position: number | null,
  source: WriteSource,
  callback: WriteCallback,
): void {
  const request = asRequest(callback, "write");
  const nativeBytes = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    const byte = bytes[offset + i];
    if (byte === undefined) {
      throw new Error("Buffer indexing violated its declared length");
    }
    nativeBytes[i] = byte;
  }
  nts_fs_write_async(
    fd,
    nativeBytes,
    position ?? -1,
    (errno: number, written: number) => {
      if (errno < 0) request(uvException(errno, "write"));
      else request(null, written, source);
    },
  );
}

function validateWriteBounds(offset: number, length: number, size: number): void {
  validateInteger(offset, "offset", 0, size);
  validateInteger(length, "length", 0, 2_147_483_647);
  if (length > size - offset) {
    throw new ERR_OUT_OF_RANGE("length", `<= ${size - offset}`, length);
  }
}

export function write(
  fd: number,
  buffer: ArrayBufferView,
  callback: WriteCallback,
): void;
export function write(
  fd: number,
  buffer: ArrayBufferView,
  offset: number | AsyncWriteOptions | null,
  callback: WriteCallback,
): void;
export function write(
  fd: number,
  buffer: ArrayBufferView,
  offset: number,
  length: number,
  position: number | null,
  callback: WriteCallback,
): void;
export function write(
  fd: number,
  data: string,
  callback: WriteCallback,
): void;
export function write(
  fd: number,
  data: string,
  position: number | null,
  callback: WriteCallback,
): void;
export function write(
  fd: number,
  data: string,
  position: number | null,
  encoding: string,
  callback: WriteCallback,
): void;
export function write(
  fd: number,
  source: unknown,
  offsetOrOptionsOrCallback?: unknown,
  lengthOrEncodingOrCallback?: unknown,
  positionOrCallback?: unknown,
  suppliedCallback?: unknown,
): void {
  validateFileDescriptor(fd);

  if (typeof source === "string") {
    let position: number | null;
    let encoding: string | null | undefined;
    let callback: WriteCallback | undefined;
    if (isWriteCallback(offsetOrOptionsOrCallback)) {
      position = null;
      callback = offsetOrOptionsOrCallback;
    } else if (isWriteCallback(lengthOrEncodingOrCallback)) {
      position = typeof offsetOrOptionsOrCallback === "number"
        ? offsetOrOptionsOrCallback
        : null;
      callback = lengthOrEncodingOrCallback;
    } else {
      position = typeof offsetOrOptionsOrCallback === "number"
        ? offsetOrOptionsOrCallback
        : null;
      encoding = typeof lengthOrEncodingOrCallback === "string"
        ? lengthOrEncodingOrCallback
        : undefined;
      callback = isWriteCallback(positionOrCallback)
        ? positionOrCallback
        : isWriteCallback(suppliedCallback) ? suppliedCallback : undefined;
    }
    callback = requireWriteCallback(callback);
    if (position !== null) {
      validateInteger(position, "position", -1, Number.MAX_SAFE_INTEGER);
    }
    const normalizedEncoding = requireTextEncoding(encoding ?? "utf8", "encoding");
    if (normalizedEncoding === "hex" && source.length % 2 !== 0) {
      throw new ERR_INVALID_ARG_VALUE(
        "encoding",
        encoding ?? "utf8",
        `is invalid for data of length ${source.length}`,
      );
    }
    const bytes = Buffer.from(source, normalizedEncoding);
    dispatchWrite(fd, bytes, 0, bytes.length, position, source, callback);
    return;
  }

  if (!ArrayBuffer.isView(source)) {
    throw new ERR_INVALID_ARG_TYPE(
      "buffer",
      ["Buffer", "TypedArray", "DataView", "string"],
      source,
    );
  }

  let offset = 0;
  let length = source.byteLength;
  let position: number | null = null;
  let callback: WriteCallback | undefined;
  if (
    offsetOrOptionsOrCallback !== null &&
    typeof offsetOrOptionsOrCallback === "object"
  ) {
    validateObject(offsetOrOptionsOrCallback, "options");
    const options: AsyncWriteOptions = offsetOrOptionsOrCallback;
    offset = options.offset ?? 0;
    length = options.length ?? source.byteLength - offset;
    position = options.position ?? null;
    callback = isWriteCallback(lengthOrEncodingOrCallback)
      ? lengthOrEncodingOrCallback
      : undefined;
  } else {
    if (typeof offsetOrOptionsOrCallback === "number") {
      offset = offsetOrOptionsOrCallback;
    } else if (
      offsetOrOptionsOrCallback !== undefined &&
      offsetOrOptionsOrCallback !== null &&
      !isWriteCallback(offsetOrOptionsOrCallback)
    ) {
      validateInteger(offsetOrOptionsOrCallback, "offset", 0);
    }
    length = typeof lengthOrEncodingOrCallback === "number"
      ? lengthOrEncodingOrCallback
      : source.byteLength - offset;
    if (typeof positionOrCallback === "number" || positionOrCallback === null) {
      position = positionOrCallback;
    }
    if (isWriteCallback(offsetOrOptionsOrCallback)) callback = offsetOrOptionsOrCallback;
    else if (isWriteCallback(lengthOrEncodingOrCallback)) callback = lengthOrEncodingOrCallback;
    else if (isWriteCallback(positionOrCallback)) callback = positionOrCallback;
    else callback = isWriteCallback(suppliedCallback) ? suppliedCallback : undefined;
  }
  callback = requireWriteCallback(callback);
  validateWriteBounds(offset, length, source.byteLength);
  if (position !== null) {
    validateInteger(position, "position", -1, Number.MAX_SAFE_INTEGER - length);
  }
  const bytes = Buffer.from(
    new Uint8Array(source.buffer, source.byteOffset, source.byteLength),
  );
  dispatchWrite(fd, bytes, offset, length, position, source, callback);
}

type ReadFileCallback = Callback<string | Buffer>;

const readFileBufferLength = 512 * 1024;
const readFileUnknownBufferLength = 64 * 1024;
const ioMaxLength = 2 ** 31 - 1;

/**
 * The state carried through `readFile`'s request chain.
 *
 * A whole-file native shortcut is observably wrong: Node performs an open,
 * fstat, one or more reads, and a close, and every operation is a distinct
 * `FSREQCALLBACK` whose trigger is the preceding request. Keeping those stages
 * here also limits each regular-file read to 512 KiB, so one large file cannot
 * occupy a worker for an unbounded operation.
 *
 * Unknown-sized inputs use an explicitly grown fixed-capacity chunk table.
 * This avoids selecting NTS's growable-array representation merely because a
 * pipe or device needs more than one read.
 */
class ReadFileContext {
  #path: string | undefined;
  #ownsDescriptor: boolean;
  #encoding: string | null | undefined;
  #flag: string | number;
  #options: ReadFileOptions;
  #callback: ReadFileCallback;
  #signal: FileOptions["signal"];
  #fd = -1;
  #size = 0;
  #position = 0;
  #buffer: Buffer | undefined;
  #userBuffer = false;
  #bufferByteLengthName = "options.buffer.byteLength";
  #overflowBuffer: Buffer | undefined;
  #checkOverflow = false;
  #chunks = new Array<Buffer | undefined>(4);
  #chunkCount = 0;
  #pendingError: unknown = null;

  constructor(source: string | number, options: ReadFileOptions, callback: ReadFileCallback) {
    this.#ownsDescriptor = typeof source === "string";
    if (typeof source === "string") {
      this.#path = source;
    } else {
      this.#fd = source;
    }
    this.#encoding = options.encoding;
    this.#flag = options.flag ?? "r";
    this.#options = options;
    this.#callback = callback;
    this.#signal = options.signal;
  }

  start(): void {
    if (!this.#ownsDescriptor) {
      nextTick((fd: number) => this.#afterOpen(null, fd), this.#fd);
      return;
    }
    const path = this.#path;
    if (path === undefined) {
      this.#callback(new Error("fs readFile lost its validated path"));
      return;
    }
    open(
      path,
      this.#flag,
      0o666,
      (error: unknown, fd?: number) => this.#afterOpen(error, fd),
    );
  }

  #afterOpen(error: unknown, fd: number | undefined): void {
    if (error !== null) {
      this.#callback(error);
      return;
    }
    if (fd === undefined) {
      this.#callback(new Error("fs open completed without a file descriptor"));
      return;
    }

    this.#fd = fd;
    fstat(fd, (statError: unknown, stats?: AnyStats) => {
      this.#afterStat(statError, stats);
    });
  }

  #afterStat(error: unknown, stats: AnyStats | undefined): void {
    if (error !== null) {
      this.#close(error);
      return;
    }
    if (stats === undefined) {
      this.#close(new Error("fs fstat completed without file metadata"));
      return;
    }
    if (typeof stats.size === "bigint") {
      this.#close(new Error("fs fstat returned bigint data for a numeric request"));
      return;
    }

    this.#size = stats.isFile() ? stats.size : 0;
    if (this.#size > ioMaxLength) {
      this.#close(new ERR_FS_FILE_TOO_LARGE(this.#size));
      return;
    }
    try {
      const supplied = getReadFileBuffer(this.#options, this.#size);
      if (supplied !== undefined) {
        this.#buffer = supplied;
        this.#userBuffer = true;
        this.#bufferByteLengthName = readFileBufferByteLengthName(this.#options);
      } else if (this.#size > 0) {
        this.#buffer = Buffer.allocUnsafeSlow(this.#size);
      }
    } catch (bufferError) {
      this.#close(bufferError);
      return;
    }
    this.#readNext();
  }

  #readNext(): void {
    if (this.#signal?.aborted) {
      this.#close(new AbortError(undefined, { cause: this.#signal.reason }));
      return;
    }

    let buffer: Buffer;
    let offset: number;
    let length: number;

    if (this.#userBuffer) {
      const supplied = this.#buffer;
      if (supplied === undefined) {
        this.#close(new Error("fs readFile lost its caller-provided buffer"));
        return;
      }
      if (this.#size === 0) {
        buffer = supplied;
        offset = this.#position;
        length = supplied.byteLength - this.#position;
        if (length === 0) {
          const overflow = this.#overflowBuffer ?? Buffer.allocUnsafeSlow(1);
          this.#overflowBuffer = overflow;
          buffer = overflow;
          offset = 0;
          length = 1;
          this.#checkOverflow = true;
        }
      } else {
        buffer = supplied;
        offset = this.#position;
        length = Math.min(readFileBufferLength, this.#size - this.#position);
      }
    } else if (this.#size > 0) {
      buffer = this.#buffer ?? Buffer.allocUnsafeSlow(this.#size);
      this.#buffer = buffer;
      offset = this.#position;
      length = Math.min(readFileBufferLength, this.#size - this.#position);
    } else {
      buffer = Buffer.allocUnsafeSlow(readFileUnknownBufferLength);
      this.#buffer = buffer;
      offset = 0;
      length = readFileUnknownBufferLength;
    }

    read(
      this.#fd,
      buffer,
      offset,
      length,
      null,
      (error: unknown, bytesRead?: number) => this.#afterRead(error, bytesRead),
    );
  }

  #afterRead(error: unknown, bytesRead: number | undefined): void {
    if (error !== null) {
      this.#close(error);
      return;
    }
    if (bytesRead === undefined) {
      this.#close(new Error("fs read completed without a byte count"));
      return;
    }

    if (this.#checkOverflow) {
      this.#checkOverflow = false;
      if (bytesRead !== 0) {
        const supplied = this.#buffer;
        if (supplied === undefined) {
          this.#close(new Error("fs readFile lost its overflow-check buffer"));
          return;
        }
        this.#close(new ERR_INVALID_ARG_VALUE(
          this.#bufferByteLengthName,
          supplied.byteLength,
          "is too small to contain the entire file",
        ));
      } else {
        this.#close(null);
      }
      return;
    }

    if (!this.#userBuffer && this.#size === 0 && bytesRead > 0) {
      const buffer = this.#buffer;
      if (buffer === undefined) {
        this.#close(new Error("fs read completed without its destination buffer"));
        return;
      }
      this.#appendChunk(buffer.subarray(0, bytesRead));
    }

    this.#position += bytesRead;
    if (this.#userBuffer) {
      if (bytesRead === 0 || this.#position === this.#size) {
        this.#close(null);
      } else {
        this.#readNext();
      }
      return;
    }
    if (bytesRead === 0 || (this.#size > 0 && this.#position >= this.#size)) {
      this.#close(null);
      return;
    }
    this.#readNext();
  }

  #appendChunk(chunk: Buffer): void {
    if (this.#chunkCount === this.#chunks.length) {
      const chunks = new Array<Buffer | undefined>(this.#chunks.length * 2);
      for (let i = 0; i < this.#chunkCount; i++) chunks[i] = this.#chunks[i];
      this.#chunks = chunks;
    }
    this.#chunks[this.#chunkCount] = chunk;
    this.#chunkCount += 1;
  }

  #close(error: unknown): void {
    this.#pendingError = error;
    if (!this.#ownsDescriptor) {
      nextTick(() => this.#afterClose(null));
      return;
    }
    close(this.#fd, (closeError: unknown) => this.#afterClose(closeError));
  }

  #afterClose(closeError: unknown): void {
    const error = aggregateTwoErrors(closeError, this.#pendingError);
    if (error) {
      this.#callback(error);
      return;
    }

    let result: Buffer;
    if (this.#userBuffer) {
      const buffer = this.#buffer;
      if (buffer === undefined) {
        this.#callback(new Error("fs readFile lost its caller-provided result buffer"));
        return;
      }
      result = buffer.subarray(0, this.#position);
    } else if (this.#size > 0) {
      const buffer = this.#buffer;
      if (buffer === undefined) {
        this.#callback(new Error("fs read completed without its result buffer"));
        return;
      }
      result = this.#position < this.#size
        ? buffer.subarray(0, this.#position)
        : buffer;
    } else {
      result = Buffer.allocUnsafe(this.#position);
      let offset = 0;
      for (let i = 0; i < this.#chunkCount; i++) {
        const chunk = this.#chunks[i];
        if (chunk === undefined) continue;
        offset += chunk.copy(result, offset);
      }
    }

    this.#callback(
      null,
      this.#encoding ? result.toString(this.#encoding) : result,
    );
  }
}

export function readFile(path: PathLike | number, callback: ReadFileCallback): void;
export function readFile(
  path: PathLike | number,
  options: string | ReadFileOptions | null,
  callback: ReadFileCallback,
): void;
export function readFile(
  path: PathLike | number,
  optionsOrCallback: string | ReadFileOptions | null | ReadFileCallback,
  callback?: ReadFileCallback,
): void {
  let options: string | ReadFileOptions | null | undefined;
  let complete: ReadFileCallback;
  if (typeof optionsOrCallback === "function") {
    options = undefined;
    complete = optionsOrCallback;
  } else {
    options = optionsOrCallback;
    validateFunction(callback, "cb");
    complete = callback;
  }

  const settings = getReadFileOptions(options);
  validateAbortSignal(settings.signal, "options.signal");
  const usesCallerDescriptor = isFileDescriptor(path);
  if (!usesCallerDescriptor && settings.signal?.aborted) {
    complete(new AbortError(undefined, { cause: settings.signal.reason }));
    return;
  }
  const source = usesCallerDescriptor ? path : getValidatedPath(path);
  const context = new ReadFileContext(source, settings, complete);
  context.start();
}

class WriteFileContext {
  #source: string | number;
  #buffer: Buffer;
  #flag: string | number;
  #mode: number | string;
  #signal: FileOptions["signal"];
  #flush: boolean;
  #callback: Callback;
  #ownsDescriptor: boolean;
  #fd = -1;
  #offset = 0;

  constructor(
    source: string | number,
    buffer: Buffer,
    options: FileOptions,
    callback: Callback,
  ) {
    this.#source = source;
    this.#buffer = buffer;
    this.#flag = options.flag ?? "w";
    this.#mode = options.mode ?? 0o666;
    this.#signal = options.signal;
    this.#flush = options.flush ?? false;
    this.#callback = callback;
    this.#ownsDescriptor = typeof source === "string";
    if (typeof source === "number") this.#fd = source;
  }

  start(): void {
    if (!this.#ownsDescriptor) {
      this.#writeNext();
      return;
    }
    const path = this.#source;
    if (typeof path !== "string") {
      this.#callback(new Error("fs writeFile lost its validated path"));
      return;
    }
    open(
      path,
      this.#flag,
      parseFileMode(this.#mode, "mode", 0o666),
      (error: unknown, fd?: number) => this.#afterOpen(error, fd),
    );
  }

  #afterOpen(error: unknown, fd: number | undefined): void {
    if (error !== null) {
      this.#callback(error);
      return;
    }
    if (fd === undefined) {
      this.#callback(new Error("fs open completed without a file descriptor"));
      return;
    }
    this.#fd = fd;
    this.#writeNext();
  }

  #writeNext(): void {
    if (this.#signal?.aborted) {
      this.#finish(new AbortError(undefined, { cause: this.#signal.reason }));
      return;
    }
    const remaining = this.#buffer.length - this.#offset;
    write(
      this.#fd,
      this.#buffer,
      this.#offset,
      remaining,
      null,
      (error: unknown, written?: number) => this.#afterWrite(error, written, remaining),
    );
  }

  #afterWrite(error: unknown, written: number | undefined, requested: number): void {
    if (error !== null) {
      this.#finish(error);
      return;
    }
    if (written === undefined || written < 0 || written > requested) {
      this.#finish(new Error("fs write returned an invalid byte count"));
      return;
    }
    if (written === 0 && requested !== 0) {
      this.#finish(new Error("fs write made no progress"));
      return;
    }
    this.#offset += written;
    if (written !== requested) {
      this.#writeNext();
      return;
    }
    if (this.#flush) {
      fsync(this.#fd, (syncError: unknown) => this.#finish(syncError));
    } else {
      this.#finish(null);
    }
  }

  #finish(error: unknown): void {
    if (!this.#ownsDescriptor) {
      this.#callback(error);
      return;
    }
    close(this.#fd, (closeError: unknown) => {
      this.#callback(aggregateTwoErrors(closeError, error));
    });
  }
}

export function writeFile(
  path: PathLike | number,
  data: string | ArrayBufferView,
  callback: Callback,
): void;
export function writeFile(
  path: PathLike | number,
  data: string | ArrayBufferView,
  options: string | FileOptions | null,
  callback: Callback,
): void;
export function writeFile(
  path: PathLike | number,
  data: string | ArrayBufferView,
  optionsOrCallback: string | FileOptions | null | Callback,
  callback?: Callback,
): void {
  let options: string | FileOptions | null | undefined;
  let complete: Callback;
  if (typeof optionsOrCallback === "function") {
    options = undefined;
    complete = optionsOrCallback;
  } else {
    options = optionsOrCallback;
    validateFunction(callback, "cb");
    complete = callback;
  }

  const settings = getOptions(options, {
    encoding: "utf8",
    mode: 0o666,
    flag: "w",
    flush: false,
  });
  const flush = settings.flush ?? false;
  validateBoolean(flush, "options.flush");
  if (typeof data !== "string" && !ArrayBuffer.isView(data)) {
    throw new ERR_INVALID_ARG_TYPE(
      "data",
      ["string", "Buffer", "TypedArray", "DataView"],
      data,
    );
  }
  const encoding = settings.encoding ?? "utf8";
  const buffer = typeof data === "string"
    ? Buffer.from(data, encoding)
    : Buffer.from(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));

  const usesCallerDescriptor = isFileDescriptor(path);
  if (!usesCallerDescriptor && settings.signal?.aborted) {
    complete(new AbortError(undefined, { cause: settings.signal.reason }));
    return;
  }
  const source = usesCallerDescriptor ? path : getValidatedPath(path);
  const context = new WriteFileContext(source, buffer, settings, complete);
  context.start();
}

export function appendFile(
  path: PathLike | number,
  data: string | ArrayBufferView,
  callback: Callback,
): void;
export function appendFile(
  path: PathLike | number,
  data: string | ArrayBufferView,
  options: string | FileOptions | null,
  callback: Callback,
): void;
export function appendFile(
  path: PathLike | number,
  data: string | ArrayBufferView,
  optionsOrCallback: string | FileOptions | null | Callback,
  callback?: Callback,
): void {
  let options: string | FileOptions | null | undefined;
  let complete: Callback;
  if (typeof optionsOrCallback === "function") {
    options = undefined;
    complete = optionsOrCallback;
  } else {
    options = optionsOrCallback;
    validateFunction(callback, "cb");
    complete = callback;
  }
  const settings = getOptions(options, {
    encoding: "utf8",
    mode: 0o666,
    flag: "a",
  });
  const appendSettings: FileOptions = {
    encoding: settings.encoding,
    mode: settings.mode,
    flag: isFileDescriptor(path) || !settings.flag ? "a" : settings.flag,
    signal: settings.signal,
    flush: settings.flush,
  };
  writeFile(path, data, appendSettings, complete);
}

type AnyStats = Stats | BigIntStats;

interface AsyncStatOptions extends StatSyncOptions {
  signal?: AbortSignalLike;
}

function isMissingStatEntry(errno: number): boolean {
  const code = errName(errno);
  return code === "ENOENT" || code === "ENOTDIR";
}

export function stat(
  path: BytePathLike,
  callback: Callback<AnyStats>,
): void;
export function stat(
  path: BytePathLike,
  options: AsyncStatOptions | undefined,
  callback: Callback<AnyStats>,
): void;
export function stat(
  path: BytePathLike,
  optionsOrCallback: AsyncStatOptions | Callback<AnyStats> | undefined,
  callback?: Callback<AnyStats>,
): void {
  let options: AsyncStatOptions | undefined;
  if (typeof optionsOrCallback === "function") {
    callback = optionsOrCallback;
    options = undefined;
  } else {
    options = optionsOrCallback;
  }
  validateAbortSignal(options?.signal, "options.signal");
  const validatedPath = getValidatedBytePath(path);
  const displayPath = displayBytePath(validatedPath);
  const request = asRequest(callback, "stat");
  if (options?.signal?.aborted) {
    request(new AbortError(undefined, { cause: options.signal.reason }));
    return;
  }
  if (options?.bigint === true) {
    const complete = (errno: number, columns: string[]): void => {
      if (errno < 0) {
        if (options.throwIfNoEntry === false && isMissingStatEntry(errno)) request(null);
        else request(uvException(errno, "stat", displayPath));
      } else {
        request(null, new BigIntStats(columns));
      }
    };
    if (typeof validatedPath === "string") {
      nts_fs_stat_bigint_async(validatedPath, true, complete);
    } else {
      nts_fs_stat_bigint_bytes_async(validatedPath, true, complete);
    }
    return;
  }
  const complete = (errno: number, columns: number[]): void => {
    if (errno < 0) {
      if (options?.throwIfNoEntry === false && isMissingStatEntry(errno)) request(null);
      else request(uvException(errno, "stat", displayPath));
    } else {
      request(null, new Stats(columns));
    }
  };
  if (typeof validatedPath === "string") {
    nts_fs_stat_async(validatedPath, true, complete);
  } else {
    nts_fs_stat_bytes_async(validatedPath, true, complete);
  }
}

export function lstat(
  path: BytePathLike,
  callback: Callback<AnyStats>,
): void;
export function lstat(
  path: BytePathLike,
  options: StatOptions | undefined,
  callback: Callback<AnyStats>,
): void;
export function lstat(
  path: BytePathLike,
  optionsOrCallback: StatOptions | Callback<AnyStats> | undefined,
  callback?: Callback<AnyStats>,
): void {
  let options: StatOptions | undefined;
  if (typeof optionsOrCallback === "function") {
    callback = optionsOrCallback;
    options = undefined;
  } else {
    options = optionsOrCallback;
  }
  const validatedPath = getValidatedBytePath(path);
  const displayPath = displayBytePath(validatedPath);
  const request = asRequest(callback, "lstat");
  if (options?.bigint === true) {
    const complete = (errno: number, columns: string[]): void => {
      if (errno < 0) request(uvException(errno, "lstat", displayPath));
      else request(null, new BigIntStats(columns));
    };
    if (typeof validatedPath === "string") {
      nts_fs_stat_bigint_async(validatedPath, false, complete);
    } else {
      nts_fs_stat_bigint_bytes_async(validatedPath, false, complete);
    }
    return;
  }
  const complete = (errno: number, columns: number[]): void => {
    if (errno < 0) request(uvException(errno, "lstat", displayPath));
    else request(null, new Stats(columns));
  };
  if (typeof validatedPath === "string") {
    nts_fs_stat_async(validatedPath, false, complete);
  } else {
    nts_fs_stat_bytes_async(validatedPath, false, complete);
  }
}

export function fstat(
  fd: number,
  callback: Callback<AnyStats>,
): void;
export function fstat(
  fd: number,
  options: StatOptions | undefined,
  callback: Callback<AnyStats>,
): void;
export function fstat(
  fd: number,
  optionsOrCallback: StatOptions | Callback<AnyStats> | undefined,
  callback?: Callback<AnyStats>,
): void {
  let options: StatOptions | undefined;
  if (typeof optionsOrCallback === "function") {
    callback = optionsOrCallback;
    options = undefined;
  } else {
    options = optionsOrCallback;
  }
  validateFileDescriptor(fd);
  fstatFileHandle(fd, options, callback);
}

/**
 * FileHandle's fstat path accepts its closed `-1` sentinel so the native
 * operation can report EBADF. Public `fs.fstat` still validates descriptors
 * before entering this helper.
 */
export function fstatFileHandle(
  fd: number,
  options: StatOptions | undefined,
  callback: Callback<AnyStats> | undefined,
): void {
  const request = asRequest(callback, "fstat");
  if (options?.bigint === true) {
    nts_fs_fstat_bigint_async(fd, (errno: number, columns: string[]) => {
      if (errno < 0) request(uvException(errno, "fstat"));
      else request(null, new BigIntStats(columns));
    });
    return;
  }
  nts_fs_fstat_async(fd, (errno: number, columns: number[]) => {
    if (errno < 0) request(uvException(errno, "fstat"));
    else request(null, new Stats(columns));
  });
}

type AnyStatFs = StatFs<number> | StatFs<bigint>;

export function statfs(
  path: BytePathLike,
  callback: Callback<AnyStatFs>,
): void;
export function statfs(
  path: BytePathLike,
  options: StatFsOptions | undefined,
  callback: Callback<AnyStatFs>,
): void;
export function statfs(
  path: BytePathLike,
  optionsOrCallback: StatFsOptions | undefined | Callback<AnyStatFs>,
  callback?: Callback<AnyStatFs>,
): void {
  let options: StatFsOptions | undefined;
  if (typeof optionsOrCallback === "function") {
    callback = optionsOrCallback;
    options = undefined;
  } else {
    options = optionsOrCallback;
  }
  const request = asRequest(callback, "statfs");
  const validatedPath = getValidatedBytePath(path);
  const displayPath = displayBytePath(validatedPath);
  if (options?.bigint === true) {
    const complete = (errno: number, columns: string[]): void => {
      if (errno < 0) request(uvException(errno, "statfs", displayPath));
      else request(null, bigintStatFs(columns));
    };
    if (typeof validatedPath === "string") {
      nts_fs_statfs_bigint_async(validatedPath, complete);
    } else {
      nts_fs_statfs_bigint_bytes_async(validatedPath, complete);
    }
    return;
  }
  const complete = (errno: number, columns: number[]): void => {
    if (errno < 0) request(uvException(errno, "statfs", displayPath));
    else request(null, numberStatFs(columns));
  };
  if (typeof validatedPath === "string") {
    nts_fs_statfs_async(validatedPath, complete);
  } else {
    nts_fs_statfs_bytes_async(validatedPath, complete);
  }
}

export function access(
  path: BytePathLike,
  mode: number | null | Callback = 0,
  callback?: Callback,
): void {
  if (typeof mode === "function") {
    callback = mode;
    mode = 0;
  }
  const validatedPath = getValidatedBytePath(path);
  callback = asRequest(callback, "access");
  const accessMode = validateAccessMode(mode);
  const displayPath = displayBytePath(validatedPath);
  const settled = settle(callback, "access", displayPath);
  if (typeof validatedPath === "string") {
    nts_fs_access_async(validatedPath, accessMode, settled);
  } else {
    nts_fs_access_bytes_async(validatedPath, accessMode, settled);
  }
}

/**
 * `fs.exists`, which is deprecated and whose callback takes no error.
 *
 * Kept because programs call it. The reason it is deprecated is worth knowing:
 * a positive answer is out of date by the time the caller acts on it, so the
 * only correct use is to open the file and handle the failure.
 */
export function exists(path: PathLike, callback: (exists: boolean) => void): void;
export function exists(path: unknown, callback?: unknown): void {
  validateFunction(callback, "cb");
  let validatedPath: string;
  try {
    validatedPath = getValidatedPath(path);
  } catch {
    callback(false);
    return;
  }
  access(validatedPath, 0, (error) => callback(!error));
}

export function readdir(path: BytePathLike, callback: Callback<ReaddirResult>): void;
export function readdir(
  path: BytePathLike,
  options: string | ReaddirOptions | null,
  callback: Callback<ReaddirResult>,
): void;
export function readdir(
  path: BytePathLike,
  optionsOrCallback: string | ReaddirOptions | null | Callback<ReaddirResult>,
  callback?: Callback<ReaddirResult>,
): void {
  let options: string | ReaddirOptions | null | undefined;
  if (typeof optionsOrCallback === "function") {
    callback = optionsOrCallback;
    options = undefined;
  } else {
    options = optionsOrCallback;
  }
  const validatedPath = getValidatedBytePath(path);
  const settings = normalizeReaddirOptions(options);
  const request = asRequest(callback, "readdir");
  const displayPath = displayBytePath(validatedPath);
  const complete = (errno: number, rows: number[][]): void => {
    if (errno < 0) {
      request(uvException(errno, "scandir", displayPath));
      return;
    }
    let result: ReaddirResult;
    try {
      result = decodeScandirRows(rows, displayPath, settings);
    } catch (error) {
      request(error);
      return;
    }
    request(null, result);
  };
  if (typeof validatedPath === "string") {
    nts_fs_scandir_async(validatedPath, complete);
  } else {
    nts_fs_scandir_bytes_async(validatedPath, complete);
  }
}

export function glob(
  pattern: GlobPatternInput,
  callback: Callback<string[]>,
): void;
export function glob(
  pattern: GlobPatternInput,
  options: GlobOptions & { withFileTypes: true },
  callback: Callback<Dirent[]>,
): void;
export function glob(
  pattern: GlobPatternInput,
  options: GlobOptions,
  callback: Callback<Array<string | Dirent>>,
): void;
export function glob(
  pattern: unknown,
  optionsOrCallback: unknown,
  suppliedCallback?: unknown,
): void {
  let options: unknown;
  let callback: unknown;
  if (typeof optionsOrCallback === "function") {
    options = undefined;
    callback = optionsOrCallback;
  } else {
    options = optionsOrCallback;
    callback = suppliedCallback;
  }
  validateFunction(callback, "cb");
  const request = asRequest(callback, "glob");
  const operation = globWithFileSystem(pattern, options, publicAsyncGlobFileSystem);
  operation.then(
    (results: Array<string | Dirent>) => nextTick(() => request(null, results)),
    (error: unknown) => nextTick(() => request(error)),
  );
}

export function mkdir(
  path: PathLike,
  options: number | string | { recursive?: boolean; mode?: number | string } | Callback<string | undefined>,
  callback?: Callback<string | undefined>,
): void {
  if (typeof options === "function") {
    callback = options;
    options = {};
  }
  const validatedPath = getValidatedPath(path);
  const request = asRequest(callback, "mkdir");

  let recursive = false;
  if (options !== null && typeof options === "object" && options.recursive !== undefined) {
    validateBoolean(options.recursive, "options.recursive");
    recursive = options.recursive;
  }
  const requestedMode = typeof options === "number" || typeof options === "string"
    ? options
    : (options.mode ?? 0o777);
  const mode = parseFileMode(requestedMode, "mode", 0o777);

  nts_fs_mkdir_async(validatedPath, mode, recursive, (errno: number, first: string) => {
    if (errno < 0) {
      request(uvException(errno, "mkdir", validatedPath));
    } else {
      // Recursive `mkdir` reports the *first* directory it had to create, so
      // a caller can undo exactly what it did.
      request(null, recursive ? (first || undefined) : undefined);
    }
  });
}

export function rmdir(path: PathLike, callback: Callback): void;
export function rmdir(
  path: PathLike,
  options: RmdirOptions | undefined,
  callback: Callback,
): void;
export function rmdir(
  path: PathLike,
  optionsOrCallback: RmdirOptions | Callback | undefined,
  callback?: Callback,
): void {
  let options: RmdirOptions | undefined;
  if (typeof optionsOrCallback === "function") {
    callback = optionsOrCallback;
    options = undefined;
  } else {
    options = optionsOrCallback;
  }
  const validatedPath = getValidatedPath(path);
  const request = asRequest(callback, "rmdir");
  const settings = normalizeRmdirOptions(options);
  if (settings.recursive) {
    emitRecursiveRmdirWarning();
    lstat(validatedPath, (error: unknown, stats?: AnyStats) => {
      if (error !== null && error !== undefined) {
        request(error);
        return;
      }
      if (stats === undefined) {
        request(new Error("fs lstat completed without file metadata"));
        return;
      }
      if (!stats.isDirectory()) {
        nts_fs_rmdir_async(validatedPath, settle(request, "rmdir", validatedPath));
        return;
      }
      nts_fs_rm_async(
        validatedPath,
        true,
        false,
        settings.maxRetries,
        settings.retryDelay,
        settle(request, "rmdir", validatedPath),
      );
    });
    return;
  }
  nts_fs_rmdir_async(validatedPath, settle(request, "rmdir", validatedPath));
}

export function rm(path: PathLike, callback: Callback): void;
export function rm(path: PathLike, options: RmOptions | undefined, callback: Callback): void;
export function rm(
  path: PathLike,
  optionsOrCallback: RmOptions | Callback | undefined,
  callback?: Callback,
): void {
  let options: RmOptions | undefined;
  if (typeof optionsOrCallback === "function") {
    callback = optionsOrCallback;
    options = undefined;
  } else {
    options = optionsOrCallback;
  }
  const validatedPath = getValidatedPath(path);
  const request = asRequest(callback, "rm");
  const settings = normalizeRmOptions(options);
  lstat(validatedPath, (error: unknown, stats?: AnyStats) => {
    if (error !== null && error !== undefined) {
      if (settings.force && errorHasCode(error, "ENOENT")) {
        request(null);
      } else {
        request(error);
      }
      return;
    }
    if (stats === undefined) {
      request(new Error("fs lstat completed without file metadata"));
      return;
    }
    if (stats.isDirectory() && !settings.recursive) {
      const errno = nts_fs_eisdir();
      request(new ERR_FS_EISDIR(
        errno,
        errName(errno),
        errMessage(errno),
        validatedPath,
      ));
      return;
    }
    nts_fs_rm_async(
      validatedPath,
      settings.recursive,
      settings.force,
      settings.maxRetries,
      settings.retryDelay,
      settle(request, "rm", validatedPath),
    );
  });
}

/** Narrow the stat callback's unknown error without weakening the public API. */
function errorHasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" &&
    "code" in error && error.code === code;
}

export function unlink(path: PathLike, callback?: Callback): void {
  const validatedPath = getValidatedPath(path);
  const request = asRequest(callback, "unlink");
  nts_fs_unlink_async(validatedPath, settle(request, "unlink", validatedPath));
}

export function rename(from: PathLike, to: PathLike, callback?: Callback): void {
  const validatedFrom = getValidatedPath(from, "oldPath");
  const validatedTo = getValidatedPath(to, "newPath");
  const request = asRequest(callback, "rename");
  nts_fs_rename_async(
    validatedFrom,
    validatedTo,
    settle(request, "rename", validatedFrom, validatedTo),
  );
}

export function copyFile(
  from: PathLike,
  to: PathLike,
  flags: number | null | Callback,
  callback?: Callback,
): void {
  if (typeof flags === "function") {
    callback = flags;
    flags = 0;
  }
  const validatedFrom = getValidatedPath(from, "src");
  const validatedTo = getValidatedPath(to, "dest");
  const request = asRequest(callback, "copyFile");
  nts_fs_copyfile_async(
    validatedFrom,
    validatedTo,
    validateAccessMode(flags),
    settle(request, "copyfile", validatedFrom, validatedTo),
  );
}

function cpErrorHasCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" &&
    "code" in error && error.code === code;
}

function cpBigIntStat(
  path: string,
  options: NormalizedCpOptions,
  allowMissing: boolean,
): Promise<BigIntStats | undefined> {
  return new Promise<BigIntStats | undefined>((resolve, reject) => {
    const complete = (error: unknown, value?: AnyStats): void => {
      if (error !== null && error !== undefined) {
        if (
          allowMissing &&
          (cpErrorHasCode(error, "ENOENT") || cpErrorHasCode(error, "ENOTDIR"))
        ) {
          resolve(undefined);
        } else {
          reject(error);
        }
      } else if (value instanceof BigIntStats) {
        resolve(value);
      } else {
        reject(new Error("fs cp bigint stat completed without metadata"));
      }
    };
    if (options.dereference) stat(path, { bigint: true }, complete);
    else lstat(path, { bigint: true }, complete);
  });
}

function cpNumberStat(
  path: string,
  options: NormalizedCpOptions,
  allowMissing: boolean,
): Promise<Stats | undefined> {
  return new Promise<Stats | undefined>((resolve, reject) => {
    const complete = (error: unknown, value?: AnyStats): void => {
      if (error !== null && error !== undefined) {
        if (
          allowMissing &&
          (cpErrorHasCode(error, "ENOENT") || cpErrorHasCode(error, "ENOTDIR"))
        ) {
          resolve(undefined);
        } else {
          reject(error);
        }
      } else if (value instanceof Stats) {
        resolve(value);
      } else {
        reject(new Error("fs cp stat completed without metadata"));
      }
    };
    if (options.dereference) stat(path, undefined, complete);
    else lstat(path, undefined, complete);
  });
}

function cpFollowingStat(
  path: string,
  allowMissing: boolean,
): Promise<Stats | undefined> {
  return new Promise<Stats | undefined>((resolve, reject) => {
    stat(path, (error: unknown, value?: AnyStats): void => {
      if (error !== null && error !== undefined) {
        if (
          allowMissing &&
          (cpErrorHasCode(error, "ENOENT") || cpErrorHasCode(error, "ENOTDIR"))
        ) {
          resolve(undefined);
        } else {
          reject(error);
        }
      } else if (value instanceof Stats) {
        resolve(value);
      } else {
        reject(new Error("fs cp stat completed without metadata"));
      }
    });
  });
}

function cpFollowingBigIntStat(
  path: string,
  allowMissing: boolean,
): Promise<BigIntStats | undefined> {
  return new Promise<BigIntStats | undefined>((resolve, reject) => {
    stat(path, { bigint: true }, (error: unknown, value?: AnyStats): void => {
      if (error !== null && error !== undefined) {
        if (
          allowMissing &&
          (cpErrorHasCode(error, "ENOENT") || cpErrorHasCode(error, "ENOTDIR"))
        ) {
          resolve(undefined);
        } else {
          reject(error);
        }
      } else if (value instanceof BigIntStats) {
        resolve(value);
      } else {
        reject(new Error("fs cp bigint stat completed without metadata"));
      }
    });
  });
}

function cpCopyFile(
  source: string,
  destination: string,
  mode: number,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    copyFile(source, destination, mode, (error: unknown): void => {
      if (error !== null && error !== undefined) reject(error);
      else resolve();
    });
  });
}

function cpChmod(path: string, mode: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    chmod(path, mode, (error: unknown): void => {
      if (error !== null && error !== undefined) reject(error);
      else resolve();
    });
  });
}

function cpMkdir(path: string, recursive: boolean): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    mkdir(path, { recursive }, (error: unknown): void => {
      if (error !== null && error !== undefined) reject(error);
      else resolve();
    });
  });
}

function cpUnlink(path: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    unlink(path, (error: unknown): void => {
      if (error !== null && error !== undefined) reject(error);
      else resolve();
    });
  });
}

function cpSymlink(target: string, path: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    symlink(target, path, (error: unknown): void => {
      if (error !== null && error !== undefined) reject(error);
      else resolve();
    });
  });
}

function cpReadlink(path: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    readlink(path, (error: unknown, value?: EncodedFileName): void => {
      if (error !== null && error !== undefined) reject(error);
      else if (typeof value === "string") resolve(value);
      else reject(new Error("fs cp readlink completed without a string"));
    });
  });
}

function cpUtimes(
  path: string,
  accessTime: Date,
  modificationTime: Date,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    utimes(path, accessTime, modificationTime, (error: unknown): void => {
      if (error !== null && error !== undefined) reject(error);
      else resolve();
    });
  });
}

function cpReadDirectory(path: string): Promise<string[]> {
  return new Promise<string[]>((resolve, reject) => {
    readdir(path, (error: unknown, value?: ReaddirResult): void => {
      if (error !== null && error !== undefined) {
        reject(error);
        return;
      }
      if (!Array.isArray(value)) {
        reject(new Error("fs cp readdir completed without entries"));
        return;
      }
      const names = new Array<string>(value.length);
      for (let index = 0; index < value.length; index++) {
        const name = value[index];
        if (typeof name !== "string") {
          reject(new Error("fs cp readdir returned a non-string entry"));
          return;
        }
        names[index] = name;
      }
      resolve(names);
    });
  });
}

async function checkCpParentPaths(
  sourcePath: string,
  source: BigIntStats,
  destinationPath: string,
): Promise<void> {
  const sourceParent = resolvePath(dirnamePath(sourcePath));
  let destinationParent = resolvePath(dirnamePath(destinationPath));
  while (
    destinationParent !== sourceParent &&
    destinationParent !== dirnamePath(destinationParent)
  ) {
    const parent = await cpFollowingBigIntStat(destinationParent, true);
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

async function checkCpPaths(
  sourcePath: string,
  destinationPath: string,
  options: NormalizedCpOptions,
): Promise<void> {
  const source = await cpBigIntStat(sourcePath, options, false);
  if (source === undefined) {
    throw new Error("fs cp source stat completed without metadata");
  }
  const destination = await cpBigIntStat(destinationPath, options, true);
  if (destination !== undefined) {
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
  if (source.isDirectory() && isSrcSubdir(sourcePath, destinationPath)) {
    throw cpInvalidPath(
      `cannot copy ${sourcePath} to a subdirectory of self ${destinationPath}`,
      destinationPath,
    );
  }
  await checkCpParentPaths(sourcePath, source, destinationPath);
}

async function ensureCpParent(destinationPath: string): Promise<void> {
  const parent = dirnamePath(destinationPath);
  if (await cpFollowingStat(parent, true) === undefined) {
    await cpMkdir(parent, true);
  }
}

async function copyCpFile(
  source: Stats,
  sourcePath: string,
  destinationPath: string,
  options: NormalizedCpOptions,
): Promise<void> {
  await cpCopyFile(sourcePath, destinationPath, options.mode);
  if (options.preserveTimestamps) {
    if ((source.mode & 0o200) === 0) {
      await cpChmod(destinationPath, source.mode | 0o200);
    }
    const updatedSource = await cpFollowingStat(sourcePath, false);
    if (updatedSource === undefined) {
      throw new Error("fs cp source stat completed without metadata");
    }
    await cpUtimes(
      destinationPath,
      updatedSource.atime,
      updatedSource.mtime,
    );
  }
  await cpChmod(destinationPath, source.mode);
}

async function onCpFile(
  source: Stats,
  destination: Stats | undefined,
  sourcePath: string,
  destinationPath: string,
  options: NormalizedCpOptions,
): Promise<void> {
  if (destination === undefined) {
    await copyCpFile(source, sourcePath, destinationPath, options);
  } else if (options.force) {
    await cpUnlink(destinationPath);
    await copyCpFile(source, sourcePath, destinationPath, options);
  } else if (options.errorOnExist) {
    throw new CpSystemError(
      "ERR_FS_CP_EEXIST",
      "EEXIST",
      `${destinationPath} already exists`,
      destinationPath,
    );
  }
}

async function onCpDirectory(
  source: Stats,
  destination: Stats | undefined,
  sourcePath: string,
  destinationPath: string,
  options: NormalizedCpOptions,
): Promise<void> {
  const made = destination === undefined;
  if (made) {
    await cpMkdir(destinationPath, false);
  } else if (options.errorOnExist && !options.force) {
    throw new CpSystemError(
      "ERR_FS_CP_EEXIST",
      "EEXIST",
      `${destinationPath} already exists`,
      destinationPath,
    );
  }
  const names = await cpReadDirectory(sourcePath);
  for (const name of names) {
    await copyCpEntry(
      joinPath(sourcePath, name),
      joinPath(destinationPath, name),
      options,
    );
  }
  if (made) await cpChmod(destinationPath, source.mode);
}

async function onCpLink(
  destination: Stats | undefined,
  sourcePath: string,
  destinationPath: string,
  options: NormalizedCpOptions,
): Promise<void> {
  let resolvedSource = await cpReadlink(sourcePath);
  if (!options.verbatimSymlinks && !isAbsolutePath(resolvedSource)) {
    resolvedSource = resolvePath(dirnamePath(sourcePath), resolvedSource);
  }
  if (destination === undefined) {
    await cpSymlink(resolvedSource, destinationPath);
    return;
  }

  let resolvedDestination: string;
  try {
    resolvedDestination = await cpReadlink(destinationPath);
  } catch (error) {
    if (cpErrorHasCode(error, "EINVAL") || cpErrorHasCode(error, "UNKNOWN")) {
      await cpSymlink(resolvedSource, destinationPath);
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
  const source = await cpFollowingStat(sourcePath, false);
  if (
    source !== undefined && source.isDirectory() &&
    isSrcSubdir(resolvedSource, resolvedDestination)
  ) {
    throw cpInvalidPath(
      `cannot copy ${resolvedSource} to a subdirectory of self ${resolvedDestination}`,
      destinationPath,
    );
  }
  const followedDestination = await cpFollowingStat(destinationPath, false);
  if (
    followedDestination !== undefined && followedDestination.isDirectory() &&
    isSrcSubdir(resolvedDestination, resolvedSource)
  ) {
    throw new CpSystemError(
      "ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY",
      "EINVAL",
      `cannot overwrite ${resolvedDestination} with ${resolvedSource}`,
      destinationPath,
    );
  }
  await cpUnlink(destinationPath);
  await cpSymlink(resolvedSource, destinationPath);
}

async function copyCpEntry(
  sourcePath: string,
  destinationPath: string,
  options: NormalizedCpOptions,
): Promise<void> {
  if (options.filter !== undefined && !(await options.filter(sourcePath, destinationPath))) {
    return;
  }
  await checkCpPaths(sourcePath, destinationPath, options);
  await ensureCpParent(destinationPath);
  const source = await cpNumberStat(sourcePath, options, false);
  if (source === undefined) {
    throw new Error("fs cp source stat completed without metadata");
  }
  const destination = await cpNumberStat(destinationPath, options, true);
  if (source.isDirectory()) {
    if (!options.recursive) {
      throw new CpSystemError(
        "ERR_FS_EISDIR",
        "EISDIR",
        `${sourcePath} is a directory (not copied)`,
        sourcePath,
      );
    }
    await onCpDirectory(source, destination, sourcePath, destinationPath, options);
  } else if (
    source.isFile() || source.isCharacterDevice() || source.isBlockDevice()
  ) {
    await onCpFile(source, destination, sourcePath, destinationPath, options);
  } else if (source.isSymbolicLink()) {
    await onCpLink(destination, sourcePath, destinationPath, options);
  } else if (source.isSocket()) {
    throw new CpSystemError(
      "ERR_FS_CP_SOCKET",
      "EINVAL",
      `cannot copy a socket file: ${destinationPath}`,
      destinationPath,
    );
  } else if (source.isFIFO()) {
    throw new CpSystemError(
      "ERR_FS_CP_FIFO_PIPE",
      "EINVAL",
      `cannot copy a FIFO pipe: ${destinationPath}`,
      destinationPath,
    );
  } else {
    throw new CpSystemError(
      "ERR_FS_CP_UNKNOWN",
      "EINVAL",
      `cannot copy an unknown file type: ${destinationPath}`,
      destinationPath,
    );
  }
}

export function cp(
  source: PathLike,
  destination: PathLike,
  callback: Callback,
): void;
export function cp(
  source: PathLike,
  destination: PathLike,
  options: CopyOptions,
  callback: Callback,
): void;
export function cp(
  source: unknown,
  destination: unknown,
  optionsOrCallback: CopyOptions | Callback,
  suppliedCallback?: Callback,
): void {
  let options: unknown;
  let callback: Callback | undefined;
  if (typeof optionsOrCallback === "function") {
    options = undefined;
    callback = optionsOrCallback;
  } else {
    options = optionsOrCallback;
    callback = suppliedCallback;
  }
  validateFunction(callback, "cb");
  const settings = normalizeCpOptions(options);
  const sourcePath = getValidatedPath(source, "src");
  const destinationPath = getValidatedPath(destination, "dest");
  const request = asRequest(callback, "cp");
  if (settings.preserveTimestamps && nts_fs_is_32_bit()) {
    emitWarning(
      "Using the preserveTimestamps option in 32-bit node is not recommended",
      "TimestampPrecisionWarning",
      "",
    );
  }
  copyCpEntry(sourcePath, destinationPath, settings).then(
    () => request(null),
    (error: unknown) => request(error),
  );
}

export function link(from: PathLike, to: PathLike, callback?: Callback): void {
  const validatedFrom = getValidatedPath(from, "existingPath");
  const validatedTo = getValidatedPath(to, "newPath");
  const request = asRequest(callback, "link");
  nts_fs_link_async(
    validatedFrom,
    validatedTo,
    settle(request, "link", validatedFrom, validatedTo),
  );
}

export function symlink(
  target: BytePathLike,
  at: BytePathLike,
  type: SymlinkType | Callback,
  callback?: Callback,
): void {
  if (typeof type === "function") {
    callback = type;
    type = undefined;
  }
  const flags = symlinkTypeFlags(type);
  const validatedTarget = getValidatedBytePath(target, "target");
  const validatedPath = getValidatedBytePath(at);
  const request = asRequest(callback, "symlink");
  const displayTarget = displayBytePath(validatedTarget);
  const displayPath = displayBytePath(validatedPath);
  if (typeof validatedTarget === "string" && typeof validatedPath === "string") {
    nts_fs_symlink_async(
      validatedTarget,
      validatedPath,
      flags,
      settle(request, "symlink", displayTarget, displayPath),
    );
    return;
  }
  nts_fs_symlink_bytes_async(
    bytePathForBinding(validatedTarget),
    bytePathForBinding(validatedPath),
    flags,
    settle(request, "symlink", displayTarget, displayPath),
  );
}

export function readlink(path: PathLike, callback: Callback<EncodedFileName>): void;
export function readlink(
  path: PathLike,
  options: string | FileOptions | null,
  callback: Callback<EncodedFileName>,
): void;
export function readlink(
  path: PathLike,
  optionsOrCallback: string | FileOptions | null | Callback<EncodedFileName>,
  callback?: Callback<EncodedFileName>,
): void {
  let options: string | FileOptions | null | undefined;
  if (typeof optionsOrCallback === "function") {
    callback = optionsOrCallback;
    options = undefined;
  } else {
    options = optionsOrCallback;
  }
  const settings = getOptions(options);
  const validatedPath = getValidatedPath(path);
  const request = asRequest(callback, "readlink");
  nts_fs_readlink_async(validatedPath, (errno: number, resolved: string) => {
    if (errno < 0) request(uvException(errno, "readlink", validatedPath));
    else request(null, encodeFileName(resolved, settings.encoding));
  });
}

class RealpathContext {
  #path: string;
  #options: FileOptions;
  #callback: Callback<EncodedFileName>;
  #knownHard = new Set<string>();
  #seenLinks = new Map<string, string>();
  #position = 1;
  #current = "/";
  #base = "/";
  #previous = "/";

  constructor(path: string, options: FileOptions, callback: Callback<EncodedFileName>) {
    this.#path = path;
    this.#options = options;
    this.#callback = callback;
  }

  start(): void {
    nextTick(() => this.#walk());
  }

  #walk(): void {
    if (this.#position >= this.#path.length) {
      this.#callback(null, encodeFileName(this.#path, this.#options.encoding));
      return;
    }

    const separator = this.#path.indexOf("/", this.#position);
    this.#previous = this.#current;
    if (separator === -1) {
      const last = this.#path.substring(this.#position);
      this.#current += last;
      this.#base = this.#previous + last;
      this.#position = this.#path.length;
    } else {
      this.#current += this.#path.substring(this.#position, separator + 1);
      this.#base = this.#previous + this.#path.substring(this.#position, separator);
      this.#position = separator + 1;
    }

    if (this.#knownHard.has(this.#base)) {
      nextTick(() => this.#walk());
      return;
    }
    lstat(this.#base, (error: unknown, stats?: AnyStats) => {
      this.#afterLstat(error, stats);
    });
  }

  #afterLstat(error: unknown, stats: AnyStats | undefined): void {
    if (error !== null && error !== undefined) {
      this.#callback(error);
      return;
    }
    if (stats === undefined) {
      this.#callback(new Error("fs lstat completed without file metadata"));
      return;
    }
    if (!stats.isSymbolicLink()) {
      this.#knownHard.add(this.#base);
      if (stats.isFIFO() || stats.isSocket()) {
        this.#callback(null, encodeFileName(this.#path, this.#options.encoding));
      } else {
        nextTick(() => this.#walk());
      }
      return;
    }

    const linkId = `${stats.dev}:${stats.ino}`;
    const knownTarget = this.#seenLinks.get(linkId);
    if (knownTarget !== undefined) {
      this.#follow(knownTarget);
      return;
    }
    stat(this.#base, (statError: unknown) => {
      if (statError !== null && statError !== undefined) {
        this.#callback(statError);
        return;
      }
      readlink(this.#base, (readError: unknown, target?: EncodedFileName) => {
        if (readError !== null && readError !== undefined) {
          this.#callback(readError);
          return;
        }
        if (typeof target !== "string") {
          this.#callback(new Error("fs readlink completed without a text target"));
          return;
        }
        this.#seenLinks.set(linkId, target);
        this.#follow(target);
      });
    });
  }

  #follow(target: string): void {
    this.#path = resolvePath(
      this.#previous,
      target,
      this.#path.substring(this.#position),
    );
    this.#position = 1;
    this.#current = "/";
    this.#base = "/";
    nextTick(() => this.#walk());
  }
}

export function realpath(path: BytePathLike, callback: Callback<EncodedFileName>): void;
export function realpath(
  path: BytePathLike,
  options: string | FileOptions | null,
  callback: Callback<EncodedFileName>,
): void;
export function realpath(
  path: BytePathLike,
  optionsOrCallback: string | FileOptions | null | Callback<EncodedFileName>,
  callback?: Callback<EncodedFileName>,
): void {
  let options: string | FileOptions | null | undefined;
  if (typeof optionsOrCallback === "function") {
    callback = optionsOrCallback;
    options = undefined;
  } else {
    options = optionsOrCallback;
  }
  validateFunction(callback, "cb");
  const settings = getOptions(options);
  const pathText = displayBytePath(getValidatedBytePath(path));
  new RealpathContext(resolvePath(pathText), settings, callback).start();
}

export function _realpathNative(
  path: BytePathLike,
  callback: Callback<EncodedFileName>,
): void;
export function _realpathNative(
  path: BytePathLike,
  options: string | FileOptions | null,
  callback: Callback<EncodedFileName>,
): void;
export function _realpathNative(
  path: BytePathLike,
  optionsOrCallback: string | FileOptions | null | Callback<EncodedFileName>,
  callback?: Callback<EncodedFileName>,
): void {
  let options: string | FileOptions | null | undefined;
  if (typeof optionsOrCallback === "function") {
    callback = optionsOrCallback;
    options = undefined;
  } else {
    options = optionsOrCallback;
  }
  const settings = getOptions(options);
  const encoding = normalizeFileResultEncoding(settings.encoding);
  const validatedPath = getValidatedBytePath(path);
  const request = asRequest(callback, "realpath");
  if (typeof validatedPath === "string" && (encoding === undefined || encoding === "utf8")) {
    nts_fs_realpath_async(validatedPath, (errno: number, resolved: string) => {
      if (errno < 0) request(uvException(errno, "realpath", validatedPath));
      else request(null, resolved);
    });
    return;
  }

  const displayPath = displayBytePath(validatedPath);
  nts_fs_realpath_bytes_async(
    bytePathForBinding(validatedPath),
    (errno: number, resolved: number[]) => {
      if (errno < 0) request(uvException(errno, "realpath", displayPath));
      else request(null, encodeFileBytes(resolved, encoding));
    },
  );
}

export function chmod(path: PathLike, mode: number | string, callback?: Callback): void {
  const validatedPath = getValidatedPath(path);
  const parsedMode = parseFileMode(mode, "mode");
  callback = asRequest(callback, "chmod");
  nts_fs_chmod_async(
    validatedPath,
    parsedMode,
    settle(callback, "chmod", validatedPath),
  );
}

export function chown(path: PathLike, uid: number, gid: number, callback?: Callback): void {
  callback = asRequest(callback, "chown");
  const validatedPath = getValidatedPath(path);
  validateOwnerId(uid, "uid");
  validateOwnerId(gid, "gid");
  nts_fs_chown_async(
    validatedPath,
    uid,
    gid,
    settle(callback, "chown", validatedPath),
  );
}

export function lchown(
  path: BytePathLike,
  uid: number,
  gid: number,
  callback?: Callback,
): void {
  const request = asRequest(callback, "lchown");
  const validatedPath = getValidatedBytePath(path);
  validateOwnerId(uid, "uid");
  validateOwnerId(gid, "gid");
  const displayPath = displayBytePath(validatedPath);
  const settled = settle(request, "lchown", displayPath);
  if (typeof validatedPath === "string") {
    nts_fs_lchown_async(validatedPath, uid, gid, settled);
  } else {
    nts_fs_lchown_bytes_async(validatedPath, uid, gid, settled);
  }
}

export function truncate(
  path: BytePathLike,
  length: number | undefined | Callback,
  callback?: Callback,
): void {
  if (typeof length === "function") {
    callback = length;
    length = 0;
  }
  const validatedLength = length === undefined ? 0 : length;
  validateInteger(validatedLength, "len");
  validateFunction(callback, "cb");
  const complete = callback;
  open(path, "r+", (openError: unknown, fd?: number) => {
    if (openError !== null && openError !== undefined) {
      complete(openError);
      return;
    }
    if (fd === undefined) {
      complete(new Error("fs open completed without a file descriptor"));
      return;
    }
    ftruncate(fd, validatedLength, (truncateError: unknown) => {
      close(fd, (closeError: unknown) => {
        complete(aggregateTwoErrors(closeError, truncateError));
      });
    });
  });
}

export function ftruncate(
  fd: number,
  length: number | undefined | Callback,
  callback?: Callback,
): void {
  if (typeof length === "function") {
    callback = length;
    length = 0;
  }
  const validatedLength = length === undefined ? 0 : length;
  validateInteger(validatedLength, "len");
  callback = asRequest(callback, "ftruncate");
  validateFileDescriptor(fd);
  nts_fs_ftruncate_async(
    fd,
    Math.max(0, validatedLength),
    settle(callback, "ftruncate"),
  );
}

export function utimes(
  path: PathLike,
  atime: number | string | Date,
  mtime: number | string | Date,
  callback?: Callback,
): void {
  callback = asRequest(callback, "utimes");
  const validatedPath = getValidatedPath(path);
  nts_fs_utimes_async(
    validatedPath,
    toUnixTimestamp(atime, "atime"),
    toUnixTimestamp(mtime, "mtime"),
    settle(callback, "utime", validatedPath),
  );
}

export function lutimes(
  path: PathLike,
  atime: number | string | Date,
  mtime: number | string | Date,
  callback?: Callback,
): void {
  callback = asRequest(callback, "lutimes");
  const validatedPath = getValidatedPath(path);
  nts_fs_lutimes_async(
    validatedPath,
    toUnixTimestamp(atime, "atime"),
    toUnixTimestamp(mtime, "mtime"),
    settle(callback, "lutime", validatedPath),
  );
}

export function fsync(fd: number, callback?: Callback): void {
  callback = asRequest(callback, "fsync");
  validateFileDescriptor(fd);
  nts_fs_fsync_async(fd, settle(callback, "fsync"));
}

export function fdatasync(fd: number, callback?: Callback): void {
  callback = asRequest(callback, "fdatasync");
  validateFileDescriptor(fd);
  nts_fs_fdatasync_async(fd, settle(callback, "fdatasync"));
}

export function mkdtemp(path: BytePathLike, callback: Callback<EncodedFileName>): void;
export function mkdtemp(
  prefix: BytePathLike,
  options: string | FileOptions | null,
  callback: Callback<EncodedFileName>,
): void;
export function mkdtemp(
  prefix: BytePathLike,
  optionsOrCallback: string | FileOptions | null | Callback<EncodedFileName>,
  callback?: Callback<EncodedFileName>,
): void {
  let options: string | FileOptions | null | undefined;
  if (typeof optionsOrCallback === "function") {
    callback = optionsOrCallback;
    options = undefined;
  } else {
    options = optionsOrCallback;
  }
  const settings = getOptions(options);
  const validatedPrefix = getValidatedBytePath(prefix, "prefix");
  warnOnNonPortableTemplate(validatedPrefix);
  const request = asRequest(callback, "mkdtemp");
  if (typeof validatedPrefix === "string") {
    nts_fs_mkdtemp_async(`${validatedPrefix}XXXXXX`, (errno: number, created: string) => {
      if (errno < 0) request(uvException(errno, "mkdtemp", validatedPrefix));
      else request(null, encodeFileName(created, settings.encoding));
    });
    return;
  }

  const displayPath = Buffer.from(validatedPrefix).toString();
  nts_fs_mkdtemp_bytes_async(
    appendMkdtempSuffix(validatedPrefix),
    (errno: number, created: number[]) => {
      if (errno < 0) request(uvException(errno, "mkdtemp", displayPath));
      else request(null, encodeFileBytes(created, settings.encoding));
    },
  );
}

export function fchmod(fd: number, mode: number | string, callback?: Callback): void {
  const parsedMode = parseFileMode(mode, "mode");
  callback = asRequest(callback, "fchmod");
  validateFileDescriptor(fd);
  nts_fs_fchmod_async(fd, parsedMode, settle(callback, "fchmod"));
}

export function fchown(fd: number, uid: number, gid: number, callback?: Callback): void {
  validateOwnerId(uid, "uid");
  validateOwnerId(gid, "gid");
  callback = asRequest(callback, "fchown");
  validateFileDescriptor(fd);
  nts_fs_fchown_async(fd, uid, gid, settle(callback, "fchown"));
}

export function futimes(
  fd: number,
  atime: number | string | Date,
  mtime: number | string | Date,
  callback?: Callback,
): void {
  const accessTime = toUnixTimestamp(atime, "atime");
  const modificationTime = toUnixTimestamp(mtime, "mtime");
  callback = asRequest(callback, "futimes");
  validateFileDescriptor(fd);
  nts_fs_futimes_async(fd, accessTime, modificationTime, settle(callback, "futime"));
}
