// A duplex whose output is a function of its input, from node v24.20.0
// `lib/internal/streams/transform.js`.
//
// The subtlety is backpressure across the middle. A transform has a writable
// side and a readable side and they are the same data, so the writable side
// must not accept more than the readable side can pass on -- otherwise a
// transform that inflates its input (a decompressor, say) could turn a four
// megabyte write into an out-of-memory.
//
// It does that by holding the *write callback* rather than the data: one chunk
// goes through, and if the readable side is now full, the callback that would
// let the next chunk in is kept until somebody reads. Node's note is worth
// keeping -- even in the pathological case only a single written chunk is
// consumed, and the rest wait untransformed.

import { ERR_METHOD_NOT_IMPLEMENTED } from "../../internal/errors.ts";
import { nextTick } from "../../internal/tick.ts";
import { Duplex } from "./duplex.ts";
import type { DuplexOptions } from "./duplex.ts";
import { getHighWaterMark } from "./state.ts";
import type { WriteCallback } from "./writable.ts";

export type TransformCallback = (error?: unknown, data?: unknown) => void;

export interface TransformOptions extends DuplexOptions {
  transform?: (
    chunk: unknown,
    encoding: string | undefined,
    callback: TransformCallback,
  ) => void;
  flush?: (callback: TransformCallback) => void;
}

export class Transform extends Duplex {
  /** The held write callback, released when the readable side is read. */
  #pendingWrite: WriteCallback | null = null;

  _flush?(callback: TransformCallback): void;

  constructor(options?: TransformOptions) {
    // A high water mark of zero means "buffer nothing", and a duplex would
    // read that as "buffer nothing on each side" -- which for a transform is
    // two buffers where the caller asked for none. The writable side is
    // disabled instead, so the single mark means what it says.
    let resolved: TransformOptions | undefined = options;
    if (options) {
      const readableHighWaterMark = getHighWaterMark(
        { objectMode: Boolean(options.objectMode) },
        options,
        "readableHighWaterMark",
        true,
      );
      if (readableHighWaterMark === 0) {
        resolved = {
          ...options,
          highWaterMark: null,
          readableHighWaterMark,
          writableHighWaterMark: options.writableHighWaterMark || 0,
        };
      }
    }

    super(resolved);

    // `_read` is implemented here and everything `Readable` wanted before the
    // first one has been done, so the guard that defers a synchronous push is
    // no longer needed.
    this._readableState.sync = false;

    if (options) {
      if (typeof options.transform === "function") this._transform = options.transform;
      if (typeof options.flush === "function") this._flush = options.flush;
    }

    // Through `prefinish` rather than by relying on `_final`, because some
    // transforms in the wild implement `_final` themselves, and overriding it
    // would silently replace theirs.
    if (typeof options?.final === "function") this.on("prefinish", prefinish);
  }

  /** What the stream does to each chunk. A subclass must provide one. */
  _transform(
    _chunk: unknown,
    _encoding: string | undefined,
    _callback: TransformCallback,
  ): void {
    throw new ERR_METHOD_NOT_IMPLEMENTED("_transform()");
  }

  override _write(
    chunk: unknown,
    encoding: string | undefined,
    callback: WriteCallback,
  ): void {
    const rState = this._readableState;
    const wState = this._writableState;
    const lengthBefore = rState.length;

    this._transform(chunk, encoding, (error, value) => {
      if (error) {
        callback(error);
        return;
      }

      if (value != null) this.push(value);

      if (rState.ended) {
        // The transform ended the readable side from inside itself. The
        // callback is deferred so that state change has propagated before
        // the writable side is told it may continue.
        nextTick(callback);
      } else if (
        wState.ended ||
        // The transform produced nothing, so there is no new backpressure to
        // respect; asking the writer to wait would deadlock a filter that
        // drops most of its input.
        lengthBefore === rState.length ||
        rState.length < rState.highWaterMark
      ) {
        callback();
      } else {
        // The readable side is full. Hold the callback -- and with it the
        // next write -- until a read makes room.
        this.#pendingWrite = callback;
      }
    });
  }

  override _read(): void {
    if (this.#pendingWrite) {
      const callback = this.#pendingWrite;
      this.#pendingWrite = null;
      callback();
    }
  }

  override _final(callback: WriteCallback): void {
    transformFinal(this, callback);
  }
}

/**
 * Flush whatever the transform was holding, then end the readable side.
 *
 * `_flush` is where a transform emits its trailer: the last block of a
 * compressor, the final line of a parser with no newline after it.
 */
function transformFinal(transform: Transform, callback?: WriteCallback): void {
  if (typeof transform._flush === "function" && !transform.destroyed) {
    transform._flush((error, data) => {
      if (error) {
        if (callback) callback(error);
        else transform.destroy(error);
        return;
      }
      if (data != null) transform.push(data);
      transform.push(null);
      if (callback) callback();
    });
  } else {
    transform.push(null);
    if (callback) callback();
  }
}

/** Flush after a caller-provided `_final`, with the emitter as the receiver. */
function prefinish(this: Transform): void {
  transformFinal(this);
}
