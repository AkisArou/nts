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
import { validateString } from "../../internal/validators.ts";
import { ERR_OUT_OF_RANGE } from "../../internal/errors.ts";
import * as callbacks from "./async.ts";
import { flagsOf } from "./flags.ts";

/** Emitted internally when an outstanding read or write has reported. */
const kIoDone = Symbol("kIoDone");

export interface FileStreamOptions {
  flags?: string | undefined;
  encoding?: string | undefined;
  fd?: number | null | undefined;
  mode?: number | undefined;
  autoClose?: boolean | undefined;
  emitClose?: boolean | undefined;
  start?: number | undefined;
  end?: number | undefined;
  highWaterMark?: number | undefined;
  signal?: never;
}

function checkPosition(value: number | undefined, name: string): void {
  if (value === undefined) return;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ERR_OUT_OF_RANGE(name, ">= 0 and <= 2 ** 53 - 1", value);
  }
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

  constructor(path: string | null, options: FileStreamOptions = {}) {
    super({
      // 64 KiB rather than the stream default, because a file read that costs
      // a system call should bring back enough to be worth the call.
      highWaterMark: options.highWaterMark ?? 64 * 1024,
      encoding: options.encoding,
      autoDestroy: options.autoClose ?? true,
      emitClose: options.emitClose ?? true,
    });

    if (path !== null) validateString(path, "path");
    checkPosition(options.start, "start");
    checkPosition(options.end, "end");

    this.path = path ?? undefined;
    this.fd = options.fd ?? null;
    this.flags = options.flags ?? "r";
    this.mode = options.mode ?? 0o666;
    this.autoClose = options.autoClose ?? true;
    this.start = options.start;
    this.end = options.end ?? Infinity;
    // `pos` tracks where the next read starts, and only exists when a start
    // was given: without one, reads are sequential and the descriptor's own
    // offset is the position.
    this.pos = options.start;

    if (options.start !== undefined && options.end !== undefined && options.end < options.start) {
      throw new ERR_OUT_OF_RANGE("start", `<= "end" (here: ${options.end})`, options.start);
    }
  }

  /** Whether the file is not open yet. */
  get pending(): boolean {
    return this.fd === null;
  }

  _construct(callback: (error?: unknown) => void): void {
    if (typeof this.fd === "number") {
      callback();
      return;
    }
    callbacks.open(this.path as string, this.flags, this.mode, (error, fd) => {
      if (error) {
        callback(error);
        return;
      }
      this.fd = fd as number;
      callback();
      this.emit("open", this.fd);
      this.emit("ready");
    });
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
    this.#performingIo = true;

    callbacks.read(this.fd as number, buffer, 0, wanted, this.pos ?? null, (error, bytesRead) => {
      this.#performingIo = false;

      // Destroyed while this read was outstanding: `_destroy` is waiting to
      // hear that the descriptor is free.
      if (this.destroyed) {
        this.emit(kIoDone, error);
        return;
      }

      if (error) {
        this.destroy(error);
        return;
      }

      const read = bytesRead as number;
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
    });
  }

  override _destroy(error: unknown, callback: (error?: unknown) => void): void {
    if (this.#performingIo) {
      this.once(kIoDone, ((ioError: unknown) => closeStream(this, error || ioError, callback)) as never);
    } else {
      closeStream(this, error, callback);
    }
  }

  close(callback?: (error?: unknown) => void): void {
    if (typeof callback === "function") finished(this, callback);
    this.destroy();
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
  #performingIo = false;

  constructor(path: string | null, options: FileStreamOptions = {}) {
    super({
      highWaterMark: options.highWaterMark ?? 16 * 1024,
      defaultEncoding: options.encoding ?? "utf8",
      autoDestroy: options.autoClose ?? true,
      emitClose: options.emitClose ?? true,
    });

    if (path !== null) validateString(path, "path");
    checkPosition(options.start, "start");

    this.path = path ?? undefined;
    this.fd = options.fd ?? null;
    this.flags = options.flags ?? "w";
    this.mode = options.mode ?? 0o666;
    this.autoClose = options.autoClose ?? true;
    this.start = options.start;
    this.pos = options.start;
  }

  get pending(): boolean {
    return this.fd === null;
  }

  _construct(callback: (error?: unknown) => void): void {
    if (typeof this.fd === "number") {
      callback();
      return;
    }
    callbacks.open(this.path as string, this.flags, this.mode, (error, fd) => {
      if (error) {
        callback(error);
        return;
      }
      this.fd = fd as number;
      callback();
      this.emit("open", this.fd);
      this.emit("ready");
    });
  }

  override _write(chunk: unknown, _encoding: string, callback: (error?: unknown) => void): void {
    const buffer = chunk as Buffer;
    this.#performingIo = true;

    callbacks.write(
      this.fd as number,
      buffer,
      0,
      buffer.length,
      this.pos ?? null,
      (error, written) => {
        this.#performingIo = false;

        if (this.destroyed) {
          callback(error);
          this.emit(kIoDone, error);
          return;
        }

        if (error) {
          callback(error);
          return;
        }

        this.bytesWritten += written as number;
        if (this.pos !== undefined) this.pos += written as number;
        callback();
      },
    );
  }

  override _destroy(error: unknown, callback: (error?: unknown) => void): void {
    if (this.#performingIo) {
      this.once(kIoDone, ((ioError: unknown) => closeStream(this, error || ioError, callback)) as never);
    } else {
      closeStream(this, error, callback);
    }
  }

  close(callback?: (error?: unknown) => void): void {
    if (typeof callback === "function") finished(this, callback);
    this.destroy();
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
  stream.fd = null;
  callbacks.close(fd, (closeError) => callback(error || closeError));
}

export function createReadStream(path: string | null, options?: FileStreamOptions): ReadStream {
  return new ReadStream(path, options);
}

export function createWriteStream(path: string | null, options?: FileStreamOptions): WriteStream {
  return new WriteStream(path, options);
}
