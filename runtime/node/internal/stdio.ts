// The process's own output streams.
//
// Node builds `process.stdout` and `process.stderr` as `Writable` streams over
// tty, pipe, or file handles. The compiled profile exposes the smaller common
// protocol its process, console, util, assert, and readline modules consume:
// synchronous string writes, terminal metadata, and EventEmitter error
// handling. Keeping that protocol structural lets callers supply an ordinary
// writable without coupling these foundational modules to a concrete stream
// class or handle kind.

import { EventEmitter, type Listener } from "../events/src/main.ts";
import { getColorDepth } from "./color-depth.ts";
import { uvException } from "./uv.ts";

declare function nts_write_stdout(text: string): number;
declare function nts_write_stderr(text: string): number;
declare function nts_stdout_is_tty(): boolean;
declare function nts_stderr_is_tty(): boolean;

/** The structural write operation shared by console and readline. */
export interface StringWritable {
  write(chunk: string, callback?: (err?: Error | null) => void): boolean;
}

/**
 * What `console` needs of a stream.
 *
 * Structural rather than nominal on purpose: node's tests pass their own
 * objects -- `new Stream()`, `{ write() {} }` -- and node accepts anything with
 * a `write` method. A nominal type would reject exactly the callers node
 * accepts.
 */
export interface WritableLike extends StringWritable {
  end?:
    | ((
        chunk?: string,
        encodingOrCallback?: string | ((err?: Error | null) => void),
        callback?: (err?: Error | null) => void,
      ) => unknown)
    | undefined;
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

  /**
   * Node's `end`, which on a standard stream does not end anything.
   *
   * `process.stdout` is a `Writable` whose `_destroy` is a no-op, so `end()`
   * writes its final chunk and finishes the stream while the descriptor stays
   * open -- a program cannot take the process's own output away from the rest
   * of the program. That is what node's
   * `test-stdout-cannot-be-closed-child-process-pipe.js` is named after.
   *
   * One documented difference from a real `Writable`: a later `write` here
   * still succeeds rather than reporting `ERR_STREAM_WRITE_AFTER_END`. This
   * class is the smaller protocol described at the top of the file rather than
   * a stream, and no pinned test asks for that error on a standard stream.
   */
  end(
    chunk?: string,
    encodingOrCallback?: string | ((err?: Error | null) => void),
    callback?: (err?: Error | null) => void,
  ): this {
    const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
    if (chunk !== undefined) {
      this.write(chunk, done);
    } else if (done !== undefined) {
      done(null);
    }
    this.emit("finish");
    return this;
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
