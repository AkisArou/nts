// `fs.createReadStream` and `fs.createWriteStream`, from node v24.20.0
// `lib/internal/fs/streams.js`.
//
// A file as a stream, which is the shape almost every program actually wants:
// `readFile` on a large file is a large allocation, and `writeFile` on a slow
// consumer has nowhere to apply backpressure.
//
// The one non-obvious rule is in `_destroy`. It is normally safe to close a
// descriptor while operations are outstanding, but file I/O in libuv is
// implemented with *synchronous* calls on a thread pool, so a descriptor
// closed during a pending read may be reused by the operating system before
// that read runs -- and the read then succeeds against a different file. So a
// stream being destroyed waits for its in-flight operation to report before it
// closes.

import { Buffer } from "../../buffer/src/main.ts";
import { Readable, Writable } from "../../stream/src/main.ts";
import { finished } from "../../stream/src/main.ts";
import type { BufferedWrite, WriteCallback } from "../../stream/src/writable.ts";
import { errorOrDestroy } from "../../stream/src/destroy.ts";
import type { AbortSignalLike } from "../../stream/src/end-of-stream.ts";
import { addAbortSignalNoValidate } from "../../stream/src/add-abort-signal.ts";
import { nextTick } from "../../internal/tick.ts";
import {
  validateAbortSignal,
  validateBoolean,
  validateFunction,
  validateInteger,
} from "../../internal/validators.ts";
import {
  ERR_INVALID_ARG_TYPE,
  ERR_METHOD_NOT_IMPLEMENTED,
  ERR_OUT_OF_RANGE,
  ERR_STREAM_DESTROYED,
} from "../../internal/errors.ts";
import { emitWarning } from "../../internal/process-warning.ts";
import * as callbacks from "./async.ts";
import { validateEncodingOption, validateFileDescriptor } from "./options.ts";

let readStreamOpenWarningEmitted = false;
let writeStreamOpenWarningEmitted = false;

function warnReadStreamOpen(): void {
  if (readStreamOpenWarningEmitted) return;
  readStreamOpenWarningEmitted = true;
  emitWarning(
    "ReadStream.prototype.open() is deprecated",
    "DeprecationWarning",
    "DEP0135",
  );
}

function warnWriteStreamOpen(): void {
  if (writeStreamOpenWarningEmitted) return;
  writeStreamOpenWarningEmitted = true;
  emitWarning(
    "WriteStream.prototype.open() is deprecated",
    "DeprecationWarning",
    "DEP0135",
  );
}

interface StreamFileHandle {
  readonly fd: number;
  _refForStream(): void;
  _unrefForStream(): void;
  close(): Promise<void>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | bigint | null,
  ): Promise<{ bytesRead: number; buffer: ArrayBufferView }>;
  sync(): Promise<void>;
  write(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
  ): Promise<{ bytesWritten: number; buffer: ArrayBufferView }>;
  writev<T extends readonly ArrayBufferView[]>(
    buffers: T,
    position: number | null,
  ): Promise<{ bytesWritten: number; buffers: T }>;
  on(type: "close", listener: () => void): unknown;
}

interface PendingDestroy {
  error: unknown;
  callback: (error?: unknown) => void;
}

function isStreamFileHandle(value: unknown): value is StreamFileHandle {
  return value !== null && typeof value === "object" &&
    "fd" in value && typeof value.fd === "number" &&
    "_refForStream" in value && typeof value._refForStream === "function" &&
    "_unrefForStream" in value && typeof value._unrefForStream === "function" &&
    "close" in value && typeof value.close === "function" &&
    "read" in value && typeof value.read === "function" &&
    "sync" in value && typeof value.sync === "function" &&
    "write" in value && typeof value.write === "function" &&
    "writev" in value && typeof value.writev === "function" &&
    "on" in value && typeof value.on === "function";
}

export type StreamOpenCallback = (error: unknown, fd?: number) => void;
export type StreamReadCallback = (
  error: unknown,
  bytesRead?: number,
  buffer?: ArrayBufferView,
) => void;
export type StreamWriteCallback = (
  error: unknown,
  bytesWritten?: number,
  buffer?: string | ArrayBufferView,
) => void;
export type StreamWritevCallback = (
  error: unknown,
  bytesWritten?: number,
  buffers?: readonly ArrayBufferView[],
) => void;
export type StreamCloseCallback = (error?: unknown) => void;

