// `fs.Utf8Stream`, from Node v24.20.0
// `lib/internal/streams/fast-utf8-stream.js`.
//
// This is Node's buffered UTF-8 writer, with its state expressed as two
// statically typed queues. UTF-8 mode stores strings; buffer mode stores
// bounded batches of Buffers plus their byte lengths. Keeping those queues
// separate makes an impossible mixed-content state unrepresentable and avoids
// the casts a direct transcription of Node's dynamically typed `#bufs` needs.

import { Buffer } from "../../buffer/src/main.ts";
import { EventEmitter } from "../../events/src/main.ts";
import { dirname } from "../../path/src/posix.ts";
import { clearInterval, setInterval, setTimeout } from "../../timers/src/main.ts";
import type { Timeout } from "../../timers/src/timeout.ts";
import { nextTick } from "../../internal/tick.ts";
import { sleep } from "../../internal/sleep.ts";
import {
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE_RANGE,
  ERR_INVALID_STATE,
  ERR_OPERATION_FAILED,
} from "../../internal/errors.ts";
import {
  validateBoolean,
  validateFunction,
  validateObject,
  validateOneOf,
  validateString,
  validateUint32,
} from "../../internal/validators.ts";
import {
  close as fsClose,
  fsync as fsFsync,
  mkdir as fsMkdir,
  open as fsOpen,
  write as fsWrite,
} from "./async.ts";
import {
  fsyncSync as fsFsyncSync,
  mkdirSync as fsMkdirSync,
  openSync as fsOpenSync,
  writeSync as fsWriteSync,
} from "./main.ts";

const BUSY_WRITE_TIMEOUT = 100;
const MAX_WRITE = 16 * 1024;
const HIGH_WATER_MARK = 16_387;
const EMPTY_BUFFER = Buffer.allocUnsafe(0);

type Utf8StreamContentMode = "buffer" | "utf8";

interface Utf8StreamSystemError extends Error {
  code?: string | undefined;
}

type Utf8StreamErrorCallback = (
  error?: Utf8StreamSystemError | null,
) => void;

type Utf8StreamWriteCallback = (
  error?: Utf8StreamSystemError | null,
  written?: number,
) => void;

/**
 * The filesystem operations Utf8Stream consumes.
 *
 * Node deliberately supports overriding any subset for fault injection and
 * specialised destinations. This names that structural contract instead of
 * accepting an untyped `object`; JavaScript callers still receive the same
 * runtime validation, while TypeScript callers get the signatures involved.
 */
interface Utf8StreamFileSystem {
  write(fd: number, data: Buffer, callback: Utf8StreamWriteCallback): void;
  write(
    fd: number,
    data: string,
    encoding: "utf8",
    callback: Utf8StreamWriteCallback,
  ): void;
  writeSync(fd: number, data: Buffer): number;
  writeSync(fd: number, data: string, encoding: "utf8"): number;
  fsync(fd: number, callback: Utf8StreamErrorCallback): void;
  fsyncSync(fd: number): void;
  close(fd: number, callback: Utf8StreamErrorCallback): void;
  open(
    path: string,
    flags: "a" | "w",
    mode: number | string | undefined,
    callback: (error: Utf8StreamSystemError | null, fd?: number) => void,
  ): void;
  openSync(
    path: string,
    flags: "a" | "w",
    mode: number | string | undefined,
  ): number;
  mkdir(
    path: string,
    options: { recursive: true },
    callback: Utf8StreamErrorCallback,
  ): void;
  mkdirSync(path: string, options: { recursive: true }): string | undefined;
}

export interface Utf8StreamOptions {
  append?: boolean | undefined;
  contentMode?: Utf8StreamContentMode | undefined;
  dest?: string | undefined;
  fd?: number | undefined;
  fs?: Partial<Utf8StreamFileSystem> | undefined;
  fsync?: boolean | undefined;
  maxLength?: number | undefined;
  maxWrite?: number | undefined;
  minLength?: number | undefined;
  mkdir?: boolean | undefined;
  mode?: number | string | undefined;
  periodicFlush?: number | undefined;
  retryEAGAIN?: (
    error: Error | null,
    writeBufferLength: number,
    remainingBufferLength: number,
  ) => boolean;
  sync?: boolean | undefined;
}

function normalizeSystemError(error: unknown): Utf8StreamSystemError | null {
  if (error === null || error === undefined) return null;
  if (error instanceof Error) return error;
  return new ERR_OPERATION_FAILED(String(error));
}

