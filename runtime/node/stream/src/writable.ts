// The writable half, from node v24.20.0 `lib/internal/streams/writable.js`.
//
// A `Writable` is a queue with a promise about ordering: chunks reach
// `_write` one at a time, in the order they were given, and the next one does
// not start until the previous one has called back. Everything else here --
// the buffer, the corking, the drain accounting, the finish handshake --
// exists to keep that promise while telling the producer how it is doing.
//
// `write` returning `false` is the whole of backpressure. It is advice, not a
// refusal: the chunk was accepted, and a producer that ignores the advice will
// simply buffer without limit. That is why the failure mode of getting
// backpressure wrong is memory rather than an exception.
//
// **One deliberate departure.** Node packs about thirty booleans into a single
// integer under a symbol, with generated accessors over the bits, because in
// V8 every field is a slot and a differently-ordered assignment is a different
// hidden class. That is a workaround for a specific engine. A compiler that
// lays objects out as flat structs with fixed offsets gets nothing from it and
// pays for it in readability, so the state here is ordinary named fields. The
// semantics are identical; every predicate in `utils.ts` reads the same
// property names either way.

import { Buffer } from "../../buffer/src/main.ts";
import { normalizeEncodingSpelling, type Encoding } from "../../buffer/src/encodings.ts";
import {
  AbortError,
  ERR_INVALID_ARG_TYPE,
  ERR_METHOD_NOT_IMPLEMENTED,
  ERR_MULTIPLE_CALLBACK,
  ERR_STREAM_ALREADY_FINISHED,
  ERR_STREAM_CANNOT_PIPE,
  ERR_STREAM_DESTROYED,
  ERR_STREAM_NULL_VALUES,
  ERR_STREAM_WRITE_AFTER_END,
  ERR_UNKNOWN_ENCODING,
} from "../../internal/errors.ts";
import { nextTick } from "../../internal/tick.ts";
import { Stream } from "./legacy.ts";
import { getDefaultHighWaterMark, getHighWaterMark } from "./state.ts";
import { construct, destroy, errorOrDestroy, undestroy } from "./destroy.ts";
import type { DestroyableStream } from "./destroy.ts";
import { addAbortSignalNoValidate } from "./add-abort-signal.ts";
import { eos, type AbortSignalLike } from "./end-of-stream.ts";
import { captureRejectionSymbol } from "../../events/src/main.ts";
import { newWritableFromWeb, newWritableToWeb } from "./web-adapters.ts";
import type {
  WebWritableStream,
  WritableFromWebOptions,
} from "./web-adapters.ts";

const nop = (): void => {};
const writableEventShape = ["close", "error", "prefinish", "finish", "drain"];

export type WriteCallback = (error?: unknown) => void;

export function isWriteCallback(value: unknown): value is WriteCallback {
  return typeof value === "function";
}

export interface BufferedWrite {
  chunk: unknown;
  encoding: string | undefined;
  callback: WriteCallback;
}

export type WritevCallback = (
  chunks: BufferedWrite[],
  callback: WriteCallback,
) => void;

function bufferedWriteAt(
  entries: readonly BufferedWrite[],
  index: number,
): BufferedWrite {
  const entry = entries[index];
  if (entry === undefined) {
    throw new Error("writable buffer index is outside the queued range");
  }
  return entry;
}

function callbackAt(
  callbacks: readonly WriteCallback[],
  index: number,
): WriteCallback {
  const callback = callbacks[index];
  if (callback === undefined) {
    throw new Error("writable finish-callback index is outside the queued range");
  }
  return callback;
}

function chunkLength(chunk: unknown): number {
  if (typeof chunk === "string" || chunk instanceof Uint8Array) {
    return chunk.length;
  }
  throw new Error("byte-mode writable received a chunk without a length");
}

/**
 * The statically known writable half shared by `Writable` and `Duplex`.
 *
 * JavaScript's Node implementation copies prototype descriptors to fake
 * multiple inheritance. NTS instead compiles both classes against this closed
 * structural contract, so the algorithms below dispatch to `_write` and
 * `_final` directly without a prototype walk or an adapter object.
 */