export interface StreamFSImplementation {
  open?: (
    path: string,
    flags: string,
    mode: number,
    callback: StreamOpenCallback,
  ) => void;
  close?: (fd: number, callback: StreamCloseCallback) => void;
  read?: (
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
    callback: StreamReadCallback,
  ) => void;
  write?: (
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number | null,
    callback: StreamWriteCallback,
  ) => void;
  writev?: (
    fd: number,
    buffers: Buffer[],
    position: number | null,
    callback: StreamWritevCallback,
  ) => void;
  fsync?: (fd: number, callback: StreamCloseCallback) => void;
}

export interface FileStreamOptions {
  flags?: string | undefined;
  encoding?: string | undefined;
  fd?: number | StreamFileHandle | null | undefined;
  mode?: number | undefined;
  autoClose?: boolean | undefined;
  emitClose?: boolean | undefined;
  start?: number | undefined;
  end?: number | undefined;
  highWaterMark?: number | undefined;
  fs?: StreamFSImplementation | null | undefined;
  flush?: boolean | null | undefined;
  signal?: AbortSignalLike | null | undefined;
}

export type FileStreamOptionsInput = FileStreamOptions | string | null | undefined;

function normalizeStreamOptions(options: FileStreamOptionsInput): FileStreamOptions {
  if (options === null || options === undefined) return {};
  if (typeof options === "string") {
    validateEncodingOption(options);
    return { encoding: options };
  }
  if (typeof options !== "object") {
    throw new ERR_INVALID_ARG_TYPE("options", ["string", "Object"], options);
  }
  validateEncodingOption(options.encoding);
  return options;
}

function checkPosition(value: number | undefined, name: string): void {
  if (value === undefined) return;
  validateInteger(value, name, 0, Number.MAX_SAFE_INTEGER);
}

function validateOpen(
  operations: StreamFSImplementation,
  required: boolean,
): void {
  if (required || operations.open !== undefined) {
    validateFunction(operations.open, "options.fs.open");
  }
}

function validateClose(
  operations: StreamFSImplementation,
  required: boolean,
): void {
  if (required || operations.close !== undefined) {
    validateFunction(operations.close, "options.fs.close");
  }
}

function isErrorCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" &&
    "code" in error && error.code === code;
}

function destroyFinishedWriteStream(this: WriteStream): void {
  this.destroy();
}

class WriteNoProgressError extends Error {
  readonly code = "ERR_SYSTEM_ERROR";

  constructor() {
    super("A system error occurred: write failed");
    this.name = "SystemError";
  }
}

interface PreparedReadStream {
  path: string | undefined;
  fd: number | null;
  fileHandle: StreamFileHandle | undefined;
  operations: StreamFSImplementation | undefined;
  flags: string;
  mode: number;
  autoClose: boolean;
  start: number | undefined;
  end: number;
}

interface PreparedWriteStream {
  path: string | undefined;
  fd: number | null;
  fileHandle: StreamFileHandle | undefined;
  operations: StreamFSImplementation | undefined;
  flags: string;
  mode: number;
  autoClose: boolean;
  start: number | undefined;
  flush: boolean;
}

function prepareDescriptor(
  path: string | null,
  suppliedDescriptor: number | StreamFileHandle | null | undefined,
  operations: StreamFSImplementation | undefined,
): {
  path: string | undefined;
  fd: number | null;
  fileHandle: StreamFileHandle | undefined;
} {
  if (suppliedDescriptor === null || suppliedDescriptor === undefined) {
    if (typeof path !== "string") {
      throw new ERR_INVALID_ARG_TYPE("path", ["string", "Buffer", "URL"], path);
    }
    return { path, fd: null, fileHandle: undefined };
  }
  if (typeof suppliedDescriptor === "number") {
    validateFileDescriptor(suppliedDescriptor);
    return { path: typeof path === "string" ? path : undefined, fd: suppliedDescriptor, fileHandle: undefined };
  }
  if (!isStreamFileHandle(suppliedDescriptor)) {
    throw new ERR_INVALID_ARG_TYPE("options.fd", ["number", "FileHandle"], suppliedDescriptor);
  }
  validateFileDescriptor(suppliedDescriptor.fd);
  if (operations !== undefined) {
    throw new ERR_METHOD_NOT_IMPLEMENTED("FileHandle with fs");
  }
  return {
    path: typeof path === "string" ? path : undefined,
    fd: suppliedDescriptor.fd,
    fileHandle: suppliedDescriptor,
  };
}