const defaultFileSystem: Utf8StreamFileSystem = {
  write(
    fd: number,
    data: string | Buffer,
    encodingOrCallback: "utf8" | Utf8StreamWriteCallback,
    suppliedCallback?: Utf8StreamWriteCallback,
  ): void {
    const callback = typeof encodingOrCallback === "function"
      ? encodingOrCallback
      : suppliedCallback;
    if (callback === undefined) {
      throw new ERR_INVALID_ARG_TYPE("callback", "Function", callback);
    }
    const complete = (error: unknown, written?: number): void => {
      callback(normalizeSystemError(error), written);
    };
    if (typeof data === "string") fsWrite(fd, data, null, "utf8", complete);
    else fsWrite(fd, data, complete);
  },

  writeSync(fd: number, data: string | Buffer, encoding?: "utf8"): number {
    return typeof data === "string"
      ? fsWriteSync(fd, data, null, encoding)
      : fsWriteSync(fd, data);
  },

  fsync(fd: number, callback: Utf8StreamErrorCallback): void {
    fsFsync(fd, (error: unknown) => callback(normalizeSystemError(error)));
  },

  fsyncSync: fsFsyncSync,

  close(fd: number, callback: Utf8StreamErrorCallback): void {
    fsClose(fd, (error: unknown) => callback(normalizeSystemError(error)));
  },

  open(
    path: string,
    flags: "a" | "w",
    mode: number | string | undefined,
    callback: (error: Utf8StreamSystemError | null, fd?: number) => void,
  ): void {
    fsOpen(path, flags, mode, (error: unknown, fd?: number) => {
      callback(normalizeSystemError(error), fd);
    });
  },

  openSync: fsOpenSync,

  mkdir(
    path: string,
    options: { recursive: true },
    callback: Utf8StreamErrorCallback,
  ): void {
    fsMkdir(path, options, (error: unknown) => callback(normalizeSystemError(error)));
  },

  mkdirSync: fsMkdirSync,
};

function completeFileSystem(
  override: Partial<Utf8StreamFileSystem>,
): Utf8StreamFileSystem {
  return {
    write: override.write === undefined ? defaultFileSystem.write : override.write,
    writeSync: override.writeSync === undefined
      ? defaultFileSystem.writeSync
      : override.writeSync,
    fsync: override.fsync === undefined ? defaultFileSystem.fsync : override.fsync,
    fsyncSync: override.fsyncSync === undefined
      ? defaultFileSystem.fsyncSync
      : override.fsyncSync,
    close: override.close === undefined ? defaultFileSystem.close : override.close,
    open: override.open === undefined ? defaultFileSystem.open : override.open,
    openSync: override.openSync === undefined
      ? defaultFileSystem.openSync
      : override.openSync,
    mkdir: override.mkdir === undefined ? defaultFileSystem.mkdir : override.mkdir,
    mkdirSync: override.mkdirSync === undefined
      ? defaultFileSystem.mkdirSync
      : override.mkdirSync,
  };
}

function noopFlush(_error?: Utf8StreamSystemError | null): void {}

function retriesBusyError(error: Utf8StreamSystemError | null | undefined): boolean {
  return error?.code === "EAGAIN" || error?.code === "EBUSY";
}

function releaseUtf8Buffer(
  writingBuffer: string,
  bufferedLength: number,
  bytesWritten: number | undefined,
): { writingBuffer: string; bufferedLength: number } {
  // Custom synchronous fs implementations in Node's supported override
  // contract sometimes forward a successful write without returning its byte
  // count. Node's string path treats that as a complete write (through
  // Buffer.subarray's omitted-end semantics), and its own retry fixture relies
  // on it. Make that normalization explicit instead of depending on an
  // `undefined` arithmetic side effect.
  let charactersWritten = bytesWritten ?? writingBuffer.length;
  const byteLength = Buffer.byteLength(writingBuffer);
  if (byteLength === bytesWritten) {
    charactersWritten = writingBuffer.length;
  } else {
    // A partial native write may stop inside one UTF-8 code point. Back up to
    // its leading byte, then count the complete UTF-16 characters before it.
    const encoded = Buffer.from(writingBuffer);
    while (charactersWritten > 0) {
      const byte = encoded[charactersWritten];
      if (byte === undefined || (byte & 0xc0) !== 0x80) break;
      charactersWritten -= 1;
    }
    charactersWritten = encoded.subarray(0, charactersWritten).toString().length;
  }
  return {
    writingBuffer: writingBuffer.slice(charactersWritten),
    bufferedLength: Math.max(bufferedLength - charactersWritten, 0),
  };
}