export interface WritableImplementation extends DestroyableStream {
  _writableState: WritableState;
  _writev: WritevCallback | null;
  _final?(callback: WriteCallback): void;
  _write(chunk: unknown, encoding: string | undefined, callback: WriteCallback): void;
  _writeAfterEndError(): Error;
}

export interface WritableOptions {
  objectMode?: boolean | undefined;
  writableObjectMode?: boolean | undefined;
  highWaterMark?: number | null | undefined;
  writableHighWaterMark?: number | null | undefined;
  /** Convert strings to buffers before `_write` sees them. Default true. */
  decodeStrings?: boolean | undefined;
  defaultEncoding?: Encoding | undefined;
  emitClose?: boolean | undefined;
  autoDestroy?: boolean | undefined;
  signal?: AbortSignalLike | undefined;
  captureRejections?: boolean | undefined;
  write?: (chunk: unknown, encoding: string | undefined, callback: WriteCallback) => void;
  writev?: (chunks: BufferedWrite[], callback: WriteCallback) => void;
  destroy?: (error: unknown, callback: WriteCallback) => void;
  final?: (callback: WriteCallback) => void;
  construct?: (callback: WriteCallback) => void;
}

interface AfterWriteTickInfo {
  readonly stream: WritableImplementation;
  readonly state: WritableState;
  count: number;
  readonly callback: WriteCallback;
}

export class WritableState {
  objectMode: boolean;
  highWaterMark: number;
  /** Convert a string to a Buffer before `_write`. */
  decodeStrings: boolean;
  defaultEncoding: Encoding;
  emitClose: boolean;
  autoDestroy: boolean;

  /** How much is waiting to be handed to `_write`, in bytes or in chunks. */
  length = 0;
  /** How many `cork`s deep. Writes buffer until it reaches zero again. */
  corked = 0;
  /** How much the in-flight `_write` was given, subtracted when it returns. */
  writelen = 0;
  /** User callbacks not yet called. `finish` waits for this to reach zero. */
  pendingcb = 0;

  // Where a chunk goes when it cannot be written yet, and how far through it
  // the drain has got. An index rather than a shift, because shifting an array
  // per chunk is quadratic in the number buffered.
  buffered: BufferedWrite[] = [];
  bufferedIndex = 0;
  /** No buffered chunk has a callback, so the drain need not track them. */
  allNoop = true;

  sync = true;
  constructed = true;
  writing = false;
  /** A `_write` callback is expected; a second one is a bug in the stream. */
  expectWriteCb = false;
  bufferProcessing = false;
  needDrain = false;
  ending = false;
  ended = false;
  finished = false;
  finalCalled = false;
  prefinished = false;
  destroyed = false;
  closed = false;
  closeEmitted = false;
  errored: unknown = null;
  errorEmitted = false;
  /** Whether the writable side was disabled at construction, for a duplex. */
  writable?: boolean;
  hasWritable = false;

  writecb: WriteCallback | null = null;
  /** Callbacks registered by `end(cb)` while the stream was still going. */
  onfinishCallbacks: WriteCallback[] | null = null;
  /** Coalesces the common case of many writes sharing one callback. */
  afterWriteTickInfo: AfterWriteTickInfo | null = null;
  afterWritePending = false;

  readonly onwrite: (error?: unknown) => void;

  constructor(
    options: WritableOptions | undefined,
    stream: WritableImplementation,
    isDuplex: boolean,
  ) {
    this.objectMode = Boolean(options?.objectMode) ||
      (isDuplex && Boolean(options?.writableObjectMode));

    // Zero is a legal mark and means "always ask the producer to wait", which
    // a stream that must not buffer at all wants.
    this.highWaterMark = options
      ? getHighWaterMark(this, options, "writableHighWaterMark", isDuplex)
      : getDefaultHighWaterMark(false);

    this.decodeStrings = !options || options.decodeStrings !== false;
    this.emitClose = !options || options.emitClose !== false;
    this.autoDestroy = !options || options.autoDestroy !== false;

    // `crypto` has used `binary` since before `utf8` was the obvious answer,
    // so the default is configurable rather than fixed.
    const encoding = options ? options.defaultEncoding : null;
    if (encoding == null || encoding === "utf8" || encoding === "utf-8") {
      this.defaultEncoding = "utf8";
    } else if (Buffer.isEncoding(encoding)) {
      this.defaultEncoding = encoding;
    } else {
      throw new ERR_UNKNOWN_ENCODING(encoding);
    }

    this.onwrite = (error?: unknown) => onwrite(stream, error);
  }

