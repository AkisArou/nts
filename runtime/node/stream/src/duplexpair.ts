// Two duplexes wired to each other, from node v24.20.0
// `lib/internal/streams/duplexpair.js`.
//
// Writing to one side is reading from the other, in both directions. It is a
// socket without a network: `node:http` uses it to run a client against a
// server in one process, and a test uses it wherever it would otherwise need
// to open a port.
//
// The chunk handoff is the whole implementation, and it is deliberately
// unbuffered. A write pushes straight into the other side and *holds its
// callback* until that side is read, so backpressure is exact -- the writer
// does not proceed until the reader has taken what it sent. Buffering here
// would make the pair look like a stream with a queue, which is what a caller
// using it as a socket stand-in is trying to avoid.

import { nextTick } from "../../internal/tick.ts";
import { Duplex } from "./duplex.ts";
import type { DuplexOptions } from "./duplex.ts";

type WriteCb = (error?: unknown) => void;

class DuplexSide extends Duplex {
  /** The write callback this side is holding until it is read. */
  #callback: WriteCb | null = null;
  #otherSide: DuplexSide | null = null;

  constructor(options?: DuplexOptions) {
    super(options);
    this.#callback = null;
    this.#otherSide = null;
  }

  /** Settable once, so a pair cannot be re-pointed at a third stream. */
  initOtherSide(otherSide: DuplexSide): void {
    if (this.#otherSide === null) this.#otherSide = otherSide;
  }

  /** Called by the other side when it is holding our callback. */
  hold(callback: WriteCb): void {
    this.#callback = callback;
  }

  release(): void {
    const callback = this.#callback;
    if (callback) {
      this.#callback = null;
      callback();
    }
  }

  isHolding(): boolean {
    return this.#callback !== null;
  }

  #peer(): DuplexSide {
    if (this.#otherSide === null) {
      throw new Error("duplex pair side has not been connected");
    }
    return this.#otherSide;
  }

  override _read(): void {
    // Reading is what releases the writer on the other side.
    this.release();
  }

  override _write(chunk: unknown, _encoding: string | undefined, callback: WriteCb): void {
    const other = this.#peer();
    // An empty chunk carries nothing to read, so holding the callback for a
    // read that will never be prompted would deadlock the pair.
    if (
      (typeof chunk === "string" || chunk instanceof Uint8Array) &&
      chunk.length === 0
    ) {
      nextTick(callback);
    } else {
      other.push(chunk);
      other.hold(callback);
    }
  }

  override _final(callback: WriteCb): void {
    const other = this.#peer();
    // Not finished until the other side has actually seen the end.
    other.on("end", callback);
    other.push(null);
  }

  override _destroy(error: unknown, callback: WriteCb): void {
    const other = this.#otherSide;

    if (other !== null && !other.destroyed) {
      // On a tick, so that destroying one side from inside a parser or a
      // protocol handler does not unwind through the other side's frames.
      nextTick(() => {
        if (other.destroyed) return;
        if (error) {
          // Without the error: the other side is closed gracefully so it does
          // not hang, but it is not given a failure nobody asked it to
          // handle, which would surface as an unhandled `error`.
          other.destroy();
        } else {
          other.push(null);
        }
      });
    }

    callback(error);
  }
}

export function duplexPair(options?: DuplexOptions): [Duplex, Duplex] {
  const side0 = new DuplexSide(options);
  const side1 = new DuplexSide(options);
  side0.initOtherSide(side1);
  side1.initOtherSide(side0);
  return [side0, side1];
}
