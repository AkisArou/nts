// `node:fs/promises`, from node v24.20.0 `lib/internal/fs/promises.js`.
//
// The same operations again, returning promises. Node implements these
// directly on its binding rather than wrapping the callback forms; here they
// wrap, because the only difference that would make is one microtask -- which
// is what a promise costs anyway -- and a second implementation of the
// argument handling is a second place for it to be wrong.
//
// `open` is the exception, and the reason this file is more than a loop over
// names. It resolves to a `FileHandle` rather than a number, which is the one
// place where the promise API is a different *design* and not a different
// spelling: a file descriptor is an integer that means nothing on its own and
// that nothing will close for you, while a handle carries its own operations
// and can be disposed.

import { Buffer } from "../../buffer/src/main.ts";
import type { Encoding } from "../../buffer/src/encodings.ts";
import { EventEmitter } from "../../events/src/main.ts";
import { Interface as ReadLineInterface } from "../../readline/src/interface.ts";
import type { Readable } from "../../stream/src/readable.ts";
import * as constants from "./constants.ts";
import {
  aggregateTwoErrors,
  AbortError,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_STATE,
  ERR_INVALID_STATE_TYPE,
  ERR_METHOD_NOT_IMPLEMENTED,
  ERR_OPERATION_FAILED,
  ERR_OUT_OF_RANGE,
} from "../../internal/errors.ts";
import {
  validateAbortSignal,
  validateBoolean,
  validateInteger,
  validateObject,
} from "../../internal/validators.ts";
import { uvException } from "../../internal/uv.ts";
import * as callbacks from "./async.ts";
import { isBigIntStatFs, isBigIntStats } from "./stats.ts";
import type {
  BigIntStats,
  Dirent,
  StatFs,
  StatFsOptions,
  StatOptions,
  StatSyncOptions,
  Stats,
} from "./stats.ts";
import {
  getOptions,
  getValidatedPath,
  requireTextEncoding,
  type EncodedFileName,
  type AbortSignalLike,
  type FileOptions,
  type BytePathLike,
  type PathLike,
  type RmdirOptions,
  type RmOptions,
} from "./options.ts";
import { normalizeCpOptions, type CopyOptions } from "./cp-common.ts";
import { bufferLengths, flattenBuffers } from "./vector-io.ts";
import type { FileStreamOptions, ReadStream, WriteStream } from "./streams.ts";
import {
  Dir,
  opendir as opendirCallback,
  type OpenDirOptions,
} from "./dir.ts";
import { resolve as resolvePath } from "../../path/src/posix.ts";

export { constants };

// The synchronous half of FileHandle.writer uses the same established native
// operations as fs.writeSync/writevSync/closeSync. They are declared here too
// because importing main.ts would create the cycle main -> promises -> main.
declare function nts_fs_write(fd: number, bytes: number[], position: number): number;
declare function nts_fs_writev(
  fd: number,
  bytes: number[],
  lengths: number[],
  position: number,
): number;
declare function nts_fs_close(fd: number): number;

/**
 * The file streams, filled in by `main.ts`.
 *
 * A hole rather than an import: `streams.ts` imports this file for the
 * operations it drives, so importing it back would be a cycle.
 */
type ReadStreamFactory = (path: string | null, options?: FileStreamOptions) => ReadStream;
type WriteStreamFactory = (path: string | null, options?: FileStreamOptions) => WriteStream;

let createReadStreamImpl: ReadStreamFactory =
  () => {
    throw new Error("fs/streams has not been loaded");
  };
let createWriteStreamImpl: WriteStreamFactory =
  () => {
    throw new Error("fs/streams has not been loaded");
  };

export function setStreamFactories(
  read: ReadStreamFactory,
  write: WriteStreamFactory,
): void {
  createReadStreamImpl = read;
  createWriteStreamImpl = write;
}

/** A value-producing callback operation as a promise-returning one. */
function promisifyValue<A extends unknown[], T>(
  fn: (...args: [...A, (error: unknown, value?: T) => void]) => void,
  operation: string,
): (...args: A) => Promise<T> {
  return (...args: A) =>
    new Promise<T>((resolve, reject) => {
      fn(...args, (error: unknown, value?: T) => {
        if (error !== null && error !== undefined) {
          reject(error);
        } else if (value === undefined) {
          reject(new Error(`fs ${operation} completed without a result`));
        } else {
          resolve(value);
        }
      });
    });
}

/** A callback operation whose successful result is intentionally absent. */
function promisifyVoid<A extends unknown[]>(
  fn: (...args: [...A, (error: unknown) => void]) => void,
): (...args: A) => Promise<void> {
  return (...args: A) =>
    new Promise<void>((resolve, reject) => {
      fn(...args, (error: unknown) => {
        if (error !== null && error !== undefined) reject(error);
        else resolve();
      });
    });
}

/** A value callback where `undefined` is a documented successful result. */
function promisifyOptionalValue<A extends unknown[], T>(
  fn: (...args: [...A, (error: unknown, value?: T) => void]) => void,
): (...args: A) => Promise<T | undefined> {
  return (...args: A) =>
    new Promise<T | undefined>((resolve, reject) => {
      fn(...args, (error: unknown, value?: T) => {
        if (error !== null && error !== undefined) reject(error);
        else resolve(value);
      });
    });
}

/**
 * An open file, and everything you can do with it.
 *
 * The point over a bare descriptor is ownership. A number can be leaked, can
 * be closed twice, and can be used after closing -- by which time the kernel
 * may have handed it to something else, so the read succeeds and reads the
 * wrong file. A handle can be disposed, knows whether it is closed, and is
 * the only thing holding the number.
 */
interface FileHandleReadOptions {
  buffer?: ArrayBufferView;
  offset?: number | null;
  length?: number | null;
  position?: number | bigint | null;
}

interface FileHandleWriteOptions {
  offset?: number;
  length?: number;
  position?: number;
}

/** One value accepted directly, or yielded, by the promise write APIs. */
export type FileWriteChunk = string | ArrayBufferView;

/** The complete data surface accepted by promise writeFile/appendFile. */
export type FileWriteData =
  | FileWriteChunk
  | Iterable<FileWriteChunk>
  | AsyncIterable<FileWriteChunk>
  | Readable;