  /** What is buffered, as an array. For inspection; not the live storage. */
  getBuffer(): BufferedWrite[] {
    const count = this.buffered.length - this.bufferedIndex;
    const copy = new Array<BufferedWrite>(count);
    for (let i = 0; i < count; i++) {
      copy[i] = bufferedWriteAt(this.buffered, this.bufferedIndex + i);
    }
    return copy;
  }

  get bufferedRequestCount(): number {
    return this.buffered.length - this.bufferedIndex;
  }
}

/**
 * What the writable side has to do once `_construct` has finished.
 *
 * Anything written while it was constructing is buffered; this is where it
 * finally goes, and where an `end` that arrived early is honoured. Exported
 * because `Duplex` has to run it too, and running it through the public
 * surface instead -- `uncork` and `end` -- is not the same thing: `end` on an
 * already-ending stream raises `ERR_STREAM_ALREADY_FINISHED`.
 */
export function onWritableConstructed(stream: WritableImplementation): void {
  const state = stream._writableState;
  if (!state.writing) clearBuffer(stream, state);
  if (state.ending) finishMaybe(stream, state);
}

function resetBuffer(state: WritableState): void {
  state.buffered = [];
  state.bufferedIndex = 0;
  state.allNoop = true;
}

export class Writable extends Stream {
  _writableState: WritableState;
  _writev: WritevCallback | null = null;
  _final?(callback: WriteCallback): void;
  _construct?(callback: WriteCallback): void;

