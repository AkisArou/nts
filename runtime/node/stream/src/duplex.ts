// Both halves at once, from node v24.20.0 `lib/internal/streams/duplex.js`.
//
// A duplex is a stream you can read from *and* write to, and the two sides are
// independent: a socket you have finished sending on may still be receiving.
// That independence is the whole design -- two states, two buffers, two sets
// of events -- and `allowHalfOpen` is the switch that decides whether the ends
// are tied together.
//
// JavaScript has single inheritance, so node builds this by inheriting from
// `Readable` and copying `Writable`'s prototype across. NTS has a closed,
// statically compiled object model: prototype copying is unavailable and
// would throw away exactly the type information the compiler can exploit.
// The writable algorithms therefore accept the explicit structural contract
// implemented by both classes, while this class declares its public surface
// normally.

import { Buffer } from "../../buffer/src/main.ts";
import {
  ERR_METHOD_NOT_IMPLEMENTED,
  ERR_STREAM_ALREADY_FINISHED,
  ERR_STREAM_DESTROYED,
  ERR_STREAM_WRITE_AFTER_END,
  ERR_UNKNOWN_ENCODING,
} from "../../internal/errors.ts";
import { nextTick } from "../../internal/tick.ts";
import { Readable, ReadableState, onReadableConstructed } from "./readable.ts";
import {
  WritableState,
  clearBuffer,
  errorBuffer,
  finishMaybe,
  isWriteCallback,
  onWritableConstructed,
  writeToWritable,
} from "./writable.ts";
import type { ReadableOptions } from "./readable.ts";
import type {
  BufferedWrite,
  WritableOptions,
  WriteCallback,
  WritevCallback,
} from "./writable.ts";
import { construct, destroy } from "./destroy.ts";
import { addAbortSignalNoValidate } from "./add-abort-signal.ts";
import { captureRejectionSymbol } from "../../events/src/main.ts";

const duplexEventShape = [
  "close",
  "error",
  "prefinish",
  "finish",
  "drain",
  "data",
  "end",
  "readable",
];

export interface DuplexOptions extends ReadableOptions, WritableOptions {
  /** Keep the readable side open after the writable side ends. Default true. */
  allowHalfOpen?: boolean | undefined;
  /** `false` builds a duplex whose readable side is closed from the start. */
  readable?: boolean | undefined;
  /** `false` builds a duplex whose writable side is closed from the start. */
  writable?: boolean | undefined;
}

export class Duplex extends Readable {
  _writableState: WritableState;
  _writev: WritevCallback | null = null;
  _final?(callback: WriteCallback): void;

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
    this._initializeEventShape(duplexEventShape);
    this._configureCaptureRejections(options?.captureRejections);
    if (options?.captureRejections === true) {
      this[captureRejectionSymbol] = (error: unknown): void => {
        this.destroy(error);
      };
    }