function mergeBufferBatch(batch: Buffer[] | undefined, length: number | undefined): Buffer {
  if (batch === undefined || batch.length === 0) return EMPTY_BUFFER;
  if (batch.length === 1) return batch[0] ?? EMPTY_BUFFER;
  return Buffer.concat(batch, length);
}

/** Node's high-throughput buffered UTF-8 file writer. */
export class Utf8Stream extends EventEmitter {
  #bufferedLength = 0;
  #fd = -1;
  #utf8Buffers: string[] = [];
  #bufferBatches: Buffer[][] = [];
  #bufferBatchLengths: number[] = [];
  #writingUtf8 = "";
  #writingBuffer = EMPTY_BUFFER;
  #writing = false;
  #ending = false;
  #reopening = false;
  #asyncDrainScheduled = false;
  #flushPending = false;
  #highWaterMark = HIGH_WATER_MARK;
  #file: string | undefined;
  #destroyed = false;
  #minLength = 0;
  #maxLength = 0;
  #maxWrite = MAX_WRITE;
  #opening = false;
  #periodicFlush = 0;
  #periodicFlushTimer: Timeout<[]> | undefined;
  #sync = false;
  #fsync = false;
  #append = true;
  #mode: number | string | undefined;
  #retryEAGAIN: NonNullable<Utf8StreamOptions["retryEAGAIN"]> = () => true;
  #mkdir = false;
  readonly #contentMode: Utf8StreamContentMode;
  readonly #fs: Utf8StreamFileSystem;