function prepareReadStream(
  path: string | null,
  options: FileStreamOptions,
): PreparedReadStream {
  if (options.signal !== undefined) {
    validateAbortSignal(options.signal, "options.signal");
  }
  checkPosition(options.start, "start");
  if (options.end !== Infinity) checkPosition(options.end, "end");
  if (
    options.start !== undefined && options.end !== undefined &&
    options.end < options.start
  ) {
    throw new ERR_OUT_OF_RANGE("start", `<= "end" (here: ${options.end})`, options.start);
  }

  const operations = options.fs ?? undefined;
  const descriptor = prepareDescriptor(path, options.fd, operations);
  const autoClose = options.autoClose ?? true;
  if (operations !== undefined) {
    validateOpen(operations, descriptor.fd === null);
    validateFunction(operations.read, "options.fs.read");
    validateClose(operations, autoClose);
  }
  return {
    ...descriptor,
    operations,
    flags: options.flags ?? "r",
    mode: options.mode ?? 0o666,
    autoClose,
    start: options.start,
    end: options.end ?? Infinity,
  };
}

function prepareWriteStream(
  path: string | null,
  options: FileStreamOptions,
): PreparedWriteStream {
  if (options.signal !== undefined) {
    validateAbortSignal(options.signal, "options.signal");
  }
  checkPosition(options.start, "start");
  const operations = options.fs ?? undefined;
  const descriptor = prepareDescriptor(path, options.fd, operations);
  const autoClose = options.autoClose ?? true;
  const flush = options.flush ?? false;
  if (options.flush !== null && options.flush !== undefined) {
    validateBoolean(options.flush, "options.flush");
  }
  if (operations !== undefined) {
    validateOpen(operations, descriptor.fd === null);
    if (operations.write === undefined && operations.writev === undefined) {
      validateFunction(operations.write, "options.fs.write");
    }
    if (operations.write !== undefined) {
      validateFunction(operations.write, "options.fs.write");
    }
    if (operations.writev !== undefined) {
      validateFunction(operations.writev, "options.fs.writev");
    }
    validateClose(operations, autoClose);
    if (flush) validateFunction(operations.fsync, "options.fs.fsync");
  }
  return {
    ...descriptor,
    operations,
    flags: options.flags ?? "w",
    mode: options.mode ?? 0o666,
    autoClose,
    start: options.start,
    flush,
  };
}

export class ReadStream extends Readable {
  path: string | undefined;
  fd: number | null;
  flags: string;
  mode: number;
  autoClose: boolean;
  start: number | undefined;
  end: number;
  pos: number | undefined;
  bytesRead = 0;
  #performingIo = false;
  #fileHandle: StreamFileHandle | undefined;
  #operations: StreamFSImplementation | undefined;
  #pendingDestroy: PendingDestroy | undefined;

  constructor(path: string | null, options?: FileStreamOptionsInput) {
    const normalized = normalizeStreamOptions(options);
    const prepared = prepareReadStream(path, normalized);
    super({
      // 64 KiB rather than the stream default, because a file read that costs
      // a system call should bring back enough to be worth the call.
      highWaterMark: normalized.highWaterMark ?? 64 * 1024,
      encoding: normalized.encoding,
      autoDestroy: normalized.autoClose ?? true,
      emitClose: normalized.emitClose ?? true,
    });

    this.path = prepared.path;
    this.fd = prepared.fd;
    this.#fileHandle = prepared.fileHandle;
    this.#operations = prepared.operations;
    this.flags = prepared.flags;
    this.mode = prepared.mode;
    this.autoClose = prepared.autoClose;
    this.start = prepared.start;
    this.end = prepared.end;
    // `pos` tracks where the next read starts, and only exists when a start
    // was given: without one, reads are sequential and the descriptor's own
    // offset is the position.
    this.pos = prepared.start;
    prepared.fileHandle?._refForStream();
    prepared.fileHandle?.on("close", () => this.close());
    if (normalized.signal !== null && normalized.signal !== undefined) {
      addAbortSignalNoValidate(normalized.signal, this);
    }
  }