type UnknownFileWriteIterable = Iterable<unknown> | AsyncIterable<unknown>;
type FileWriteInput = FileWriteChunk | UnknownFileWriteIterable;
const writeFileMaxChunkSize = 512 * 1024;

function isFileWriteIterable(
  value: unknown,
): value is UnknownFileWriteIterable {
  if (
    value === null ||
    typeof value === "string" ||
    ArrayBuffer.isView(value) ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }
  const hasAsyncIterator = Symbol.asyncIterator in value &&
    typeof value[Symbol.asyncIterator] === "function";
  const hasIterator = Symbol.iterator in value &&
    typeof value[Symbol.iterator] === "function";
  return hasAsyncIterator || hasIterator;
}

function requireFileWriteData(value: unknown): FileWriteInput {
  if (
    typeof value !== "string" &&
    !ArrayBuffer.isView(value) &&
    !isFileWriteIterable(value)
  ) {
    throw new ERR_INVALID_ARG_TYPE(
      "data",
      [
        "string",
        "Buffer",
        "TypedArray",
        "DataView",
        "AsyncIterable",
        "Iterable",
        "Stream",
      ],
      value,
    );
  }
  return value;
}

function throwIfWriteAborted(signal: AbortSignalLike | undefined): void {
  if (signal?.aborted) {
    throw new AbortError(undefined, { cause: signal.reason });
  }
}