  constructor(options: Utf8StreamOptions);
  constructor(options: Utf8StreamOptions = {}) {
    validateObject(options, "options");
    super();

    const {
      dest,
      minLength,
      maxLength,
      maxWrite,
      periodicFlush,
      sync,
      append = true,
      mkdir,
      retryEAGAIN,
      fsync,
      contentMode = "utf8",
      mode,
      fs: overrideFileSystem = {},
    } = options;
    const fd: number | string | undefined = options.fd ?? dest;

    validateObject(overrideFileSystem, "options.fs");
    this.#fs = completeFileSystem(overrideFileSystem);
    validateFunction(this.#fs.write, "options.fs.write");
    validateFunction(this.#fs.writeSync, "options.fs.writeSync");
    validateFunction(this.#fs.fsync, "options.fs.fsync");
    validateFunction(this.#fs.fsyncSync, "options.fs.fsyncSync");
    validateFunction(this.#fs.close, "options.fs.close");
    validateFunction(this.#fs.open, "options.fs.open");
    validateFunction(this.#fs.mkdir, "options.fs.mkdir");
    validateFunction(this.#fs.mkdirSync, "options.fs.mkdirSync");

    this.#highWaterMark = Math.max(minLength || 0, this.#highWaterMark);
    this.#minLength = minLength || 0;
    this.#maxLength = maxLength || 0;
    this.#maxWrite = maxWrite || MAX_WRITE;
    this.#periodicFlush = periodicFlush || 0;
    this.#sync = sync || false;
    this.#fsync = fsync || false;
    this.#append = append || false;
    this.#mode = mode;
    this.#retryEAGAIN = retryEAGAIN || (() => true);
    this.#mkdir = mkdir || false;
    this.#contentMode = contentMode;

    validateUint32(this.#highWaterMark, "options.hwm");
    validateUint32(this.#minLength, "options.minLength");
    validateUint32(this.#maxLength, "options.maxLength");
    validateUint32(this.#maxWrite, "options.maxWrite");
    validateUint32(this.#periodicFlush, "options.periodicFlush");
    validateBoolean(this.#sync, "options.sync");
    validateBoolean(this.#fsync, "options.fsync");
    validateBoolean(this.#append, "options.append");
    validateBoolean(this.#mkdir, "options.mkdir");
    validateFunction(this.#retryEAGAIN, "options.retryEAGAIN");
    validateOneOf(this.#contentMode, "options.contentMode", ["buffer", "utf8"]);

    if (typeof fd === "number") {
      this.#fd = fd;
      nextTick(() => this.emit("ready"));
    } else if (typeof fd === "string") {
      this.#openFile(fd);
    } else {
      throw new ERR_INVALID_ARG_TYPE("fd", ["number", "string"], fd);
    }

    if (this.#minLength >= this.#maxWrite) {
      throw new ERR_INVALID_ARG_VALUE_RANGE(
        "minLength",
        this.#minLength,
        `should be smaller than maxWrite (${this.#maxWrite})`,
      );
    }

    this.on("newListener", (name: unknown) => {
      if (name === "drain") this.#asyncDrainScheduled = false;
    });

    if (this.#periodicFlush !== 0) {
      this.#periodicFlushTimer = setInterval(
        () => this.flush(),
        this.#periodicFlush,
      );
      this.#periodicFlushTimer.unref();
    }
  }

  write(data: string | Buffer): boolean {
    return this.#contentMode === "buffer"
      ? this.#writeBuffer(data)
      : this.#writeUtf8(data);
  }

  flush(callback: Utf8StreamErrorCallback = noopFlush): void {
    validateFunction(callback, "cb");
    if (this.#contentMode === "buffer") this.#flushBuffer(callback);
    else this.#flushUtf8(callback);
  }

  flushSync(): void {
    if (this.#contentMode === "buffer") this.#flushBufferSync();
    else this.#flushUtf8Sync();
  }

  reopen(file?: string): void {
    if (this.#destroyed) throw new ERR_INVALID_STATE("Utf8Stream is destroyed");
    if (this.#opening) {
      this.once("ready", () => this.reopen(file));
      return;
    }
    if (this.#ending) return;
    if (this.#file === undefined) {
      throw new ERR_OPERATION_FAILED(
        "Unable to reopen a file descriptor, you must pass a file to SonicBoom",
      );
    }
    if (file) this.#file = file;
    this.#reopening = true;
    if (this.#writing) return;

    const oldFd = this.#fd;
    this.once("ready", () => {
      if (oldFd !== this.#fd) {
        this.#fs.close(oldFd, (error?: Utf8StreamSystemError | null) => {
          if (error) this.emit("error", error);
        });
      }
    });
    this.#openFile(this.#file);
  }

  end(): void {
    if (this.#destroyed) throw new ERR_INVALID_STATE("Utf8Stream is destroyed");
    if (this.#opening) {
      this.once("ready", () => this.end());
      return;
    }
    if (this.#ending) return;
    this.#ending = true;
    if (this.#writing) return;
    if (this.#bufferedLength > 0 && this.#fd >= 0) this.#actualWrite();
    else this.#actualClose();
  }

  destroy(): void {
    if (!this.#destroyed) this.#actualClose();
  }

  get mode(): number | string | undefined { return this.#mode; }
  get file(): string | undefined { return this.#file; }
  get fd(): number { return this.#fd; }
  get minLength(): number { return this.#minLength; }
  get maxLength(): number { return this.#maxLength; }
  get writing(): boolean { return this.#writing; }
  get sync(): boolean { return this.#sync; }
  get fsync(): boolean { return this.#fsync; }
  get append(): boolean { return this.#append; }
  get periodicFlush(): number { return this.#periodicFlush; }
  get contentMode(): Utf8StreamContentMode { return this.#contentMode; }
  get mkdir(): boolean { return this.#mkdir; }

  [Symbol.dispose](): void { this.destroy(); }

  #currentWritingLength(): number {
    return this.#contentMode === "buffer"
      ? this.#writingBuffer.length
      : this.#writingUtf8.length;
  }

  #hasWritingData(): boolean {
    return this.#currentWritingLength() !== 0;
  }

  #release(
    error?: Utf8StreamSystemError | null,
    written?: number,
  ): void {
    if (error) {
      const writingLength = this.#currentWritingLength();
      if (
        retriesBusyError(error) &&
        this.#retryEAGAIN(
          error,
          writingLength,
          this.#bufferedLength - writingLength,
        )
      ) {
        if (this.#sync) {
          try {
            sleep(BUSY_WRITE_TIMEOUT);
            this.#release(undefined, 0);
          } catch (retryError) {
            this.#release(normalizeSystemError(retryError));
          }
        } else {
          setTimeout(() => this.#writeCurrentAsync(), BUSY_WRITE_TIMEOUT);
        }
      } else {
        this.#writing = false;
        this.emit("error", error);
      }
      return;
    }

    this.emit("write", written);
    if (this.#contentMode === "buffer") {
      const bytesWritten = written ?? 0;
      this.#bufferedLength = Math.max(this.#bufferedLength - bytesWritten, 0);
      this.#writingBuffer = this.#writingBuffer.subarray(bytesWritten);
    } else {
      const released = releaseUtf8Buffer(
        this.#writingUtf8,
        this.#bufferedLength,
        written,
      );
      this.#writingUtf8 = released.writingBuffer;
      this.#bufferedLength = released.bufferedLength;
    }

    if (this.#hasWritingData()) {
      if (!this.#sync) {
        this.#writeCurrentAsync();
        return;
      }
      try {
        do {
          const count = this.#writeCurrentSync();
          if (this.#contentMode === "buffer") {
            this.#bufferedLength = Math.max(this.#bufferedLength - count, 0);
            this.#writingBuffer = this.#writingBuffer.subarray(count);
          } else {
            const released = releaseUtf8Buffer(
              this.#writingUtf8,
              this.#bufferedLength,
              count,
            );
            this.#writingUtf8 = released.writingBuffer;
            this.#bufferedLength = released.bufferedLength;
          }
        } while (this.#hasWritingData());
      } catch (writeError) {
        this.#release(normalizeSystemError(writeError));
        return;
      }
    }

    if (this.#fsync) this.#fs.fsyncSync(this.#fd);

    const remaining = this.#bufferedLength;
    if (this.#reopening) {
      this.#writing = false;
      this.#reopening = false;
      this.reopen();
    } else if (remaining > this.#minLength) {
      this.#actualWrite();
    } else if (this.#ending) {
      if (remaining > 0) this.#actualWrite();
      else {
        this.#writing = false;
        this.#actualClose();
      }
    } else {
      this.#writing = false;
      if (this.#sync) {
        if (!this.#asyncDrainScheduled) {
          this.#asyncDrainScheduled = true;
          nextTick(() => this.#emitDrain());
        }
      } else {
        this.emit("drain");
      }
    }
  }

  #openFile(file: string): void {
    this.#opening = true;
    this.#writing = true;
    this.#asyncDrainScheduled = false;

    const fileOpened = (
      error: Utf8StreamSystemError | null,
      fd?: number,
    ): void => {
      if (error) {
        this.#reopening = false;
        this.#writing = false;
        this.#opening = false;
        if (this.#sync) {
          nextTick(() => {
            if (this.listenerCount("error") > 0) this.emit("error", error);
          });
        } else {
          this.emit("error", error);
        }
        return;
      }
      if (fd === undefined) {
        this.emit("error", new ERR_OPERATION_FAILED("fs.open returned no file descriptor"));
        return;
      }

      const reopening = this.#reopening;
      this.#fd = fd;
      this.#file = file;
      this.#reopening = false;
      this.#opening = false;
      this.#writing = false;

      if (this.#sync) nextTick(() => this.emit("ready"));
      else this.emit("ready");

      if (this.#destroyed) return;
      if ((!this.#writing && this.#bufferedLength > this.#minLength) || this.#flushPending) {
        this.#actualWrite();
      } else if (reopening) {
        nextTick(() => this.emit("drain"));
      }
    };

    const flags = this.#append ? "a" : "w";
    if (this.#sync) {
      try {
        if (this.#mkdir) this.#fs.mkdirSync(dirname(file), { recursive: true });
        fileOpened(null, this.#fs.openSync(file, flags, this.#mode));
      } catch (openError) {
        const error = normalizeSystemError(openError);
        fileOpened(error);
        throw openError;
      }
    } else if (this.#mkdir) {
      this.#fs.mkdir(dirname(file), { recursive: true }, (error) => {
        if (error) fileOpened(error);
        else this.#fs.open(file, flags, this.#mode, fileOpened);
      });
    } else {
      this.#fs.open(file, flags, this.#mode, fileOpened);
    }
  }

  #emitDrain(): void {
    if (this.listenerCount("drain") === 0) return;
    this.#asyncDrainScheduled = false;
    this.emit("drain");
  }

  #actualClose(): void {
    if (this.#fd === -1) {
      this.once("ready", () => this.#actualClose());
      return;
    }
    if (this.#periodicFlushTimer !== undefined) {
      clearInterval(this.#periodicFlushTimer);
    }
    this.#destroyed = true;
    this.#utf8Buffers = [];
    this.#bufferBatches = [];
    this.#bufferBatchLengths = [];

    const done = (error?: Utf8StreamSystemError | null): void => {
      if (error) {
        this.emit("error", error);
        return;
      }
      if (this.#ending && !this.#writing) this.emit("finish");
      this.emit("close");
    };
    const close = (): void => {
      if (this.#fd !== 1 && this.#fd !== 2) this.#fs.close(this.#fd, done);
      else done();
    };
    try {
      this.#fs.fsync(this.#fd, close);
    } catch {
      // Node deliberately ignores a synchronous fsync failure while closing.
    }
  }

  #actualWrite(): void {
    this.#writing = true;
    if (this.#contentMode === "buffer") {
      if (this.#writingBuffer.length === 0) {
        this.#writingBuffer = mergeBufferBatch(
          this.#bufferBatches.shift(),
          this.#bufferBatchLengths.shift(),
        );
      }
    } else if (this.#writingUtf8.length === 0) {
      this.#writingUtf8 = this.#utf8Buffers.shift() ?? "";
    }

    if (this.#sync) {
      try {
        this.#release(null, this.#writeCurrentSync());
      } catch (writeError) {
        this.#release(normalizeSystemError(writeError));
      }
    } else {
      this.#writeCurrentAsync();
    }
  }

  #writeCurrentSync(): number {
    return this.#contentMode === "buffer"
      ? this.#fs.writeSync(this.#fd, this.#writingBuffer)
      : this.#fs.writeSync(this.#fd, this.#writingUtf8, "utf8");
  }

  #writeCurrentAsync(): void {
    if (this.#contentMode === "buffer") {
      this.#fs.write(this.#fd, this.#writingBuffer, (error, written) => {
        this.#release(error, written);
      });
    } else {
      this.#fs.write(this.#fd, this.#writingUtf8, "utf8", (error, written) => {
        this.#release(error, written);
      });
    }
  }

  #requireFlushable(): void {
    if (this.#destroyed) throw new ERR_INVALID_STATE("Utf8Stream is destroyed");
    if (this.#fd < 0) throw new ERR_INVALID_STATE("Invalid file descriptor");
  }

  #flushBufferSync(): void {
    this.#requireFlushable();
    if (!this.#writing && this.#writingBuffer.length > 0) {
      this.#bufferBatches.unshift([this.#writingBuffer]);
      this.#bufferBatchLengths.unshift(this.#writingBuffer.length);
      this.#writingBuffer = EMPTY_BUFFER;
    }

    let buffer = EMPTY_BUFFER;
    while (this.#bufferBatches.length > 0 || buffer.length > 0) {
      if (buffer.length === 0) {
        buffer = mergeBufferBatch(
          this.#bufferBatches[0],
          this.#bufferBatchLengths[0],
        );
      }
      try {
        const written = this.#fs.writeSync(this.#fd, buffer);
        buffer = buffer.subarray(written);
        this.#bufferedLength = Math.max(this.#bufferedLength - written, 0);
        if (buffer.length === 0) {
          this.#bufferBatches.shift();
          this.#bufferBatchLengths.shift();
        }
      } catch (writeError) {
        const error = normalizeSystemError(writeError);
        if (retriesBusyError(error)) {
          if (!this.#retryEAGAIN(
            error,
            buffer.length,
            this.#bufferedLength - buffer.length,
          )) throw writeError;
        }
        sleep(BUSY_WRITE_TIMEOUT);
      }
    }
  }

  #flushUtf8Sync(): void {
    this.#requireFlushable();
    if (!this.#writing && this.#writingUtf8.length > 0) {
      this.#utf8Buffers.unshift(this.#writingUtf8);
      this.#writingUtf8 = "";
    }

    let buffer = "";
    while (this.#utf8Buffers.length > 0 || buffer.length > 0) {
      if (buffer.length === 0) buffer = this.#utf8Buffers[0] ?? "";
      try {
        const written = this.#fs.writeSync(this.#fd, buffer, "utf8");
        const released = releaseUtf8Buffer(buffer, this.#bufferedLength, written);
        buffer = released.writingBuffer;
        this.#bufferedLength = released.bufferedLength;
        if (buffer.length === 0) this.#utf8Buffers.shift();
      } catch (writeError) {
        const error = normalizeSystemError(writeError);
        if (retriesBusyError(error)) {
          if (!this.#retryEAGAIN(
            error,
            buffer.length,
            this.#bufferedLength - buffer.length,
          )) throw writeError;
        }
        sleep(BUSY_WRITE_TIMEOUT);
      }
    }

    try {
      this.#fs.fsyncSync(this.#fd);
    } catch {
      // The descriptor may not support fsync; Node intentionally ignores it.
    }
  }

  #callFlushCallbackOnDrain(callback: Utf8StreamErrorCallback): void {
    this.#flushPending = true;
    const onDrain = (): void => {
      if (!this.#fsync && !this.#destroyed) {
        try {
          this.#fs.fsync(this.#fd, (error) => {
            this.#flushPending = false;
            callback(error?.code === "EBADF" ? undefined : error);
          });
        } catch (flushError) {
          this.#flushPending = false;
          callback(normalizeSystemError(flushError));
        }
      } else {
        this.#flushPending = false;
        callback();
      }
      this.off("error", onError);
    };
    const onError = (error: Utf8StreamSystemError): void => {
      this.#flushPending = false;
      callback(error);
      this.off("drain", onDrain);
    };
    this.once("drain", onDrain);
    this.once("error", onError);
  }

  #flushBuffer(callback: Utf8StreamErrorCallback): void {
    if (this.#destroyed) {
      callback(new ERR_INVALID_STATE("Utf8Stream is destroyed"));
      return;
    }
    if (this.#minLength <= 0) {
      callback();
      return;
    }
    this.#callFlushCallbackOnDrain(callback);
    if (this.#writing) return;
    if (this.#bufferBatches.length === 0) {
      this.#bufferBatches.push([]);
      this.#bufferBatchLengths.push(0);
    }
    this.#actualWrite();
  }

  #flushUtf8(callback: Utf8StreamErrorCallback): void {
    if (this.#destroyed) {
      callback(new ERR_INVALID_STATE("Utf8Stream is destroyed"));
      return;
    }
    if (this.#minLength <= 0) {
      callback();
      return;
    }
    this.#callFlushCallbackOnDrain(callback);
    if (this.#writing) return;
    if (this.#utf8Buffers.length === 0) this.#utf8Buffers.push("");
    this.#actualWrite();
  }

  #writeBuffer(data: string | Buffer): boolean {
    if (this.#destroyed) throw new ERR_INVALID_STATE("Utf8Stream is destroyed");
    if (!Buffer.isBuffer(data)) {
      throw new ERR_INVALID_ARG_TYPE("data", "Buffer", data);
    }

    const nextLength = this.#bufferedLength + data.length;
    if (this.#maxLength !== 0 && nextLength > this.#maxLength) {
      this.emit("drop", data);
      return this.#bufferedLength < this.#highWaterMark;
    }

    const lastBatch = this.#bufferBatches[this.#bufferBatches.length - 1];
    const lastLength = this.#bufferBatchLengths[this.#bufferBatchLengths.length - 1];
    if (
      lastBatch === undefined ||
      lastLength === undefined ||
      lastLength + data.length > this.#maxWrite
    ) {
      this.#bufferBatches.push([data]);
      this.#bufferBatchLengths.push(data.length);
    } else {
      lastBatch.push(data);
      this.#bufferBatchLengths[this.#bufferBatchLengths.length - 1] =
        lastLength + data.length;
    }

    this.#bufferedLength = nextLength;
    if (!this.#writing && this.#bufferedLength >= this.#minLength) {
      this.#actualWrite();
    }
    return this.#bufferedLength < this.#highWaterMark;
  }

  #writeUtf8(data: string | Buffer): boolean {
    if (this.#destroyed) throw new ERR_INVALID_STATE("Utf8Stream is destroyed");
    validateString(data, "data");

    const nextLength = this.#bufferedLength + data.length;
    if (this.#maxLength !== 0 && nextLength > this.#maxLength) {
      this.emit("drop", data);
      return this.#bufferedLength < this.#highWaterMark;
    }

    const lastIndex = this.#utf8Buffers.length - 1;
    const last = this.#utf8Buffers[lastIndex];
    if (last === undefined || last.length + data.length > this.#maxWrite) {
      this.#utf8Buffers.push(data);
    } else {
      this.#utf8Buffers[lastIndex] = last + data;
    }

    this.#bufferedLength = nextLength;
    if (!this.#writing && this.#bufferedLength >= this.#minLength) {
      this.#actualWrite();
    }
    return this.#bufferedLength < this.#highWaterMark;
  }
}