  /** Whether the file is not open yet. */
  get pending(): boolean {
    return this.fd === null;
  }

  override _construct(callback: (error?: unknown) => void): void {
    if (typeof this.fd === "number") {
      callback();
      return;
    }
    const path = this.path;
    if (path === undefined) {
      callback(new ERR_INVALID_ARG_TYPE("path", ["string", "Buffer", "URL"], path));
      return;
    }
    const onOpen: StreamOpenCallback = (error, fd) => {
      if (error) {
        callback(error);
        return;
      }
      if (fd === undefined) {
        callback(new Error("fs open completed without a file descriptor"));
        return;
      }
      this.fd = fd;
      callback();
      this.emit("open", this.fd);
      this.emit("ready");
    };
    const operations = this.#operations;
    if (operations === undefined) {
      callbacks.open(path, this.flags, this.mode, onOpen);
    } else {
      if (operations.open === undefined) {
        callback(new Error("validated stream filesystem has no open operation"));
        return;
      }
      operations.open(path, this.flags, this.mode, onOpen);
    }
  }

  override _read(size: number): void {
    // Never read past `end`, which is inclusive as node's is.
    const wanted = this.pos !== undefined
      ? Math.min(this.end - this.pos + 1, size)
      : Math.min(this.end - this.bytesRead + 1, size);

    if (wanted <= 0) {
      this.push(null);
      return;
    }

    const buffer = Buffer.allocUnsafe(wanted);
    const fd = this.fd;
    if (fd === null) {
      this.destroy(new Error("fs read stream has no open file descriptor"));
      return;
    }
    this.#performingIo = true;

    const onRead: StreamReadCallback = (error, bytesRead) => {
      this.#performingIo = false;

      // Destroyed while this read was outstanding: `_destroy` is waiting to
      // hear that the descriptor is free.
      if (this.destroyed) {
        const pending = this.#pendingDestroy;
        this.#pendingDestroy = undefined;
        if (pending !== undefined) {
          closeStream(this, pending.error || error, pending.callback);
        }
        return;
      }

      if (error) {
        errorOrDestroy(this, error);
        return;
      }

      if (bytesRead === undefined) {
        errorOrDestroy(this, new Error("fs read completed without a byte count"));
        return;
      }
      const read = bytesRead;
      if (read > 0) {
        if (this.pos !== undefined) this.pos += read;
        this.bytesRead += read;
        // Copied rather than sliced when short: a slice keeps the whole
        // allocation alive, so a stream of small reads from a 64 KiB buffer
        // would retain 64 KiB per chunk.
        this.push(read === buffer.length ? buffer : Buffer.from(buffer.subarray(0, read)));
      } else {
        this.push(null);
      }
    };
    const operations = this.#operations;
    const handle = this.#fileHandle;
    if (handle !== undefined) {
      handle.read(buffer, 0, wanted, this.pos ?? null).then(
        (result) => onRead(null, result.bytesRead, result.buffer),
        (error: unknown) => onRead(error),
      );
      return;
    }
    if (operations === undefined) {
      callbacks.read(fd, buffer, 0, wanted, this.pos ?? null, onRead);
    } else {
      if (operations.read === undefined) {
        this.#performingIo = false;
        this.destroy(new Error("validated stream filesystem has no read operation"));
        return;
      }
      operations.read(fd, buffer, 0, wanted, this.pos ?? null, onRead);
    }
  }

  override _destroy(error: unknown, callback: (error?: unknown) => void): void {
    if (this.#performingIo) {
      this.#pendingDestroy = { error, callback };
    } else {
      closeStream(this, error, callback);
    }
  }

  _takeFileHandle(): StreamFileHandle | undefined {
    const handle = this.#fileHandle;
    this.#fileHandle = undefined;
    return handle;
  }

  _fileSystemOperations(): StreamFSImplementation | undefined {
    return this.#operations;
  }

