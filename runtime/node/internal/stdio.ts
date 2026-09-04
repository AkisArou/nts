// The process's own output streams.
//
// `process.stdout` is a `node:stream` `Writable` over a `node:tty` or
// `node:net` handle, and neither of those modules exists yet. What `console`
// actually asks of a stream is small -- write a string, tell me whether you
// are a terminal, let me attach an error listener -- so that much is here, as
// an `EventEmitter` over two write bindings.
//
// When `node:stream` and `node:process` land these become `process.stdout` and
// `process.stderr` and this file is deleted; the interface below is the part
// that survives, because it is what `console` was written against.

import { EventEmitter, type Listener } from "../events/src/main.ts";
import { getColorDepth } from "./color-depth.ts";
import { uvException } from "./uv.ts";

declare function nts_write_stdout(text: string): number;
declare function nts_write_stderr(text: string): number;
declare function nts_stdout_is_tty(): boolean;
declare function nts_stderr_is_tty(): boolean;

/**
 * What `console` needs of a stream.
 *
 * Structural rather than nominal on purpose: node's tests pass their own
 * objects -- `new Stream()`, `{ write() {} }` -- and node accepts anything with
 * a `write` method. A nominal type would reject exactly the callers node
 * accepts.
 */
export interface WritableLike {
  write(chunk: string, callback?: (err?: Error | null) => void): boolean;
  isTTY?: boolean | undefined;
  columns?: number | undefined;
  getColorDepth?: (() => number) | undefined;
  listenerCount?: ((event: string) => number) | undefined;
  once?: ((event: string, listener: Listener) => unknown) | undefined;
  removeListener?: ((event: string, listener: Listener) => unknown) | undefined;
  _writableState?: { errorEmitted?: boolean } | undefined;
}

class StandardStream extends EventEmitter implements WritableLike {
  readonly #sink: (text: string) => number;
  readonly #tty: () => boolean;

  constructor(sink: (text: string) => number, tty: () => boolean) {
    super();
    this.#sink = sink;
    this.#tty = tty;
  }

  /**
   * Node's `Writable.write` returns false when the caller should wait for
   * `drain`. These bindings are synchronous and have no buffered backpressure,
   * so a successful write returns true; a failed syscall is reported through
   * the callback and `error` event and returns false.
   */
  write(chunk: string, callback?: (err?: Error | null) => void): boolean {
    let error: Error | undefined;
    try {
      const errno = this.#sink(chunk);
      if (errno < 0) error = uvException(errno, "write");
    } catch (err) {
      // A stream reports a write failure by calling back and emitting, not by
      // throwing at the caller: `console.log` to a closed pipe must not take
      // the program down.
      error = err instanceof Error
        ? err
        : new Error("Failed to write to the standard stream");
    }
    if (error !== undefined) {
      if (callback) {
        callback(error);
      }
      if (this.listenerCount("error") > 0) {
        this.emit("error", error);
      }
      return false;
    }
    if (callback) {
      callback(null);
    }
    return true;
  }

  get isTTY(): boolean {
    return this.#tty();
  }

  getColorDepth(): number {
    return this.#tty() ? getColorDepth() : 1;
  }
}

export const stdout: WritableLike = new StandardStream(
  nts_write_stdout,
  nts_stdout_is_tty,
);

export const stderr: WritableLike = new StandardStream(
  nts_write_stderr,
  nts_stderr_is_tty,
);