/** Pinned Node's incremental `writeFileHandle` algorithm. */
async function writeFileHandle(
  handle: FileHandle,
  data: FileWriteInput,
  signal: AbortSignalLike | undefined,
  encoding: Encoding,
): Promise<void> {
  throwIfWriteAborted(signal);

  if (isFileWriteIterable(data)) {
    for await (const chunk of data) {
      throwIfWriteAborted(signal);
      let bytes: ArrayBufferView;
      if (typeof chunk === "string") {
        bytes = Buffer.from(chunk, encoding);
      } else if (ArrayBuffer.isView(chunk)) {
        bytes = new Uint8Array(
          chunk.buffer,
          chunk.byteOffset,
          chunk.byteLength,
        );
      } else {
        throw new ERR_INVALID_ARG_TYPE(
          "data",
          ["string", "Buffer", "TypedArray", "DataView"],
          chunk,
        );
      }

      let offset = 0;
      while (offset < bytes.byteLength) {
        const length = Math.min(
          writeFileMaxChunkSize,
          bytes.byteLength - offset,
        );
        const { bytesWritten } = await handle.write(bytes, offset, length, null);
        if (bytesWritten === 0) {
          throw new Error("fs write made no progress");
        }
        offset += bytesWritten;
        throwIfWriteAborted(signal);
      }
    }
  } else {
    let bytes: ArrayBufferView;
    if (typeof data === "string") {
      bytes = Buffer.from(data, encoding);
    } else if (ArrayBuffer.isView(data)) {
      bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else {
      throw new Error("validated fs write data lost its scalar representation");
    }

    let offset = 0;
    while (offset < bytes.byteLength) {
      throwIfWriteAborted(signal);
      const length = Math.min(
        writeFileMaxChunkSize,
        bytes.byteLength - offset,
      );
      const { bytesWritten } = await handle.write(bytes, offset, length, null);
      if (bytesWritten === 0) {
        throw new Error("fs write made no progress");
      }
      offset += bytesWritten;
    }
  }
}

async function writeFileToOpenHandle(
  handle: FileHandle,
  data: unknown,
  options: string | FileOptions | undefined,
): Promise<void> {
  const settings = getOptions(options, { encoding: "utf8", flush: false });
  const flush = settings.flush ?? false;
  validateBoolean(flush, "options.flush");
  const encoding = requireTextEncoding(
    settings.encoding || "utf8",
    "options.encoding",
  );
  await writeFileHandle(
    handle,
    requireFileWriteData(data),
    settings.signal,
    encoding,
  );
}

/** Bytes accepted by Node's experimental FileHandle writer. */
export type FileHandleWriterChunk = string | ArrayBufferView;

export interface FileHandleWriterOptions {
  autoClose?: boolean | undefined;
  start?: number | undefined;
  limit?: number | undefined;
  chunkSize?: number | undefined;
}

export interface FileHandleWriterOperationOptions {
  signal?: AbortSignalLike | undefined;
}

interface RawFileHandleWriterOptions {
  autoClose?: unknown;
  start?: unknown;
  limit?: unknown;
  chunkSize?: unknown;
}

interface NormalizedFileHandleWriterOptions {
  autoClose: boolean;
  start: number;
  limit: number;
  chunkSize: number;
}

interface RawFileHandleWriterOperationOptions {
  signal?: unknown;
}

function writerOptionsObject(
  value: unknown,
): asserts value is RawFileHandleWriterOptions {
  validateObject(value, "options");
}

function normalizeWriterOptions(value: unknown): NormalizedFileHandleWriterOptions {
  const options = value === undefined ? {} : value;
  writerOptionsObject(options);

  const autoClose = options.autoClose === undefined ? false : options.autoClose;
  const chunkSize = options.chunkSize === undefined ? 128 * 1024 : options.chunkSize;

  validateBoolean(autoClose, "options.autoClose");
  validateInteger(chunkSize, "options.chunkSize", 1);

  // Keep the internal -1 sentinel distinct from an explicitly supplied -1,
  // which Node rejects for both public options.
  let start = -1;
  if (options.start !== undefined) {
    validateInteger(options.start, "options.start", 0);
    start = options.start;
  }
  let limit = -1;
  if (options.limit !== undefined) {
    validateInteger(options.limit, "options.limit", 1);
    limit = options.limit;
  }
  return { autoClose, start, limit, chunkSize };
}

function writerSignal(
  value: unknown,
): asserts value is AbortSignalLike | undefined {
  validateAbortSignal(value, "options.signal");
}

function writerOperationSignal(value: unknown): AbortSignalLike | undefined {
  if (value === undefined) return undefined;
  validateObject(value, "options");
  const options: RawFileHandleWriterOperationOptions = value;
  writerSignal(options.signal);
  return options.signal;
}

function writerChunkBytes(value: unknown): Uint8Array {
  if (typeof value === "string") return Buffer.from(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new ERR_INVALID_ARG_TYPE(
    "chunk",
    ["string", "Buffer", "TypedArray", "DataView"],
    value,
  );
}

function writerChunks(value: unknown): Uint8Array[] {
  if (!Array.isArray(value)) {
    throw new ERR_INVALID_ARG_TYPE("chunks", "Array", value);
  }
  const chunks = new Array<Uint8Array>(value.length);
  for (let index = 0; index < value.length; index++) {
    chunks[index] = writerChunkBytes(value[index]);
  }
  return chunks;
}

function copyWriterBytes(value: Uint8Array, offset: number, length: number): number[] {
  const bytes = new Array<number>(length);
  for (let index = 0; index < length; index++) {
    const byte = value[offset + index];
    if (byte === undefined) {
      throw new Error(`FileHandle writer is missing byte ${offset + index}`);
    }
    bytes[index] = byte;
  }
  return bytes;
}

export class FileHandle extends EventEmitter {
  #fd: number;
  #references = 1;
  #closePromise: Promise<void> | undefined;
  #resolveClose: (() => void) | undefined;
  #rejectClose: ((error: unknown) => void) | undefined;
  #descriptorClosed = false;
  #writerLocked = false;

  constructor(fd: number) {
    super();
    this.#fd = fd;
  }

  get fd(): number {
    return this.#fd;
  }

  /** Retain the descriptor while a file stream owns an operation reference. */
  _refForStream(): void {
    if (this.#descriptorClosed) {
      throw new Error("Cannot retain a closed FileHandle");
    }
    this.#references++;
  }

  /** Release the reference acquired when a file stream adopted this handle. */
  _unrefForStream(): void {
    if (this.#references <= 0) {
      throw new Error("FileHandle stream reference count underflow");
    }
    this.#references--;
    if (this.#references === 0 && this.#closePromise !== undefined) {
      this.#closeDescriptor();
    }
  }

  async read(
    options?: FileHandleReadOptions | null,
  ): Promise<{ bytesRead: number; buffer: ArrayBufferView }>;
  async read<T extends ArrayBufferView>(
    buffer: T,
    options?: { offset?: number | null; length?: number | null; position?: number | bigint | null } | null,
  ): Promise<{ bytesRead: number; buffer: T }>;
  async read<T extends ArrayBufferView>(
    buffer: T,
    offset?: number | null,
    length?: number,
    position?: number | bigint | null,
  ): Promise<{ bytesRead: number; buffer: T }>;
  async read(
    bufferOrOptions?: ArrayBufferView | FileHandleReadOptions | null,
    offsetOrOptions: number | null | {
      offset?: number | null;
      length?: number | null;
      position?: number | bigint | null;
    } = 0,
    length?: number,
    position: number | bigint | null = null,
  ): Promise<{ bytesRead: number; buffer: ArrayBufferView }> {
    if (!ArrayBuffer.isView(bufferOrOptions)) {
      const options = bufferOrOptions ?? {};
      const buffer = options.buffer ?? Buffer.alloc(16_384);
      return this.#readView(buffer, options);
    }
    return this.#readView(bufferOrOptions, offsetOrOptions, length, position);
  }

  #readView<T extends ArrayBufferView>(
    buffer: T,
    offsetOrOptions: number | null | FileHandleReadOptions = 0,
    length?: number,
    position: number | bigint | null = null,
  ): Promise<{ bytesRead: number; buffer: T }> {
    return new Promise((resolve, reject) => {
      const complete = (error: unknown, bytesRead?: number): void => {
        if (error !== null && error !== undefined) {
          reject(error);
        } else if (bytesRead === undefined) {
          reject(new Error("fs read completed without a byte count"));
        } else {
          resolve({ bytesRead, buffer });
        }
      };
      if (typeof offsetOrOptions === "object") {
        const offset = offsetOrOptions?.offset ?? 0;
        callbacks.read(this.#fd, buffer, {
          buffer,
          offset,
          length: offsetOrOptions?.length ?? buffer.byteLength - offset,
          position: offsetOrOptions?.position ?? null,
        }, complete);
      } else {
        const offset = offsetOrOptions ?? 0;
        callbacks.read(
          this.#fd,
          buffer,
          offset,
          length == null ? buffer.byteLength - offset : length,
          position,
          complete,
        );
      }
    });
  }

  async write<T extends ArrayBufferView>(
    data: T,
    offset?: number | null,
    length?: number,
    position?: number | null,
  ): Promise<{ bytesWritten: number; buffer: T }>;
  async write<T extends ArrayBufferView>(
    data: T,
    options?: FileHandleWriteOptions | null,
  ): Promise<{ bytesWritten: number; buffer: T }>;
  async write(
    data: string,
    position?: number | null,
    encoding?: string | null,
  ): Promise<{ bytesWritten: number; buffer: string }>;
  async write(
    data: unknown,
    offsetOrOptions: number | null | FileHandleWriteOptions = 0,
    length?: number | string | null,
    position: number | null = null,
  ): Promise<{ bytesWritten: number; buffer: string | ArrayBufferView }> {
    if (typeof data !== "string" && !ArrayBuffer.isView(data)) {
      throw new ERR_INVALID_ARG_TYPE(
        "buffer",
        ["Buffer", "TypedArray", "DataView", "string"],
        data,
      );
    }
    return new Promise((resolve, reject) => {
      const complete = (error: unknown, written?: number): void => {
        if (error !== null && error !== undefined) {
          reject(error);
        } else if (written === undefined) {
          reject(new Error("fs write completed without a byte count"));
        } else {
          resolve({ bytesWritten: written, buffer: data });
        }
      };
      if (typeof data === "string") {
        callbacks.write(
          this.#fd,
          data,
          typeof offsetOrOptions === "number" ? offsetOrOptions : null,
          typeof length === "string" ? length : "utf8",
          complete,
        );
      } else if (typeof offsetOrOptions === "object" && offsetOrOptions !== null) {
        callbacks.write(this.#fd, data, offsetOrOptions, complete);
      } else {
        const start = offsetOrOptions ?? 0;
        callbacks.write(
          this.#fd,
          data,
          start,
          typeof length === "number" ? length : data.byteLength - start,
          position,
          complete,
        );
      }
    });
  }

  async readv<T extends readonly ArrayBufferView[]>(
    buffers: T,
    position: number | null = null,
  ): Promise<{ bytesRead: number; buffers: T }> {
    return new Promise((resolve, reject) => {
      callbacks.readv(this.#fd, buffers, position, (error, bytesRead) => {
        if (error !== null && error !== undefined) {
          reject(error);
        } else if (bytesRead === undefined) {
          reject(new Error("fs readv completed without a byte count"));
        } else {
          resolve({ bytesRead, buffers });
        }
      });
    });
  }

  async writev<T extends readonly ArrayBufferView[]>(
    buffers: T,
    position: number | null = null,
  ): Promise<{ bytesWritten: number; buffers: T }> {
    return new Promise((resolve, reject) => {
      callbacks.writev(this.#fd, buffers, position, (error, bytesWritten) => {
        if (error !== null && error !== undefined) {
          reject(error);
        } else if (bytesWritten === undefined) {
          reject(new Error("fs writev completed without a byte count"));
        } else {
          resolve({ bytesWritten, buffers });
        }
      });
    });
  }

  /**
   * A bounded writer over this handle.
   *
   * The writer retains the descriptor until it ends or fails. That is the
   * important ownership rule: `handle.close()` may begin while a write is in
   * flight, but the numeric descriptor cannot be reused by the OS underneath
   * that operation.
   */
  writer(options?: FileHandleWriterOptions): FileHandleWriter;
  writer(options?: unknown): FileHandleWriter {
    if (this.#descriptorClosed) {
      throw new ERR_INVALID_STATE("The FileHandle is closed");
    }
    if (this.#closePromise !== undefined) {
      throw new ERR_INVALID_STATE("The FileHandle is closing");
    }
    if (this.#writerLocked) {
      throw new ERR_INVALID_STATE("The FileHandle is locked");
    }

    const settings = normalizeWriterOptions(options);
    this.#writerLocked = true;
    this._refForStream();
    return new FileHandleWriterImplementation(this, this.#fd, settings);
  }

  /** Release the descriptor reference owned by one completed writer. */
  async _finishWriter(autoClose: boolean): Promise<void> {
    if (!this.#writerLocked) return;
    this.#writerLocked = false;
    this._unrefForStream();
    if (autoClose) await this.close();
  }

  /** The synchronous counterpart used by fail() and endSync(). */
  _finishWriterSync(autoClose: boolean): void {
    if (!this.#writerLocked) return;
    this.#writerLocked = false;
    if (this.#references <= 0) {
      throw new Error("FileHandle writer reference count underflow");
    }
    this.#references--;

    if (autoClose && this.#closePromise === undefined && !this.#descriptorClosed) {
      this.#beginClose(true);
      return;
    }
    if (this.#references === 0 && this.#closePromise !== undefined) {
      this.#closeDescriptorSync();
    }
  }

  async readFile(options?: string | FileOptions): Promise<string | Buffer> {
    return new Promise((resolve, reject) => {
      callbacks.readFile(this.#fd, options ?? null, (error, contents) => {
        if (error !== null && error !== undefined) {
          reject(error);
        } else if (contents === undefined) {
          reject(new Error("fs readFile completed without file contents"));
        } else {
          resolve(contents);
        }
      });
    });
  }

  readLines(options?: FileStreamOptions): ReadLineInterface {
    return new ReadLineInterface({
      input: this.createReadStream(options),
      crlfDelay: Infinity,
    });
  }

  async writeFile(data: FileWriteData, options?: string | FileOptions): Promise<void>;
  async writeFile(data: unknown, options?: string | FileOptions): Promise<void> {
    await writeFileToOpenHandle(this, data, options);
  }

  async appendFile(data: FileWriteData, options?: string | FileOptions): Promise<void>;
  async appendFile(data: unknown, options?: string | FileOptions): Promise<void> {
    await writeFileToOpenHandle(this, data, options);
  }

  async chmod(mode: number): Promise<void> {
    await promisifyVoid(callbacks.fchmod)(this.#fd, mode);
  }

  async chown(uid: number, gid: number): Promise<void> {
    await promisifyVoid(callbacks.fchown)(this.#fd, uid, gid);
  }

  async utimes(atime: number | Date, mtime: number | Date): Promise<void> {
    await promisifyVoid(callbacks.futimes)(this.#fd, atime, mtime);
  }

  /**
   * A stream over this handle, which does *not* own the descriptor.
   *
   * `autoClose: false` because the handle owns it: a stream that closed the
   * descriptor would leave the handle holding a number that now refers to
   * whatever the operating system next handed out.
   */
  createReadStream(options: FileStreamOptions = {}): ReadStream {
    return createReadStreamImpl(null, { ...options, fd: this });
  }

  createWriteStream(options: FileStreamOptions = {}): WriteStream {
    return createWriteStreamImpl(null, { ...options, fd: this });
  }

  stat(options: StatOptions & { bigint: true }): Promise<BigIntStats>;
  stat(options?: StatOptions & { bigint?: false }): Promise<Stats>;
  stat(options?: StatOptions): Promise<Stats | BigIntStats>;
  stat(options?: StatOptions): Promise<Stats | BigIntStats> {
    if (options?.bigint === true) {
      return new Promise<BigIntStats>((resolve, reject) => {
        callbacks.fstatFileHandle(this.#fd, options, (error, value) => {
          if (error !== null && error !== undefined) reject(error);
          else if (value === undefined) {
            reject(new Error("fs fstat completed without a result"));
          } else if (isBigIntStats(value)) {
            resolve(value);
          } else {
            reject(new Error("fs fstat returned numeric data for a bigint request"));
          }
        });
      });
    }
    return new Promise<Stats>((resolve, reject) => {
      callbacks.fstatFileHandle(this.#fd, options, (error, value) => {
        if (error !== null && error !== undefined) reject(error);
        else if (value === undefined) {
          reject(new Error("fs fstat completed without a result"));
        } else if (!isBigIntStats(value)) {
          resolve(value);
        } else {
          reject(new Error("fs fstat returned bigint data for a numeric request"));
        }
      });
    });
  }

  async truncate(length = 0): Promise<void> {
    await promisifyVoid(callbacks.ftruncate)(this.#fd, length);
  }

  async sync(): Promise<void> {
    await promisifyVoid(callbacks.fsync)(this.#fd);
  }

  async datasync(): Promise<void> {
    await promisifyVoid(callbacks.fdatasync)(this.#fd);
  }

  /**
   * Close the file. Closing twice is not an error.
   *
   * Idempotent because the alternative is worse: a handle closed by a
   * `finally` and again by a `using` declaration is ordinary code, and making
   * the second close throw would turn tidy cleanup into a failure.
   */
  close(): Promise<void> {
    return this.#beginClose(false);
  }

  #beginClose(synchronous: boolean): Promise<void> {
    if (this.#descriptorClosed) return Promise.resolve();
    const pending = this.#closePromise;
    if (pending !== undefined) return pending;

    this.#references--;
    let resolveClose = (): void => {};
    let rejectClose = (_error: unknown): void => {};
    const closePromise = new Promise<void>((resolve, reject) => {
      resolveClose = resolve;
      rejectClose = reject;
    });
    this.#closePromise = closePromise;
    this.#resolveClose = resolveClose;
    this.#rejectClose = rejectClose;
    this.emit("close");
    if (this.#references === 0) {
      if (synchronous) this.#closeDescriptorSync();
      else this.#closeDescriptor();
    }
    return closePromise;
  }

  #closeDescriptor(): void {
    if (this.#descriptorClosed) return;
    this.#descriptorClosed = true;
    const fd = this.#fd;
    this.#fd = -1;
    callbacks.close(fd, (error) => {
      this.#settleClose(error);
    });
  }

  #closeDescriptorSync(): void {
    if (this.#descriptorClosed) return;
    this.#descriptorClosed = true;
    const fd = this.#fd;
    this.#fd = -1;
    const result = nts_fs_close(fd);
    if (result < 0) {
      const error = uvException(result, "close");
      this.#settleClose(error);
      throw error;
    }
    this.#settleClose(undefined);
  }

  #settleClose(error: unknown): void {
    const resolve = this.#resolveClose;
    const reject = this.#rejectClose;
    this.#resolveClose = undefined;
    this.#rejectClose = undefined;
    this.#closePromise = undefined;
    if (error !== null && error !== undefined) reject?.(error);
    else resolve?.();
  }

}

/** The ordinary, statically callable surface of FileHandle.writer(). */
export interface FileHandleWriter {
  write(
    chunk: FileHandleWriterChunk,
    options?: FileHandleWriterOperationOptions,
  ): Promise<void>;
  writev(
    chunks: readonly FileHandleWriterChunk[],
    options?: FileHandleWriterOperationOptions,
  ): Promise<void>;
  writeSync(chunk: FileHandleWriterChunk): boolean;
  writevSync(chunks: readonly FileHandleWriterChunk[]): boolean;
  end(options?: FileHandleWriterOperationOptions): Promise<number>;
  endSync(): number;
  fail(reason?: unknown): void;
}

/**
 * One writer state machine.
 *
 * This is a class rather than the upstream null-prototype object full of
 * closures. Its state has a fixed layout, every transition is explicit, and
 * no method lookup or property shaping is needed to create it.
 */
class FileHandleWriterImplementation implements FileHandleWriter {
  readonly #handle: FileHandle;
  readonly #fd: number;
  readonly #autoClose: boolean;
  readonly #syncWriteThreshold: number;
  #position: number;
  #bytesRemaining: number;
  #totalBytesWritten = 0;
  #closed = false;
  #closing = false;
  #pendingEnd: Promise<number> | undefined;
  #error: unknown = undefined;
  #asyncOperations = 0;

  constructor(
    handle: FileHandle,
    fd: number,
    options: NormalizedFileHandleWriterOptions,
  ) {
    this.#handle = handle;
    this.#fd = fd;
    this.#autoClose = options.autoClose;
    this.#syncWriteThreshold = options.chunkSize;
    this.#position = options.start;
    this.#bytesRemaining = options.limit;
  }

  write(
    chunk: FileHandleWriterChunk,
    options?: FileHandleWriterOperationOptions,
  ): Promise<void>;
  write(chunk: unknown, options?: unknown): Promise<void> {
    if (this.#error !== undefined) return Promise.reject(this.#error);
    if (this.#closed) {
      return Promise.reject(new ERR_INVALID_STATE_TYPE("The writer is closed"));
    }
    const signal = writerOperationSignal(options);
    if (signal?.aborted) return Promise.reject(signal.reason);

    const bytes = writerChunkBytes(chunk);
    if (this.#bytesRemaining >= 0 && bytes.byteLength > this.#bytesRemaining) {
      return Promise.reject(
        new ERR_OUT_OF_RANGE(
          "write",
          `<= ${this.#bytesRemaining} bytes`,
          bytes.byteLength,
        ),
      );
    }
    if (this.#bytesRemaining > 0) this.#bytesRemaining -= bytes.byteLength;
    const position = this.#position;
    if (this.#position >= 0) this.#position += bytes.byteLength;
    return this.#writeAll(bytes, 0, bytes.byteLength, position, signal);
  }

  writev(
    chunks: readonly FileHandleWriterChunk[],
    options?: FileHandleWriterOperationOptions,
  ): Promise<void>;
  writev(chunks: unknown, options?: unknown): Promise<void> {
    if (this.#error !== undefined) return Promise.reject(this.#error);
    if (this.#closed) {
      return Promise.reject(new ERR_INVALID_STATE_TYPE("The writer is closed"));
    }
    const signal = writerOperationSignal(options);
    if (signal?.aborted) return Promise.reject(signal.reason);

    const bytes = writerChunks(chunks);
    let totalSize = 0;
    for (let index = 0; index < bytes.length; index++) {
      const chunk = bytes[index];
      if (chunk === undefined) throw new Error(`FileHandle writer is missing chunk ${index}`);
      totalSize += chunk.byteLength;
    }
    if (this.#bytesRemaining >= 0 && totalSize > this.#bytesRemaining) {
      return Promise.reject(
        new ERR_OUT_OF_RANGE("writev", `<= ${this.#bytesRemaining} bytes`, totalSize),
      );
    }
    if (this.#bytesRemaining > 0) this.#bytesRemaining -= totalSize;
    const position = this.#position;
    if (this.#position >= 0) this.#position += totalSize;
    return this.#writevAll(bytes, totalSize, position, signal);
  }

  writeSync(chunk: FileHandleWriterChunk): boolean;
  writeSync(chunk: unknown): boolean {
    if (this.#error !== undefined || this.#closed || this.#asyncOperations !== 0) {
      return false;
    }
    const bytes = writerChunkBytes(chunk);
    const length = bytes.byteLength;
    if (length > this.#syncWriteThreshold) return false;
    if (length === 0) return true;
    if (this.#bytesRemaining >= 0 && length > this.#bytesRemaining) return false;

    const position = this.#position;
    const written = nts_fs_write(
      this.#fd,
      copyWriterBytes(bytes, 0, length),
      position,
    );
    if (written < 0) return false;
    this.#totalBytesWritten += written;
    if (written < length) {
      this.#writeSyncAll(bytes, written, length - written, position < 0 ? -1 : position + written);
    }
    if (position >= 0) this.#position = position + length;
    if (this.#bytesRemaining > 0) this.#bytesRemaining -= length;
    return true;
  }

  writevSync(chunks: readonly FileHandleWriterChunk[]): boolean;
  writevSync(chunks: unknown): boolean {
    if (this.#error !== undefined || this.#closed || this.#asyncOperations !== 0) {
      return false;
    }
    const bytes = writerChunks(chunks);
    let totalSize = 0;
    for (let index = 0; index < bytes.length; index++) {
      const chunk = bytes[index];
      if (chunk === undefined) throw new Error(`FileHandle writer is missing chunk ${index}`);
      totalSize += chunk.byteLength;
    }
    if (totalSize > this.#syncWriteThreshold) return false;
    if (totalSize === 0) return true;
    if (this.#bytesRemaining >= 0 && totalSize > this.#bytesRemaining) return false;

    const position = this.#position;
    const written = nts_fs_writev(
      this.#fd,
      flattenBuffers(bytes),
      bufferLengths(bytes),
      position,
    );
    if (written < 0) return false;
    this.#totalBytesWritten += written;
    if (written < totalSize) {
      const flattened = Buffer.concat(bytes);
      this.#writeSyncAll(
        flattened,
        written,
        totalSize - written,
        position < 0 ? -1 : position + written,
      );
    }
    if (position >= 0) this.#position = position + totalSize;
    if (this.#bytesRemaining > 0) this.#bytesRemaining -= totalSize;
    return true;
  }

  end(options?: FileHandleWriterOperationOptions): Promise<number>;
  end(options?: unknown): Promise<number> {
    if (this.#error !== undefined) return Promise.reject(this.#error);
    if (this.#closed) return Promise.resolve(this.#totalBytesWritten);
    const pending = this.#pendingEnd;
    if (this.#closing && pending !== undefined) return pending;

    const signal = writerOperationSignal(options);
    if (signal?.aborted) return Promise.reject(signal.reason);
    this.#closing = true;
    const completion = this.#cleanup().then(() => this.#totalBytesWritten);
    this.#pendingEnd = completion;
    return completion;
  }

  endSync(): number {
    if (this.#error !== undefined || this.#asyncOperations !== 0) return -1;
    if (this.#closed) return this.#totalBytesWritten;
    this.#closed = true;
    this.#handle._finishWriterSync(this.#autoClose);
    return this.#totalBytesWritten;
  }

  fail(reason?: unknown): void {
    if (this.#closed || this.#error !== undefined) return;
    this.#error = reason ?? new ERR_INVALID_STATE("Failed");
    this.#closed = true;
    this.#handle._finishWriterSync(this.#autoClose);
  }

  async #writeAll(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
    signal: AbortSignalLike | undefined,
  ): Promise<void> {
    this.#asyncOperations++;
    try {
      let retries = 0;
      while (length > 0) {
        const result = await this.#handle.write(
          buffer,
          offset,
          length,
          position < 0 ? null : position,
        );
        const written = result.bytesWritten;
        if (signal?.aborted) throw signal.reason;
        if (written === 0) {
          retries++;
          if (retries > 5) {
            throw new ERR_OPERATION_FAILED("write failed after retries");
          }
        } else {
          retries = 0;
        }
        this.#totalBytesWritten += written;
        offset += written;
        length -= written;
        if (position >= 0) position += written;
      }
    } finally {
      this.#asyncOperations--;
    }
  }

  async #writevAll(
    buffers: readonly Uint8Array[],
    totalSize: number,
    position: number,
    signal: AbortSignalLike | undefined,
  ): Promise<void> {
    this.#asyncOperations++;
    try {
      let retries = 0;
      while (totalSize > 0) {
        const result = await this.#handle.writev(
          buffers,
          position < 0 ? null : position,
        );
        const written = result.bytesWritten;
        if (signal?.aborted) throw signal.reason;
        if (written === 0) {
          retries++;
          if (retries > 5) {
            throw new ERR_OPERATION_FAILED("writev failed after retries");
          }
        } else {
          retries = 0;
        }
        this.#totalBytesWritten += written;
        totalSize -= written;
        if (position >= 0) position += written;
        if (totalSize > 0 && written > 0) {
          const flattened = Buffer.concat(buffers);
          await this.#writeAll(
            flattened,
            written,
            totalSize,
            position,
            signal,
          );
          return;
        }
      }
    } finally {
      this.#asyncOperations--;
    }
  }

  #writeSyncAll(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): void {
    let retries = 0;
    while (length > 0) {
      const written = nts_fs_write(
        this.#fd,
        copyWriterBytes(buffer, offset, length),
        position,
      );
      if (written < 0) throw uvException(written, "write");
      if (written === 0) {
        retries++;
        if (retries > 5) {
          throw new ERR_OPERATION_FAILED("write failed after retries");
        }
      } else {
        retries = 0;
      }
      this.#totalBytesWritten += written;
      offset += written;
      length -= written;
      if (position >= 0) position += written;
    }
  }

  async #cleanup(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#handle._finishWriter(this.#autoClose);
  }
}

/** Open, incrementally write, optionally flush, and close one promise source. */
async function writeDataToPath(
  path: PathLike,
  data: unknown,
  options: string | FileOptions | undefined,
  defaultFlag: "a" | "w",
): Promise<void> {
  const settings = getOptions(options, {
    encoding: "utf8",
    mode: 0o666,
    flag: defaultFlag,
    flush: false,
  });
  const flush = settings.flush ?? false;
  validateBoolean(flush, "options.flush");
  const encoding = requireTextEncoding(
    settings.encoding || "utf8",
    "options.encoding",
  );
  const validatedData = requireFileWriteData(data);
  throwIfWriteAborted(settings.signal);

  const handle = await open(
    path,
    settings.flag || defaultFlag,
    settings.mode ?? 0o666,
  );
  try {
    await writeFileHandle(handle, validatedData, settings.signal, encoding);
    if (flush) await handle.sync();
  } catch (operationError) {
    try {
      await handle.close();
    } catch (closeError) {
      throw aggregateTwoErrors(closeError, operationError);
    }
    throw operationError;
  }
  await handle.close();
}

export async function open(
  path: PathLike,
  flags: string | number = "r",
  mode: number | string = 0o666,
): Promise<FileHandle> {
  const fd = await promisifyValue(callbacks.open, "open")(path, flags, mode);
  return new FileHandle(fd);
}

export function opendir(
  path: BytePathLike,
  options?: string | OpenDirOptions | null,
): Promise<Dir> {
  return new Promise<Dir>((resolve, reject) => {
    const complete = (error: unknown, directory?: Dir): void => {
      if (error !== null && error !== undefined) reject(error);
      else if (directory === undefined) {
        reject(new Error("fs opendir completed without a directory"));
      } else {
        resolve(directory);
      }
    };
    if (options === undefined) opendirCallback(path, complete);
    else opendirCallback(path, options, complete);
  });
}

export const access = promisifyVoid(callbacks.access);
export async function appendFile(
  path: PathLike | FileHandle,
  data: FileWriteData,
  options?: string | FileOptions,
): Promise<void>;
export async function appendFile(
  path: PathLike | FileHandle,
  data: unknown,
  options?: string | FileOptions,
): Promise<void> {
  if (path instanceof FileHandle) {
    await writeFileToOpenHandle(path, data, options);
    return;
  }
  await writeDataToPath(path, data, options, "a");
}
export const chmod = promisifyVoid(callbacks.chmod);
export const chown = promisifyVoid(callbacks.chown);
export const copyFile = promisifyVoid(callbacks.copyFile);
export function cp(
  source: PathLike,
  destination: PathLike,
  options?: CopyOptions,
): Promise<void>;
export function cp(
  source: unknown,
  destination: unknown,
  options?: unknown,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const settings = normalizeCpOptions(options);
    const sourcePath = getValidatedPath(source, "src");
    const destinationPath = getValidatedPath(destination, "dest");
    callbacks.cp(sourcePath, destinationPath, settings, (error: unknown): void => {
      if (error !== null && error !== undefined) reject(error);
      else resolve();
    });
  });
}
export const link = promisifyVoid(callbacks.link);
export function lstat(
  path: BytePathLike,
  options: StatOptions & { bigint: true },
): Promise<BigIntStats>;
export function lstat(
  path: BytePathLike,
  options?: StatOptions & { bigint?: false },
): Promise<Stats>;
export function lstat(
  path: BytePathLike,
  options?: StatOptions,
): Promise<Stats | BigIntStats>;
export function lstat(
  path: BytePathLike,
  options?: StatOptions,
): Promise<Stats | BigIntStats> {
  if (options?.bigint === true) {
    return new Promise<BigIntStats>((resolve, reject) => {
      callbacks.lstat(path, options, (error, value) => {
        if (error !== null && error !== undefined) reject(error);
        else if (value === undefined) {
          reject(new Error("fs lstat completed without a result"));
        } else if (isBigIntStats(value)) {
          resolve(value);
        } else {
          reject(new Error("fs lstat returned numeric data for a bigint request"));
        }
      });
    });
  }
  return new Promise<Stats>((resolve, reject) => {
    callbacks.lstat(path, options, (error, value) => {
      if (error !== null && error !== undefined) reject(error);
      else if (value === undefined) {
        reject(new Error("fs lstat completed without a result"));
      } else if (!isBigIntStats(value)) {
        resolve(value);
      } else {
        reject(new Error("fs lstat returned bigint data for a numeric request"));
      }
    });
  });
}
export const mkdir = promisifyOptionalValue(callbacks.mkdir);
export function mkdtemp(prefix: BytePathLike): Promise<string>;
export function mkdtemp(
  prefix: BytePathLike,
  options: string | FileOptions | null,
): Promise<EncodedFileName>;
export function mkdtemp(
  prefix: BytePathLike,
  options?: string | FileOptions | null,
): Promise<EncodedFileName> {
  return new Promise<EncodedFileName>((resolve, reject) => {
    const complete = (error: unknown, made?: EncodedFileName): void => {
      if (error !== null && error !== undefined) reject(error);
      else if (made === undefined) {
        reject(new Error("fs mkdtemp completed without a path"));
      } else {
        resolve(made);
      }
    };
    if (options === undefined) callbacks.mkdtemp(prefix, complete);
    else callbacks.mkdtemp(prefix, options, complete);
  });
}

/** The statically representable portion of a disposable temp directory. */
export interface DisposableTempDirectory {
  readonly path: string;
  readonly remove: () => Promise<void>;
}

class DisposableTempDirectoryValue implements DisposableTempDirectory {
  readonly path: string;
  readonly remove: () => Promise<void>;

  constructor(path: string, fullPath: string) {
    this.path = path;
    this.remove = () => rm(fullPath, { force: true, recursive: true });
  }
}

/** Create a temp directory with explicit, idempotent asynchronous cleanup. */
export async function mkdtempDisposable(
  prefix: BytePathLike,
  options?: string | FileOptions,
): Promise<DisposableTempDirectory> {
  const cwd = resolvePath();
  const made = options === undefined
    ? await mkdtemp(prefix)
    : await mkdtemp(prefix, options);
  if (typeof made !== "string") {
    throw new ERR_INVALID_ARG_TYPE("path", "string", made);
  }
  return new DisposableTempDirectoryValue(made, resolvePath(cwd, made));
}

export function readFile(
  path: PathLike | FileHandle,
  options?: string | FileOptions,
): Promise<string | Buffer> {
  if (path instanceof FileHandle) return path.readFile(options);
  return new Promise((resolve, reject) => {
    callbacks.readFile(path, options ?? null, (error, contents) => {
      if (error !== null && error !== undefined) reject(error);
      else if (contents === undefined) {
        reject(new Error("fs readFile completed without file contents"));
      } else {
        resolve(contents);
      }
    });
  });
}
export const readdir = promisifyValue(callbacks.readdir, "readdir");
export const readlink = promisifyValue(callbacks.readlink, "readlink");
export const realpath = promisifyValue(callbacks.realpath, "realpath");
export const rename = promisifyVoid(callbacks.rename);
export function rm(path: PathLike, options?: RmOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    callbacks.rm(path, options, (error) => {
      if (error !== null && error !== undefined) reject(error);
      else resolve();
    });
  });
}
export function rmdir(path: PathLike, options?: RmdirOptions): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    callbacks.rmdir(path, options, (error) => {
      if (error !== null && error !== undefined) reject(error);
      else resolve();
    });
  });
}
export function stat(path: BytePathLike, options?: undefined): Promise<Stats>;
export function stat(
  path: BytePathLike,
  options: StatSyncOptions & { bigint?: false; throwIfNoEntry: false },
): Promise<Stats | undefined>;
export function stat(
  path: BytePathLike,
  options: StatSyncOptions & { bigint: true; throwIfNoEntry: false },
): Promise<BigIntStats | undefined>;
export function stat(
  path: BytePathLike,
  options: StatSyncOptions & { bigint?: false },
): Promise<Stats>;
export function stat(
  path: BytePathLike,
  options: StatSyncOptions & { bigint: true },
): Promise<BigIntStats>;
export function stat(
  path: BytePathLike,
  options?: StatSyncOptions,
): Promise<Stats | BigIntStats | undefined>;
export function stat(
  path: BytePathLike,
  options?: StatSyncOptions,
): Promise<Stats | BigIntStats | undefined> {
  if (options?.bigint === true) {
    return new Promise<BigIntStats | undefined>((resolve, reject) => {
      callbacks.stat(path, options, (error, value) => {
        if (error !== null && error !== undefined) reject(error);
        else if (value === undefined) {
          if (options.throwIfNoEntry === false) resolve(undefined);
          else reject(new Error("fs stat completed without a result"));
        } else if (isBigIntStats(value)) {
          resolve(value);
        } else {
          reject(new Error("fs stat returned numeric data for a bigint request"));
        }
      });
    });
  }
  return new Promise<Stats | undefined>((resolve, reject) => {
    callbacks.stat(path, options, (error, value) => {
      if (error !== null && error !== undefined) reject(error);
      else if (value === undefined) {
        if (options?.throwIfNoEntry === false) resolve(undefined);
        else reject(new Error("fs stat completed without a result"));
      } else if (!isBigIntStats(value)) {
        resolve(value);
      } else {
        reject(new Error("fs stat returned bigint data for a numeric request"));
      }
    });
  });
}
export function statfs(
  path: BytePathLike,
  options: { bigint: true },
): Promise<StatFs<bigint>>;
export function statfs(
  path: BytePathLike,
  options?: StatFsOptions,
): Promise<StatFs<number>>;
export function statfs(
  path: BytePathLike,
  options?: StatFsOptions,
): Promise<StatFs<number> | StatFs<bigint>> {
  if (options?.bigint === true) {
    return new Promise<StatFs<bigint>>((resolve, reject) => {
      callbacks.statfs(path, { bigint: true }, (error, value) => {
        if (error !== null && error !== undefined) reject(error);
        else if (value === undefined) {
          reject(new Error("fs statfs completed without a result"));
        } else if (isBigIntStatFs(value)) {
          resolve(value);
        } else {
          reject(new Error("fs statfs returned numeric data for a bigint request"));
        }
      });
    });
  }
  return new Promise<StatFs<number>>((resolve, reject) => {
    callbacks.statfs(path, options, (error, value) => {
      if (error !== null && error !== undefined) reject(error);
      else if (value === undefined) {
        reject(new Error("fs statfs completed without a result"));
      } else if (!isBigIntStatFs(value)) {
        resolve(value);
      } else {
        reject(new Error("fs statfs returned bigint data for a numeric request"));
      }
    });
  });
}
export const symlink = promisifyVoid(callbacks.symlink);
export const truncate = promisifyVoid(callbacks.truncate);
export const unlink = promisifyVoid(callbacks.unlink);
export const utimes = promisifyVoid(callbacks.utimes);
export async function lchmod(
  _path: PathLike,
  _mode: number | string,
): Promise<void> {
  throw new ERR_METHOD_NOT_IMPLEMENTED("lchmod()");
}
export const lchown = promisifyVoid(callbacks.lchown);
export async function writeFile(
  path: PathLike | FileHandle,
  data: FileWriteData,
  options?: string | FileOptions,
): Promise<void>;
export async function writeFile(
  path: PathLike | FileHandle,
  data: unknown,
  options?: string | FileOptions,
): Promise<void> {
  if (path instanceof FileHandle) {
    await writeFileToOpenHandle(path, data, options);
    return;
  }
  await writeDataToPath(path, data, options, "w");
}

// The promise API deliberately has no `exists`. `access` with a `catch` says
// the same thing without inviting the check-then-open race that made the
// callback form a mistake.
export type { Dirent, Stats };