  constructor(options?: WritableOptions) {
    super();
    this._initializeEventShape(writableEventShape);
    this._configureCaptureRejections(options?.captureRejections);
    if (options?.captureRejections === true) {
      this[captureRejectionSymbol] = (error: unknown): void => {
        this.destroy(error);
      };
    }
    this._writableState = new WritableState(options, this, false);

    // The options are shorthand for a subclass. A stream built this way is
    // indistinguishable from one built by extending, which is what makes
    // `new Writable({ write })` a real stream and not a lesser one.
    if (options) {
      if (typeof options.write === "function") this._write = options.write;
      if (typeof options.writev === "function") this._writev = options.writev;
      if (typeof options.destroy === "function") this._destroy = options.destroy;
      if (typeof options.final === "function") this._final = options.final;
      if (typeof options.construct === "function") this._construct = options.construct;
      if (options.signal) addAbortSignalNoValidate(options.signal, this);
    }

    if (this._construct != null) {
      construct(this, () => onWritableConstructed(this));
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (!this.destroyed) {
      this.destroy(this.writableFinished ? null : new AbortError());
    }
    await new Promise<void>((resolve, reject) => {
      eos(this, (error) => {
        if (error && !isAbortError(error)) reject(error);
        else resolve();
      });
    });
  }

  /**
   * A `Writable` is not a source, so piping *from* one is a mistake.
   *
   * It inherits `pipe` from the legacy base and has to refuse it rather than
   * not have it, or `writable.pipe(x)` would be a `TypeError` about an
   * undefined function instead of a message saying what is wrong.
   */
  override pipe(): undefined {
    errorOrDestroy(this, new ERR_STREAM_CANNOT_PIPE());
    return undefined;
  }

  write(chunk: unknown, encoding?: string | WriteCallback | null, callback?: WriteCallback): boolean {
    if (isWriteCallback(encoding)) {
      callback = encoding;
      encoding = null;
    }
    return writeToWritable(this, chunk, typeof encoding === "string" ? encoding : null, callback) === true;
  }

  /** Error used when a write arrives after this writable has ended. */
  _writeAfterEndError(): Error {
    return new ERR_STREAM_WRITE_AFTER_END();
  }

  /**
   * Hold writes until the matching `uncork`.
   *
   * The point is `_writev`: a stream that can write many chunks in one system
   * call is much faster doing so, and corking is how a caller says "more is
   * coming, wait for it". Counted rather than boolean so that nested corking
   * by different layers composes.
   */
  cork(): void {
    this._writableState.corked++;
  }

  uncork(): void {
    const state = this._writableState;
    if (state.corked) {
      state.corked--;
      if (!state.writing) clearBuffer(this, state);
    }
  }

  setDefaultEncoding(encoding: Encoding): this {
    const normalized = normalizeEncodingSpelling(encoding);
    if (normalized === undefined) throw new ERR_UNKNOWN_ENCODING(encoding);
    this._writableState.defaultEncoding = normalized;
    return this;
  }

  /**
   * The stream's own write. A subclass must provide one, or `_writev`.
   *
   * The base implementation forwards to `_writev` so that a stream needs only
   * the batched form; a stream with neither is a stream that cannot write, and
   * says so rather than silently swallowing.
   */
  _write(chunk: unknown, encoding: string | undefined, callback: WriteCallback): void {
    if (this._writev !== null) {
      this._writev([{ chunk, encoding, callback: nop }], callback);
    } else {
      throw new ERR_METHOD_NOT_IMPLEMENTED("_write()");
    }
  }

  /**
   * No more writes.
   *
   * Forgiving about being called twice, deliberately. Node's note is worth
   * keeping: it can hide a logic error, but such errors are usually harmless,
   * and it is often not trivial for a caller to know whether `end` has already
   * happened -- so failing hard would be disproportionate.
   */
  end(chunk?: unknown, encoding?: string | WriteCallback | null, callback?: WriteCallback): this {
    const state = this._writableState;

    if (isWriteCallback(chunk)) {
      callback = chunk;
      chunk = null;
      encoding = null;
    } else if (isWriteCallback(encoding)) {
      callback = encoding;
      encoding = null;
    }

    let error: unknown;

    if (chunk != null) {
      const result = writeToWritable(
        this,
        chunk,
        typeof encoding === "string" ? encoding : null,
      );
      if (result instanceof Error) error = result;
    }

    // `end` releases every cork: there is nothing more coming, so holding the
    // buffer back would be waiting for a write that will never arrive.
    if (state.corked) {
      state.corked = 1;
      this.uncork();
    }

    if (error) {
      // Reported through the callback below.
    } else if (!state.ending && !state.errored) {
      state.ending = true;
      finishMaybe(this, state, true);
      state.ended = true;
    } else if (state.finished) {
      error = new ERR_STREAM_ALREADY_FINISHED("end");
    } else if (state.destroyed) {
      error = new ERR_STREAM_DESTROYED("end");
    }

    if (typeof callback === "function") {
      if (error) {
        nextTick(callback, error);
      } else if (state.errored) {
        nextTick(callback, state.errored);
      } else if (state.finished) {
        nextTick(callback, null);
      } else {
        // Not finished yet: remember the callback and call it when it is.
        (state.onfinishCallbacks ??= []).push(callback);
      }
    }

    return this;
  }

  destroy(error?: unknown, callback?: WriteCallback): this {
    const state = this._writableState;

    // Anything still queued has to be told, or a caller waiting on a write
    // callback for a chunk this stream will now never write waits forever.
    if ((state.buffered.length > 0 || state.onfinishCallbacks) && !state.destroyed) {
      nextTick(errorBuffer, state);
    }

    destroy(this, error, callback);
    return this;
  }

  _undestroy(): void {
    undestroy(this);
  }

  _destroy(_error: unknown, callback: WriteCallback): void {
    callback(_error);
  }

  get closed(): boolean {
    return this._writableState ? this._writableState.closed : false;
  }

  get destroyed(): boolean {
    return this._writableState ? this._writableState.destroyed : false;
  }

  set destroyed(value: boolean) {
    // Writable, because some streams manage this themselves and have since
    // before `destroy` existed.
    if (this._writableState) this._writableState.destroyed = value;
  }

  get writable(): boolean {
    const w = this._writableState;
    return (
      !!w && w.writable !== false && !w.ending && !w.ended && !w.destroyed && !w.errored
    );
  }

  set writable(value: boolean) {
    if (this._writableState) {
      this._writableState.writable = Boolean(value);
      this._writableState.hasWritable = true;
    }
  }

  get writableFinished(): boolean {
    return this._writableState ? this._writableState.finished : false;
  }

  get writableObjectMode(): boolean {
    return this._writableState ? this._writableState.objectMode : false;
  }

  get writableBuffer(): BufferedWrite[] | undefined {
    return this._writableState?.getBuffer();
  }

  get writableEnded(): boolean {
    return this._writableState ? this._writableState.ending : false;
  }

  /** Whether the producer should wait for `drain` before writing more. */
  get writableNeedDrain(): boolean {
    const state = this._writableState;
    return state ? !state.destroyed && !state.ending && state.needDrain : false;
  }

  get writableHighWaterMark(): number | undefined {
    return this._writableState?.highWaterMark;
  }

  get writableCorked(): number {
    return this._writableState ? this._writableState.corked : 0;
  }

  get writableLength(): number | undefined {
    return this._writableState?.length;
  }

  get errored(): unknown {
    return this._writableState ? this._writableState.errored : null;
  }

  /** Destroyed or errored before finishing, and not explicitly closed. */
  get writableAborted(): boolean {
    const state = this._writableState;
    return (
      !(state.hasWritable && state.writable) &&
      Boolean(state.destroyed || state.errored) &&
      !state.finished
    );
  }

  static fromWeb(stream: unknown, options?: WritableFromWebOptions): Writable {
    return newWritableFromWeb(Writable, stream, options);
  }

  static toWeb(stream: unknown): WebWritableStream {
    return newWritableToWeb(stream);
  }

}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * The write path, shared by `write` and `end`.
 *
 * Returns `true` when the caller may write more, `false` when it should wait
 * for `drain`, and the `Error` itself when the write was refused -- which
 * `end` uses to tell a refusal apart from backpressure.
 */
export function writeToWritable(
  stream: WritableImplementation,
  chunk: unknown,
  encoding: string | null,
  callback?: WriteCallback,
): boolean | Error {
  const state = stream._writableState;

  if (callback == null || typeof callback !== "function") callback = nop;

  // `null` is the readable side's end-of-stream marker, so writing it is
  // always a mistake rather than a value.
  if (chunk === null) throw new ERR_STREAM_NULL_VALUES();

  if (!state.objectMode) {
    if (!encoding) {
      encoding = state.defaultEncoding;
    } else if (encoding !== "buffer" && !Buffer.isEncoding(encoding)) {
      throw new ERR_UNKNOWN_ENCODING(encoding);
    }

    if (typeof chunk === "string") {
      if (encoding === "buffer") throw new ERR_UNKNOWN_ENCODING(encoding);
      if (state.decodeStrings) {
        // Decoded here rather than in `_write`, so that `writableLength` is in
        // the same units as what will actually be written -- a UTF-8 string's
        // length in characters is not its length in bytes.
        chunk = Buffer.from(chunk, encoding);
        encoding = "buffer";
      }
    } else if (chunk instanceof Buffer) {
      encoding = "buffer";
    } else if (ArrayBuffer.isView(chunk)) {
      // Wrapped rather than copied: a view already is the bytes, and writing
      // one should not cost a duplicate of it. SharedArrayBuffer is outside
      // this runtime's single-agent memory model.
      if (!(chunk.buffer instanceof ArrayBuffer)) {
        throw new ERR_INVALID_ARG_TYPE("chunk", ["Buffer", "TypedArray", "DataView"], chunk);
      }
      chunk = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      encoding = "buffer";
    } else {
      throw new ERR_INVALID_ARG_TYPE(
        "chunk",
        ["string", "Buffer", "TypedArray", "DataView"],
        chunk,
      );
    }
  }

  let error: Error | undefined;
  if (state.ending) {
    error = stream._writeAfterEndError();
  } else if (state.destroyed) {
    error = new ERR_STREAM_DESTROYED("write");
  }

  if (error) {
    // The callback first, on a tick, then the stream's own failure. A caller
    // that passed a callback learns about its own chunk before the stream
    // reports the condition to everyone.
    nextTick(callback, error);
    errorOrDestroy(stream, error, true);
    return error;
  }

  state.pendingcb++;
  return writeOrBuffer(
    stream,
    state,
    chunk,
    state.objectMode ? encoding ?? undefined : encoding ?? state.defaultEncoding,
    callback,
  );
}

function writeOrBuffer(
  stream: WritableImplementation,
  state: WritableState,
  chunk: unknown,
  encoding: string | undefined,
  callback: WriteCallback,
): boolean {
  const length = state.objectMode ? 1 : chunkLength(chunk);

  state.length += length;

  // Buffered whenever a write is already in flight, the stream is corked, it
  // has errored, or it is still constructing -- anything that means `_write`
  // must not be entered right now.
  const canWriteNow =
    !state.writing && !state.errored && !state.corked && state.constructed;

  if (!canWriteNow) {
    state.buffered.push({ chunk, encoding, callback });
    if (state.allNoop && callback !== nop) state.allNoop = false;
  } else {
    state.writelen = length;
    if (callback !== nop) state.writecb = callback;
    state.writing = true;
    state.sync = true;
    state.expectWriteCb = true;
    stream._write(chunk, encoding, state.onwrite);
    // Cleared after `_write` returns, so a callback made *during* it is
    // recognised as synchronous and deferred rather than reentering.
    state.sync = false;
  }

  const belowMark = state.length < state.highWaterMark || state.length === 0;
  if (!belowMark) state.needDrain = true;

  // False for a stream that has errored or been destroyed, so that a
  // `while (stream.write(x))` loop stops rather than spinning on a stream
  // that will never drain.
  return belowMark && !state.destroyed && !state.errored;
}

function doWrite(
  stream: WritableImplementation,
  state: WritableState,
  length: number,
  chunk: unknown,
  encoding: string | undefined,
  callback: WriteCallback,
): void {
  state.writelen = length;
  if (callback !== nop) state.writecb = callback;
  state.writing = true;
  state.sync = true;
  state.expectWriteCb = true;

  if (state.destroyed) {
    state.onwrite(new ERR_STREAM_DESTROYED("write"));
  } else {
    stream._write(chunk, encoding, state.onwrite);
  }

  state.sync = false;
}

function doWritev(
  stream: WritableImplementation,
  state: WritableState,
  length: number,
  chunks: BufferedWrite[],
  callback: WriteCallback,
): void {
  state.writelen = length;
  if (callback !== nop) state.writecb = callback;
  state.writing = true;
  state.sync = true;
  state.expectWriteCb = true;

  if (state.destroyed) {
    state.onwrite(new ERR_STREAM_DESTROYED("write"));
  } else if (stream._writev !== null) {
    stream._writev(chunks, state.onwrite);
  } else {
    state.onwrite(new ERR_METHOD_NOT_IMPLEMENTED("_writev()"));
  }

  state.sync = false;
}

function onwriteError(
  stream: WritableImplementation,
  state: WritableState,
  error: unknown,
  callback: WriteCallback,
): void {
  --state.pendingcb;

  // This chunk's own callback first; then everything still queued, which
  // failed for a different reason -- the stream is gone -- and must not be
  // told this chunk's error as though it were theirs.
  callback(error);
  errorBuffer(state);
  errorOrDestroy(stream, error);
}

/** The callback a stream's `_write` calls when it is done with a chunk. */
function onwrite(stream: WritableImplementation, error?: unknown): void {
  const state = stream._writableState;

  if (!state.expectWriteCb) {
    errorOrDestroy(stream, new ERR_MULTIPLE_CALLBACK());
    return;
  }

  const sync = state.sync;
  const callback = state.writecb ?? nop;

  state.writecb = null;
  state.writing = false;
  state.expectWriteCb = false;
  state.length -= state.writelen;
  state.writelen = 0;

  if (error) {
    if (error instanceof Error) void error.stack;

    if (!state.errored) state.errored = error;

    // A duplex's readable side has to learn about it too, or a consumer
    // reading from it waits for data that will never come.
    const rState = stream._readableState;
    if (rState && !rState.errored) rState.errored = error;

    // Deferred when `_write` failed synchronously, so that the failure never
    // reaches the caller before `write` has returned.
    if (sync) {
      nextTick(onwriteError, stream, state, error, callback);
    } else {
      onwriteError(stream, state, error, callback);
    }
    return;
  }

  if (state.buffered.length > state.bufferedIndex) {
    clearBuffer(stream, state);
  }

  if (!sync) {
    afterWrite(stream, state, 1, callback);
    return;
  }

  const needDrain = state.needDrain && state.length === 0;
  const needTick = needDrain || state.destroyed || callback !== nop;

  // A stream written to in a loop usually passes the same callback, or none.
  // Scheduling one tick per chunk would then be one allocation per chunk for
  // no gain, so identical consecutive callbacks are counted and run together.
  if (callback === nop) {
    if (!state.afterWritePending && needTick) {
      nextTick(afterWrite, stream, state, 1, callback);
      state.afterWritePending = true;
    } else {
      state.pendingcb--;
      if (state.ending) finishMaybe(stream, state, true);
    }
  } else if (state.afterWriteTickInfo && state.afterWriteTickInfo.callback === callback) {
    state.afterWriteTickInfo.count++;
  } else if (needTick) {
    const info: AfterWriteTickInfo = { stream, state, count: 1, callback };
    state.afterWriteTickInfo = info;
    nextTick(afterWriteTick, info);
    state.afterWritePending = true;
  } else {
    state.pendingcb--;
    if (state.ending) finishMaybe(stream, state, true);
  }
}

function afterWriteTick(info: AfterWriteTickInfo): void {
  const { stream, state } = info;
  if (state.afterWriteTickInfo === info) state.afterWriteTickInfo = null;
  afterWrite(stream, state, info.count, info.callback);
}

function afterWrite(
  stream: WritableImplementation,
  state: WritableState,
  count: number,
  callback: WriteCallback,
): void {
  state.afterWritePending = false;

  // `drain` only for a stream that is still open: telling a producer it may
  // write more, on a stream that is ending, would be an invitation to a
  // `write after end`.
  const needDrain = state.needDrain && !state.ending && !state.destroyed && state.length === 0;
  if (needDrain) {
    state.needDrain = false;
    stream.emit("drain");
  }

  while (count-- > 0) {
    state.pendingcb--;
    callback(null);
  }

  if (state.destroyed) errorBuffer(state);

  if (state.ending) finishMaybe(stream, state, true);
}

/**
 * Tell everything still queued that it will not be written.
 *
 * Each buffered chunk has a callback that somebody is waiting on. A destroyed
 * stream that dropped them would leave those callers waiting forever, which is
 * the shape of hang that is hardest to find.
 */
export function errorBuffer(state: WritableState): void {
  if (state.writing) return;

  for (let n = state.bufferedIndex; n < state.buffered.length; ++n) {
    const entry = bufferedWriteAt(state.buffered, n);
    const length = state.objectMode ? 1 : chunkLength(entry.chunk);
    state.length -= length;
    entry.callback(state.errored ?? new ERR_STREAM_DESTROYED("write"));
  }

  callFinishedCallbacks(state, state.errored ?? new ERR_STREAM_DESTROYED("end"));

  resetBuffer(state);
}

/** Hand the buffer to `_write`, in batches if the stream can take them. */
export function clearBuffer(
  stream: WritableImplementation,
  state: WritableState,
): void {
  if (
    state.destroyed ||
    state.bufferProcessing ||
    state.corked ||
    !state.constructed ||
    state.buffered.length === 0
  ) {
    return;
  }

  const buffered = state.buffered;
  const bufferedLength = buffered.length - state.bufferedIndex;
  if (!bufferedLength) return;

  let i = state.bufferedIndex;
  state.bufferProcessing = true;

  if (bufferedLength > 1 && stream._writev !== null) {
    // One `_writev` replaces N `_write`s and therefore N-1 callbacks.
    state.pendingcb -= bufferedLength - 1;

    const callback: WriteCallback = state.allNoop
      ? nop
      : (error) => {
        for (let n = i; n < buffered.length; ++n) {
          bufferedWriteAt(buffered, n).callback(error);
        }
      };

    // Copied when the callback above will read it, because `doWrite` hands
    // the array to the stream and `resetBuffer` replaces it underneath.
    const chunks = state.allNoop && i === 0 ? buffered : buffered.slice(i);

    doWritev(stream, state, state.length, chunks, callback);
    resetBuffer(state);
  } else {
    // One at a time, stopping as soon as a write does not complete
    // synchronously -- the rest wait for its callback.
    do {
      const entry = bufferedWriteAt(buffered, i++);
      const length = state.objectMode ? 1 : chunkLength(entry.chunk);
      doWrite(stream, state, length, entry.chunk, entry.encoding, entry.callback);
    } while (i < buffered.length && !state.writing);

    if (i === buffered.length) {
      resetBuffer(state);
    } else if (i > 256) {
      // Compacting costs a copy, so it is worth doing only once the dead
      // prefix is large. Below that the index alone is cheaper.
      buffered.splice(0, i);
      state.bufferedIndex = 0;
    } else {
      state.bufferedIndex = i;
    }
  }

  state.bufferProcessing = false;
}

/** Everything that has to be true before `finish` can be emitted. */
function needFinish(state: WritableState): boolean {
  return (
    state.ending &&
    state.constructed &&
    !state.destroyed &&
    !state.finished &&
    !state.writing &&
    !state.errorEmitted &&
    !state.closeEmitted &&
    !state.errored &&
    state.buffered.length === 0 &&
    state.length === 0
  );
}

function onFinish(stream: WritableImplementation, state: WritableState, error?: unknown): void {
  if (state.prefinished) {
    errorOrDestroy(stream, error ?? new ERR_MULTIPLE_CALLBACK());
    return;
  }

  state.pendingcb--;

  if (error) {
    callFinishedCallbacks(state, error);
    errorOrDestroy(stream, error, state.sync);
  } else if (needFinish(state)) {
    state.prefinished = true;
    stream.emit("prefinish");
    // On a tick regardless of whether `_final` called back synchronously:
    // streams in the wild assume `finish` is asynchronous relative to it.
    state.pendingcb++;
    nextTick(finish, stream, state);
  }
}

/**
 * Give the stream its last chance to write something.
 *
 * `_final` is where a stream flushes a trailer, closes a file descriptor, or
 * writes a footer -- work that has to happen after the last chunk and before
 * `finish`.
 */
function prefinish(stream: WritableImplementation, state: WritableState): void {
  if (state.prefinished || state.finalCalled) return;

  if (typeof stream._final === "function" && !state.destroyed) {
    state.finalCalled = true;
    state.sync = true;
    state.pendingcb++;
    try {
      stream._final((error) => onFinish(stream, state, error));
    } catch (thrown) {
      onFinish(stream, state, thrown);
    }
    state.sync = false;
  } else {
    state.finalCalled = true;
    state.prefinished = true;
    stream.emit("prefinish");
  }
}

export function finishMaybe(
  stream: WritableImplementation,
  state: WritableState,
  sync?: boolean,
): void {
  if (!needFinish(state)) return;

  prefinish(stream, state);

  if (state.pendingcb !== 0) return;

  if (sync) {
    state.pendingcb++;
    nextTick(() => {
      // Re-checked on the tick: a callback that ran in between may have
      // written more, and finishing then would cut it off.
      if (needFinish(state)) finish(stream, state);
      else state.pendingcb--;
    });
  } else if (needFinish(state)) {
    state.pendingcb++;
    finish(stream, state);
  }
}

function finish(stream: WritableImplementation, state: WritableState): void {
  state.pendingcb--;
  state.finished = true;

  callFinishedCallbacks(state, null);
  stream.emit("finish");

  if (state.autoDestroy) {
    // A duplex is only finished when its readable side is too. A readable
    // side explicitly disabled at construction will never emit `end`, and
    // waiting for it would leave the stream open forever.
    const rState = stream._readableState;
    const bothDone =
      !rState || (rState.autoDestroy && (rState.endEmitted || rState.readable === false));
    if (bothDone) stream.destroy();
  }
}

function callFinishedCallbacks(state: WritableState, error: unknown): void {
  const callbacks = state.onfinishCallbacks;
  if (!callbacks) return;
  state.onfinishCallbacks = null;
  for (let i = 0; i < callbacks.length; i++) {
    callbackAt(callbacks, i)(error);
  }
}
