// Both halves at once, from node v24.20.0 `lib/internal/streams/duplex.js`.
//
// A duplex is a stream you can read from *and* write to, and the two sides are
// independent: a socket you have finished sending on may still be receiving.
// That independence is the whole design -- two states, two buffers, two sets
// of events -- and `allowHalfOpen` is the switch that decides whether the ends
// are tied together.
//
// JavaScript has single inheritance, so node builds this by inheriting from
// `Readable` and copying `Writable`'s prototype across. That looks like a
// hack and is the right call: the alternative is a second implementation of
// every writable method, and two implementations of one rule drift. The same
// choice is made here, with an interface declaration so the copied members are
// visible to the type checker rather than merely present at runtime.

import { Readable, ReadableState, onReadableConstructed } from "./readable.ts";
import { Writable, WritableState, onWritableConstructed } from "./writable.ts";
import type { ReadableOptions } from "./readable.ts";
import type { WritableOptions, WriteCallback } from "./writable.ts";
import { construct, destroy } from "./destroy.ts";
import type { DestroyableStream } from "./destroy.ts";
import { addAbortSignalNoValidate } from "./add-abort-signal.ts";

export interface DuplexOptions extends ReadableOptions, WritableOptions {
  /** Keep the readable side open after the writable side ends. Default true. */
  allowHalfOpen?: boolean | undefined;
  /** `false` builds a duplex whose readable side is closed from the start. */
  readable?: boolean | undefined;
  /** `false` builds a duplex whose writable side is closed from the start. */
  writable?: boolean | undefined;
}

/**
 * What `Writable`'s prototype contributes, copied on below.
 *
 * Written out rather than derived with `Pick`, because `Pick` turns a method
 * into a property of function type and a subclass may then not override it
 * with a method -- which `Transform` does, for `_write`.
 */
interface WritableSide {
  write(chunk: unknown, encoding?: string | WriteCallback | null, callback?: WriteCallback): boolean;
  end(chunk?: unknown, encoding?: string | WriteCallback | null, callback?: WriteCallback): this;
  cork(): void;
  uncork(): void;
  setDefaultEncoding(encoding: string): this;
  _write(chunk: unknown, encoding: string, callback: WriteCallback): void;
  _writev: ((chunks: never, callback: WriteCallback) => void) | null;
  _final?(callback: WriteCallback): void;
  readonly writable: boolean;
  readonly writableFinished: boolean;
  readonly writableObjectMode: boolean;
  readonly writableBuffer: unknown;
  readonly writableEnded: boolean;
  readonly writableNeedDrain: boolean;
  readonly writableHighWaterMark: number | undefined;
  readonly writableCorked: number;
  readonly writableLength: number | undefined;
  readonly writableAborted: boolean;
}

export interface Duplex extends WritableSide {}

export class Duplex extends Readable {
  _writableState: WritableState;

  /**
   * Whether the readable side survives the writable side ending.
   *
   * True by default, which is what a socket wants: sending `FIN` says "I have
   * nothing more to send", not "stop sending to me". Setting it false makes
   * `end()` close both, which is what a transform wants.
   */
  allowHalfOpen = true;

  constructor(options?: DuplexOptions) {
    super();

    // Both states are built with `isDuplex` set, which is what makes
    // `readableHighWaterMark` and `writableHighWaterMark` mean anything: on a
    // one-sided stream they are keys that do nothing.
    this._readableState = new ReadableState(options, this, true);
    this._writableState = new WritableState(options, this as unknown as Writable, true);

    if (options) {
      this.allowHalfOpen = options.allowHalfOpen !== false;

      // A side switched off at construction is born finished rather than
      // absent, so everything that waits for it is already satisfied. Absent
      // would make every predicate answer "not a stream".
      if (options.readable === false) {
        this._readableState.readable = false;
        this._readableState.ended = true;
        this._readableState.endEmitted = true;
      }

      if (options.writable === false) {
        this._writableState.writable = false;
        this._writableState.ending = true;
        this._writableState.ended = true;
        this._writableState.finished = true;
      }

      if (typeof options.read === "function") this._read = options.read;
      if (typeof options.write === "function") this._write = options.write as never;
      if (typeof options.writev === "function") this._writev = options.writev;
      if (typeof options.destroy === "function") this._destroy = options.destroy as never;
      if (typeof options.final === "function") this._final = options.final;
      if (typeof options.construct === "function") this._construct = options.construct;
      if (options.signal) addAbortSignalNoValidate(options.signal, this);
    }

    if (this._construct != null) {
      // Both sides, because a duplex constructs once for the pair.
      construct(this as unknown as DestroyableStream, () => {
        onReadableConstructed(this);
        onWritableConstructed(this as unknown as Writable);
      });
    }
  }

  /**
   * Destroyed only when *both* sides are.
   *
   * A duplex whose writable side has been torn down still has data to deliver,
   * and reporting it destroyed would make every consumer stop reading.
   */
  override get destroyed(): boolean {
    if (this._readableState === undefined || this._writableState === undefined) return false;
    return this._readableState.destroyed && this._writableState.destroyed;
  }

  override set destroyed(value: boolean) {
    if (this._readableState && this._writableState) {
      this._readableState.destroyed = value;
      this._writableState.destroyed = value;
    }
  }

  override destroy(error?: unknown, callback?: WriteCallback): this {
    // `Writable`'s, because it flushes the pending write callbacks first --
    // a duplex torn down mid-write has callers waiting on both sides.
    Writable.prototype.destroy.call(this as unknown as Writable, error, callback);
    return this;
  }

  static from(body: unknown): Duplex {
    // Assigned by `duplexify.ts` once it is loaded, to avoid a cycle: making
    // a duplex out of arbitrary things needs `Duplex` itself.
    return duplexifyImpl(body, "body");
  }
}

// The writable half, installed once. Only the members `Duplex` does not
// define itself: its own `destroy` and `destroyed` are deliberately different,
// and `pipe` belongs to the readable side.
{
  const own = Object.getOwnPropertyNames(Writable.prototype);
  for (const name of own) {
    if (name === "constructor" || name === "destroy" || name === "destroyed" || name === "pipe") {
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(Duplex.prototype, name)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(Writable.prototype, name);
    if (descriptor) Object.defineProperty(Duplex.prototype, name, descriptor);
  }
}

/**
 * `Duplex.from`, supplied by `duplexify.ts`.
 *
 * A function-valued hole rather than an import, because `duplexify` builds
 * `Duplex` instances and importing it here would be a cycle. `duplexify.ts`
 * fills it when it is loaded.
 */
let duplexifyImpl: (body: unknown, name: string) => Duplex = () => {
  throw new Error("stream/duplexify has not been loaded");
};

export function setDuplexify(impl: (body: unknown, name: string) => Duplex): void {
  duplexifyImpl = impl;
}