    // Both states are built with `isDuplex` set, which is what makes
    // `readableHighWaterMark` and `writableHighWaterMark` mean anything: on a
    // one-sided stream they are keys that do nothing.
    this._readableState = new ReadableState(options, this, true);
    this._writableState = new WritableState(options, this, true);

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
      if (typeof options.write === "function") this._write = options.write;
      if (typeof options.writev === "function") this._writev = options.writev;
      if (typeof options.destroy === "function") this._destroy = options.destroy;
      if (typeof options.final === "function") this._final = options.final;
      if (typeof options.construct === "function") this._construct = options.construct;
      if (options.signal) addAbortSignalNoValidate(options.signal, this);
    }

    if (this._construct != null) {
      // Both sides, because a duplex constructs once for the pair.
      construct(this, () => {
        onReadableConstructed(this);
        onWritableConstructed(this);
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
    const state = this._writableState;
    if ((state.buffered.length > 0 || state.onfinishCallbacks) && !state.destroyed) {
      nextTick(errorBuffer, state);
    }
    destroy(this, error, callback);
    return this;
  }

  write(
    chunk: unknown,
    encoding?: string | WriteCallback | null,
    callback?: WriteCallback,
  ): boolean {
    if (isWriteCallback(encoding)) {
      callback = encoding;
      encoding = null;
    }
    return writeToWritable(this, chunk, encoding ?? null, callback) === true;
  }

  _write(chunk: unknown, encoding: string | undefined, callback: WriteCallback): void {
    if (this._writev !== null) {
      this._writev([{ chunk, encoding, callback: ignoreWrite }], callback);
      return;
    }
    throw new ERR_METHOD_NOT_IMPLEMENTED("_write()");
  }

  _writeAfterEndError(): Error {
    return new ERR_STREAM_WRITE_AFTER_END();
  }

  cork(): void {
    this._writableState.corked++;
  }

  uncork(): void {
    const state = this._writableState;
    if (state.corked > 0) {
      state.corked--;
      if (!state.writing) clearBuffer(this, state);
    }
  }

  setDefaultEncoding(encoding: string): this {
    const normalized = encoding.toLowerCase();
    if (!Buffer.isEncoding(normalized)) throw new ERR_UNKNOWN_ENCODING(normalized);
    this._writableState.defaultEncoding = normalized;
    return this;
  }

  end(
    chunk?: unknown,
    encoding?: string | WriteCallback | null,
    callback?: WriteCallback,
  ): this {
    if (isWriteCallback(chunk)) {
      callback = chunk;
      chunk = null;
      encoding = null;
    } else if (isWriteCallback(encoding)) {
      callback = encoding;
      encoding = null;
    }

    const state = this._writableState;
    let error: unknown;
    if (chunk != null) {
      const result = writeToWritable(this, chunk, encoding ?? null);
      if (result instanceof Error) error = result;
    }

    if (state.corked > 0) {
      state.corked = 1;
      this.uncork();
    }

    if (error) {
      // The rejected write reports through the callback below.
    } else if (!state.ending && !state.errored) {
      state.ending = true;
      finishMaybe(this, state, true);
      state.ended = true;
    } else if (state.finished) {
      error = new ERR_STREAM_ALREADY_FINISHED("end");
    } else if (state.destroyed) {
      error = new ERR_STREAM_DESTROYED("end");
    }

    if (callback !== undefined) {
      if (error) nextTick(callback, error);
      else if (state.errored) nextTick(callback, state.errored);
      else if (state.finished) nextTick(callback, null);
      else (state.onfinishCallbacks ??= []).push(callback);
    }
    return this;
  }

  override get closed(): boolean {
    return this._writableState.closed;
  }

  get writable(): boolean {
    const state = this._writableState;
    return state.writable !== false &&
      !state.ending &&
      !state.ended &&
      !state.destroyed &&
      !state.errored;
  }

  set writable(value: boolean) {
    this._writableState.writable = value;
    this._writableState.hasWritable = true;
  }

  get writableFinished(): boolean {
    return this._writableState.finished;
  }

  get writableObjectMode(): boolean {
    return this._writableState.objectMode;
  }

  get writableBuffer(): BufferedWrite[] {
    return this._writableState.getBuffer();
  }

  get writableEnded(): boolean {
    return this._writableState.ending;
  }

  get writableNeedDrain(): boolean {
    const state = this._writableState;
    return !state.destroyed && !state.ending && state.needDrain;
  }

  get writableHighWaterMark(): number {
    return this._writableState.highWaterMark;
  }

  get writableCorked(): number {
    return this._writableState.corked;
  }

  get writableLength(): number {
    return this._writableState.length;
  }

  override get errored(): unknown {
    return this._writableState.errored;
  }

  get writableAborted(): boolean {
    const state = this._writableState;
    return !(state.hasWritable && state.writable) &&
      Boolean(state.destroyed || state.errored) &&
      !state.finished;
  }

  static override from(body: unknown): Duplex {
    // Assigned by `duplexify.ts` once it is loaded, to avoid a cycle: making
    // a duplex out of arbitrary things needs `Duplex` itself.
    return duplexifyImpl(body, "body");
  }

}

function ignoreWrite(): void {}

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