  close(callback?: (error?: unknown) => void): void {
    if (typeof callback === "function") finished(this, callback);
    this.destroy();
  }

  /** Deprecated compatibility no-op retained by Node as `DEP0135`. */
  open(): void {
    warnReadStreamOpen();
  }
}

export class WriteStream extends Writable {
  path: string | undefined;
  fd: number | null;
  flags: string;
  mode: number;
  autoClose: boolean;
  start: number | undefined;
  pos: number | undefined;
  bytesWritten = 0;
  flush: boolean;
  #performingIo = false;
  #fileHandle: StreamFileHandle | undefined;
  #operations: StreamFSImplementation | undefined;
  #pendingDestroy: PendingDestroy | undefined;

  constructor(path: string | null, options?: FileStreamOptionsInput) {
    const normalized = normalizeStreamOptions(options);
    const prepared = prepareWriteStream(path, normalized);
    super({
      highWaterMark: normalized.highWaterMark ?? 16 * 1024,
      defaultEncoding: normalized.encoding ?? "utf8",
      autoDestroy: normalized.autoClose ?? true,
      emitClose: normalized.emitClose ?? true,
    });

    this.path = prepared.path;
    this.fd = prepared.fd;
    this.#fileHandle = prepared.fileHandle;
    this.#operations = prepared.operations;
    this.flags = prepared.flags;
    this.mode = prepared.mode;
    this.autoClose = prepared.autoClose;
    this.start = prepared.start;
    this.pos = prepared.start;
    this.flush = prepared.flush;
    prepared.fileHandle?._refForStream();
    prepared.fileHandle?.on("close", () => this.close());
    if (normalized.signal !== null && normalized.signal !== undefined) {
      addAbortSignalNoValidate(normalized.signal, this);
    }
  }

  get pending(): boolean {
    return this.fd === null;
  }

  override _construct(callback: (error?: unknown) => void): void {
    if (typeof this.fd === "number") {
      callback();
      return;
    }
    const path = this.path;
    if (path === undefined) {
      callback(new ERR_INVALID_ARG_TYPE("path", ["string", "Buffer", "URL"], path));
      return;
    }
    const onOpen: StreamOpenCallback = (error, fd) => {
      if (error) {
        callback(error);
        return;
      }
      if (fd === undefined) {
        callback(new Error("fs open completed without a file descriptor"));
        return;
      }
      this.fd = fd;
      callback();
      this.emit("open", this.fd);
      this.emit("ready");
    };
    const operations = this.#operations;
    if (operations === undefined) {
      callbacks.open(path, this.flags, this.mode, onOpen);
    } else {
      if (operations.open === undefined) {
        callback(new Error("validated stream filesystem has no open operation"));
        return;
      }
      operations.open(path, this.flags, this.mode, onOpen);
    }
  }

