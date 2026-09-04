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

declare function nts_write_stdout(text: string): void;
declare function nts_write_stderr(text: string): void;
declare function nts_stdout_is_tty(): boolean;
declare function nts_stderr_is_tty(): boolean;
declare function nts_stdio_color_depth(): number;

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
  getColorDepth?: (() => number) | undefined;
  listenerCount?: ((event: string) => number) | undefined;
  once?: ((event: string, listener: Listener) => unknown) | undefined;
  removeListener?: ((event: string, listener: Listener) => unknown) | undefined;
  _writableState?: { errorEmitted?: boolean } | undefined;
}

class StandardStream extends EventEmitter implements WritableLike {
  readonly #sink: (text: string) => void;
  readonly #tty: () => boolean;

  constructor(sink: (text: string) => void, tty: () => boolean) {
    super();
    this.#sink = sink;
    this.#tty = tty;
  }

  /**
   * Node's `Writable.write` returns false when the caller should wait for
   * `drain`. These bindings are synchronous, so there is never anything to
   * wait for and the answer is always true.
   */
  write(chunk: string, callback?: (err?: Error | null) => void): boolean {
    try {
      this.#sink(chunk);
    } catch (err) {
      // A stream reports a write failure by calling back and emitting, not by
      // throwing at the caller: `console.log` to a closed pipe must not take
      // the program down.
      const error = err as Error;
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
    return this.#tty() ? nts_stdio_color_depth() : 1;
  }
}

export const stdout: WritableLike = new StandardStream(
  (text) => nts_write_stdout(text),
  () => nts_stdout_is_tty(),
);

export const stderr: WritableLike = new StandardStream(
  (text) => nts_write_stderr(text),
  () => nts_stderr_is_tty(),
);