  override _write(chunk: unknown, _encoding: string, callback: (error?: unknown) => void): void {
    if (!ArrayBuffer.isView(chunk)) {
      callback(new ERR_INVALID_ARG_TYPE("chunk", ["Buffer", "TypedArray", "DataView"], chunk));
      return;
    }
    const buffer = Buffer.from(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    const fd = this.fd;
    if (fd === null) {
      callback(new Error("fs write stream has no open file descriptor"));
      return;
    }
    this.#performingIo = true;
    this.#writeAll(fd, buffer, this.pos ?? null, callback, 0);
  }

  /**
   * Flush buffered chunks with one vector syscall.
   *
   * Writable calls this only after it has already normalized byte-mode chunks,
   * so the fixed array below is both validation at the subclass boundary and
   * the exact vector handed to fs.writev. A partial vector write is completed
   * through the single-buffer retry path; resending the original vector would
   * duplicate the prefix already written.
   */
  override _writev(chunks: BufferedWrite[], callback: WriteCallback): void {
    const buffers = new Array<Buffer>(chunks.length);
    let total = 0;
    for (let index = 0; index < chunks.length; index++) {
      const entry = chunks[index];
      if (entry === undefined || !ArrayBuffer.isView(entry.chunk)) {
        callback(new ERR_INVALID_ARG_TYPE(
          "chunk",
          ["Buffer", "TypedArray", "DataView"],
          entry?.chunk,
        ));
        return;
      }
      const chunk = entry.chunk;
      const buffer = Buffer.from(
        new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
      );
      buffers[index] = buffer;
      total += buffer.length;
    }
    if (total === 0) {
      callback();
      return;
    }

    const fd = this.fd;
    if (fd === null) {
      callback(new Error("fs write stream has no open file descriptor"));
      return;
    }
    this.#performingIo = true;
    const position = this.pos ?? null;
    const onWritev: StreamWritevCallback = (receivedError, bytesWritten) => {
      let error = receivedError;
      let written = bytesWritten;
      if (isErrorCode(error, "EAGAIN")) {
        error = undefined;
        written = 0;
      }
      if (this.destroyed || error) {
        this.#finishWrite(error || new ERR_STREAM_DESTROYED("write"), callback);
        return;
      }
      if (
        written === undefined || !Number.isInteger(written) ||
        written < 0 || written > total
      ) {
        this.#finishWrite(
          new Error("fs writev completed with an invalid byte count"),
          callback,
        );
        return;
      }

      this.bytesWritten += written;
      if (this.pos !== undefined) this.pos += written;
      if (written < total) {
        const remaining = Buffer.concat(buffers).subarray(written);
        const nextPosition = position === null ? null : position + written;
        this.#writeAll(fd, remaining, nextPosition, callback, written === 0 ? 1 : 0);
        return;
      }
      this.#finishWrite(undefined, callback);
    };

    const handle = this.#fileHandle;
    if (handle !== undefined) {
      handle.writev(buffers, position).then(
        (result) => onWritev(null, result.bytesWritten, buffers),
        (error: unknown) => onWritev(error),
      );
      return;
    }
    const operations = this.#operations;
    if (operations === undefined) {
      callbacks.writev(fd, buffers, position, onWritev);
    } else if (operations.writev !== undefined) {
      operations.writev(fd, buffers, position, onWritev);
    } else {
      // A custom fs implementation may provide only write(). It still gets
      // the coalesced bytes once, rather than N separate calls.
      this.#writeAll(fd, Buffer.concat(buffers), position, callback, 0);
    }
  }

  #writeAll(
    fd: number,
    buffer: Buffer,
    position: number | null,
    callback: WriteCallback,
    retries: number,
  ): void {
    const onWrite: StreamWriteCallback = (receivedError, bytesWritten) => {
      let error = receivedError;
      let written = bytesWritten;
      if (isErrorCode(error, "EAGAIN")) {
        error = undefined;
        written = 0;
      }

      if (this.destroyed || error) {
        this.#finishWrite(error || new ERR_STREAM_DESTROYED("write"), callback);
        return;
      }
      if (written === undefined) {
        this.#finishWrite(new Error("fs write completed without a byte count"), callback);
        return;
      }
      if (!Number.isInteger(written) || written < 0 || written > buffer.length) {
        this.#finishWrite(new Error("fs write completed with an invalid byte count"), callback);
        return;
      }

      this.bytesWritten += written;
      if (this.pos !== undefined) this.pos += written;
      const nextRetries = written === 0 ? retries + 1 : 0;
      if (nextRetries > 5) {
        this.#finishWrite(new WriteNoProgressError(), callback);
        return;
      }
      if (written < buffer.length) {
        const nextPosition = position === null ? null : position + written;
        this.#writeAll(fd, buffer.subarray(written), nextPosition, callback, nextRetries);
        return;
      }
      this.#finishWrite(undefined, callback);
    };

    const operations = this.#operations;
    const handle = this.#fileHandle;
    if (handle !== undefined) {
      handle.write(buffer, 0, buffer.length, position).then(
        (result) => onWrite(null, result.bytesWritten, result.buffer),
        (error: unknown) => onWrite(error),
      );
      return;
    }
    if (operations === undefined) {
      callbacks.write(fd, buffer, 0, buffer.length, position, onWrite);
      return;
    }
    if (operations.write !== undefined) {
      operations.write(fd, buffer, 0, buffer.length, position, onWrite);
      return;
    }
    if (operations.writev === undefined) {
      this.#finishWrite(new Error("validated stream filesystem has no write operation"), callback);
      return;
    }
    const onWritev: StreamWritevCallback = (error, bytesWritten) => {
      onWrite(error, bytesWritten, buffer);
    };
    operations.writev(fd, [buffer], position, onWritev);
  }

  #finishWrite(error: unknown, callback: WriteCallback): void {
    this.#performingIo = false;
    if (this.destroyed) {
      callback(error);
      const pending = this.#pendingDestroy;
      this.#pendingDestroy = undefined;
      if (pending !== undefined) {
        closeStream(this, pending.error || error, pending.callback);
      }
      return;
    }
    callback(error);
  }

  override _destroy(error: unknown, callback: (error?: unknown) => void): void {
    if (this.#performingIo) {
      this.#pendingDestroy = { error, callback };
    } else {
      closeStream(this, error, callback);
    }
  }

  _takeFileHandle(): StreamFileHandle | undefined {
    const handle = this.#fileHandle;
    this.#fileHandle = undefined;
    return handle;
  }

  _fileSystemOperations(): StreamFSImplementation | undefined {
    return this.#operations;
  }

  close(callback?: (error?: unknown) => void): void {
    if (typeof callback === "function") {
      if (this.closed) {
        nextTick(callback);
        return;
      }
      this.on("close", callback);
    }
    if (!this.autoClose) this.on("finish", destroyFinishedWriteStream);
    this.end();
  }

  /** Deprecated compatibility no-op retained by Node as `DEP0135`. */
  open(): void {
    warnWriteStreamOpen();
  }

  /** Node's older name for `end`, kept because programs still call it. */
  destroySoon(): void {
    this.end();
  }
}

/**
 * Close the descriptor, unless the stream does not own it.
 *
 * `autoClose: false` is for a caller that passed its own `fd` and intends to
 * keep using it; closing it out from under them would be the stream taking
 * ownership it was explicitly not given.
 */
function closeStream(
  stream: ReadStream | WriteStream,
  error: unknown,
  callback: (error?: unknown) => void,
): void {
  if (!stream.autoClose || stream.fd === null) {
    callback(error);
    return;
  }
  const fd = stream.fd;
  if (stream instanceof WriteStream && stream.flush) {
    const handle = stream._takeFileHandle();
    if (handle !== undefined) {
      handle.sync().then(
        () => closeFileDescriptor(stream, fd, handle, error, callback),
        (flushError: unknown) => {
          closeFileDescriptor(stream, fd, handle, error || flushError, callback);
        },
      );
      return;
    }
    const operations = stream._fileSystemOperations();
    const onSync: StreamCloseCallback = (flushError) => {
      closeFileDescriptor(stream, fd, undefined, error || flushError, callback);
    };
    if (operations === undefined) {
      callbacks.fsync(fd, onSync);
      return;
    }
    if (operations.fsync === undefined) {
      callback(new Error("validated stream filesystem has no fsync operation"));
      return;
    }
    operations.fsync(fd, onSync);
    return;
  }
  closeFileDescriptor(stream, fd, stream._takeFileHandle(), error, callback);
}

function closeFileDescriptor(
  stream: ReadStream | WriteStream,
  fd: number,
  handle: StreamFileHandle | undefined,
  error: unknown,
  callback: (error?: unknown) => void,
): void {
  if (handle !== undefined) {
    handle._unrefForStream();
    handle.close().then(
      () => callback(error),
      (closeError: unknown) => callback(error || closeError),
    );
    stream.fd = null;
    return;
  }
  const operations = stream._fileSystemOperations();
  const onClose: StreamCloseCallback = (closeError) => callback(error || closeError);
  if (operations === undefined) {
    callbacks.close(fd, onClose);
  } else {
    if (operations.close === undefined) {
      callback(new Error("validated stream filesystem has no close operation"));
      return;
    }
    operations.close(fd, onClose);
  }
  // Node clears `fd` after dispatching close. A custom implementation may
  // inspect the stream synchronously from inside `close`, and then sees the
  // descriptor it was asked to close.
  stream.fd = null;
}

export function createReadStream(path: string | null, options?: FileStreamOptionsInput): ReadStream {
  return new ReadStream(path, options);
}

export function createWriteStream(path: string | null, options?: FileStreamOptionsInput): WriteStream {
  return new WriteStream(path, options);
}
