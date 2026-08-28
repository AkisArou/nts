// The readable half, from node v24.20.0 `lib/internal/streams/readable.js`.
//
// A `Readable` has two modes and the whole design follows from having both.
//
// In **paused** mode the consumer asks: `read()` returns a chunk or `null`,
// and `readable` says there is something to ask for. In **flowing** mode the
// stream pushes: `data` is emitted as fast as chunks arrive. A stream starts
// paused and switches to flowing the moment someone adds a `data` listener or
// calls `resume` or `pipe` -- which means adding a listener changes the
// stream's behaviour, and that is the single most surprising thing about
// streams.
//
// Between the two sits the buffer and `_read`. The stream asks its source for
// more when the buffer is below the high water mark, and stops asking when it
// is not; that is the whole of the flow control, and `push` returning `false`
// is how the source is told.
//
// The state is plain named fields rather than node's packed bitfield, for the
// reason set out at the top of `writable.ts`.

import { Buffer } from "../../buffer/src/main.ts";
import { StringDecoder } from "../../string_decoder/src/main.ts";
import { validateObject } from "../../internal/validators.ts";
import {
  aggregateTwoErrors,
  AbortError,
  ERR_INVALID_ARG_TYPE,
  ERR_METHOD_NOT_IMPLEMENTED,
  ERR_OUT_OF_RANGE,
  ERR_STREAM_PUSH_AFTER_EOF,
  ERR_STREAM_UNSHIFT_AFTER_END_EVENT,
  ERR_UNKNOWN_ENCODING,
} from "../../internal/errors.ts";
import { nextTick } from "../../internal/tick.ts";
import { Stream, prependListener } from "./legacy.ts";
import type { Listener } from "../../events/src/main.ts";
import { getDefaultHighWaterMark, getHighWaterMark } from "./state.ts";
import { construct, destroy, destroyer, errorOrDestroy, undestroy } from "./destroy.ts";
import type { DestroyableStream } from "./destroy.ts";
import { addAbortSignalNoValidate } from "./add-abort-signal.ts";
import { eos } from "./end-of-stream.ts";
import type { AbortSignalLike } from "./end-of-stream.ts";

import type { PipeDestination } from "./legacy.ts";

/** The shape `pipe` writes into. Shared with the legacy `pipe`. */
type PipeTarget = PipeDestination;

export interface ReadableOptions {
  objectMode?: boolean | undefined;
  readableObjectMode?: boolean | undefined;
  highWaterMark?: number | null | undefined;
  readableHighWaterMark?: number | null | undefined;
  encoding?: string | undefined;
  defaultEncoding?: string | undefined;
  emitClose?: boolean | undefined;
  autoDestroy?: boolean | undefined;
  signal?: AbortSignalLike | undefined;
  // `this` is the stream, so a `read()` written inline in the options can
  // call `this.push`. That is the idiom `Readable.from` and half of node's
  // own tests use.
  read?: (this: Readable, size: number) => void;
  destroy?: (error: unknown, callback: (error?: unknown) => void) => void;
  construct?: (callback: (error?: unknown) => void) => void;
}

export class ReadableState {
  objectMode: boolean;
  highWaterMark: number;
  emitClose: boolean;
  autoDestroy: boolean;
  defaultEncoding = "utf8";

  /** Chunks waiting to be read, and how far through them we are. */
  buffer: unknown[] = [];
  bufferIndex = 0;
  length = 0;
  pipes: PipeTarget[] = [];

  /**
   * Destinations that told us to wait.
   *
   * One writer while there is one pipe, a `Set` once there are several --
   * because a `Set` per stream is a real cost and almost every pipe has
   * exactly one destination.
   */
  awaitDrainWriters: PipeTarget | Set<PipeTarget> | null = null;
  multiAwaitDrain = false;

  decoder: StringDecoder | null = null;
  encoding: string | null = null;

  /** A `_read` is outstanding: do not ask again until it pushes. */
  reading = false;
  /** Inside a `_read`, so a push must not re-enter the read path. */
  sync = true;
  constructed = true;
  /** `push(null)` has happened. */
  ended = false;
  /** `end` has been emitted. */
  endEmitted = false;
  /** Nobody has asked and we should tell them when there is something. */
  needReadable = false;
  emittedReadable = false;
  readableListening = false;
  dataListening = false;
  dataEmitted = false;
  resumeScheduled = false;
  readingMore = false;

  /**
   * Flowing has three values, not two.
   *
   * `null` -- expressed here as `hasFlowing === false` -- means no one has
   * decided yet, which is different from paused: a stream that has never been
   * read is waiting, and a stream that was explicitly paused is refusing.
   */
  flowing = false;
  hasFlowing = false;
  paused = false;
  hasPaused = false;

  destroyed = false;
  closed = false;
  closeEmitted = false;
  errored: unknown = null;
  errorEmitted = false;
  /** Whether the readable side was disabled at construction, for a duplex. */
  readable?: boolean;

  constructor(options: ReadableOptions | undefined, _stream: Readable, isDuplex: boolean) {
    this.objectMode = Boolean(options?.objectMode) ||
      (isDuplex && Boolean(options?.readableObjectMode));

    // Zero means "never read ahead", which the REPL wants: it should ask the
    // source for data only when something is actually waiting for it.
    this.highWaterMark = options
      ? getHighWaterMark(this, options, "readableHighWaterMark", isDuplex)
      : getDefaultHighWaterMark(false);

    this.emitClose = !options || options.emitClose !== false;
    this.autoDestroy = !options || options.autoDestroy !== false;

    const encoding = options?.defaultEncoding;
    if (encoding == null || encoding === "utf8" || encoding === "utf-8") {
      this.defaultEncoding = "utf8";
    } else if (Buffer.isEncoding(encoding)) {
      this.defaultEncoding = encoding;
    } else {
      throw new ERR_UNKNOWN_ENCODING(encoding);
    }

    if (options?.encoding) {
      this.decoder = new StringDecoder(options.encoding);
      this.encoding = options.encoding;
    }
  }
}

// A stream asked for more than a gigabyte at once is a stream whose caller has
// made a mistake, and growing the mark to match would turn it into an
// allocation failure much later.
const MAX_HIGH_WATER_MARK = 0x4000_0000;

/**
 * Round a requested size up to the next power of two.
 *
 * Called when a `read(n)` asks for more than the current mark. Growing to
 * exactly `n` would mean regrowing on the next slightly larger request; the
 * doubling keeps that to a logarithmic number of times.
 */
function computeNewHighWaterMark(n: number): number {
  if (n > MAX_HIGH_WATER_MARK) {
    throw new ERR_OUT_OF_RANGE("size", "<= 1GiB", n);
  }
  n--;
  n |= n >>> 1;
  n |= n >>> 2;
  n |= n >>> 4;
  n |= n >>> 8;
  n |= n >>> 16;
  n++;
  return n;
}

/** How much `read(n)` can actually return right now. */
function howMuchToRead(n: number, state: ReadableState): number {
  if (n <= 0 || (state.length === 0 && state.ended)) return 0;
  if (state.objectMode) return 1;
  if (Number.isNaN(n)) {
    // `read()` with no argument. In flowing mode one chunk at a time, so that
    // each `data` event is one chunk as it arrived rather than a concatenation
    // of everything buffered.
    if (state.flowing && state.length) {
      return (state.buffer[state.bufferIndex] as { length: number }).length;
    }
    return state.length;
  }
  if (n <= state.length) return n;
  // More than is buffered: only answer if there will never be more.
  return state.ended ? state.length : 0;
}

export class Readable extends Stream {
  _readableState: ReadableState;
  _construct?: (callback: (error?: unknown) => void) => void;

  constructor(options?: ReadableOptions) {
    super();
    this._readableState = new ReadableState(options, this, false);

    if (options) {
      if (typeof options.read === "function") this._read = options.read;
      if (typeof options.destroy === "function") this._destroy = options.destroy as never;
      if (typeof options.construct === "function") this._construct = options.construct;
      if (options.signal) addAbortSignalNoValidate(options.signal, this);
    }

    if (this._construct != null) {
      construct(this as unknown as DestroyableStream, () => onReadableConstructed(this));
    }
  }

  destroy(error?: unknown, callback?: (error?: unknown) => void): this {
    destroy.call(this as unknown as DestroyableStream, error, callback);
    return this;
  }

  _undestroy = undestroy;

  _destroy(error: unknown, callback: (error?: unknown) => void): void {
    callback(error);
  }

  /**
   * Hand a chunk to the stream, from the source.
   *
   * `push(null)` is end-of-stream, which is why writing `null` to a
   * `Writable` is an error: the two halves disagree about what `null` means
   * and only one of them can be right.
   *
   * Returns whether the source should keep going. It is advice, like
   * `write`'s return value, and a source that ignores it just buffers.
   */
  push(chunk: unknown, encoding?: string): boolean {
    const state = this._readableState;
    return state.objectMode
      ? addChunkPushObjectMode(this, state, chunk, encoding)
      : addChunkPushByteMode(this, state, chunk, encoding);
  }

  /**
   * Put a chunk back at the front.
   *
   * Meant for a consumer that read more than it needed -- a parser that has to
   * look at a header before deciding how much of the body belongs to it. What
   * goes back should be what came out of `read`.
   */
  unshift(chunk: unknown, encoding?: string): boolean {
    const state = this._readableState;
    return state.objectMode
      ? addChunkUnshiftObjectMode(this, state, chunk)
      : addChunkUnshiftByteMode(this, state, chunk, encoding);
  }

  isPaused(): boolean {
    const state = this._readableState;
    return state.paused || (state.hasFlowing && !state.flowing);
  }

  /**
   * Deliver strings in `encoding` rather than buffers.
   *
   * The decoder holds any bytes that end mid-character, so a multi-byte
   * character split across two chunks arrives whole. That is the entire
   * reason this exists rather than the caller calling `toString`.
   */
  setEncoding(encoding: string): this {
    const state = this._readableState;
    const decoder = new StringDecoder(encoding);
    state.decoder = decoder;
    // `setEncoding(null)` gives a decoder whose encoding is utf8.
    state.encoding = decoder.encoding;

    // Whatever is already buffered has to be converted too, or the consumer
    // would get buffers followed by strings.
    let content = "";
    for (const data of state.buffer.slice(state.bufferIndex)) {
      content += decoder.write(data as never);
    }
    if (state.ended) content += decoder.end();

    state.buffer.length = 0;
    state.bufferIndex = 0;
    if (content !== "") state.buffer.push(content);
    state.length = content.length;
    return this;
  }

  read(n?: number): unknown {
    let size = n === undefined ? NaN : (Number.isInteger(n) ? n : Number.parseInt(n as unknown as string, 10));
    const state = this._readableState;
    const requested = size;

    // Asking for more than the mark raises it: a consumer that wants big
    // chunks should not be fed small ones forever.
    if (size > state.highWaterMark) {
      state.highWaterMark = computeNewHighWaterMark(size);
    }

    if (size !== 0) state.emittedReadable = false;

    // `read(0)` is the idiom for "tell me when there is something", and if
    // there already is, the answer is now.
    const buffered = state.length;
    if (
      size === 0 &&
      state.needReadable &&
      ((state.highWaterMark !== 0 ? buffered >= state.highWaterMark : buffered > 0) || state.ended)
    ) {
      if (buffered === 0 && state.ended) endReadable(this);
      else emitReadable(this);
      return null;
    }

    size = howMuchToRead(size, state);

    if (size === 0 && state.ended) {
      if (state.length === 0) endReadable(this);
      return null;
    }

    // The order below matters and is not obvious. `_read` may be entirely
    // synchronous -- a `PassThrough` is -- so it can change the buffer under
    // us. Everything is therefore decided *before* `_read` and re-decided
    // after, rather than read out of the buffer first.
    let doRead = state.needReadable;
    if (state.length === 0 || state.length - size < state.highWaterMark) {
      doRead = true;
    }

    if (state.reading || state.ended || state.destroyed || state.errored || !state.constructed) {
      doRead = false;
    } else if (doRead) {
      state.reading = true;
      state.sync = true;
      if (state.length === 0) state.needReadable = true;

      try {
        this._read(state.highWaterMark);
      } catch (error) {
        errorOrDestroy(this as unknown as DestroyableStream, error);
      }

      state.sync = false;

      // A synchronous push cleared `reading`, and there may now be enough.
      if (!state.reading) size = howMuchToRead(requested, state);
    }

    let ret: unknown = size > 0 ? fromList(size, state) : null;

    if (ret === null) {
      state.needReadable = state.length <= state.highWaterMark;
      size = 0;
    } else {
      state.length -= size;
      clearAwaitDrain(state);
    }

    if (state.length === 0) {
      if (!state.ended) state.needReadable = true;
      // Read past the end: nothing more is coming.
      if (requested !== size && state.ended) endReadable(this);
    }

    if (ret !== null && !state.errorEmitted && !state.closeEmitted) {
      state.dataEmitted = true;
      this.emit("data", ret);
    }

    return ret;
  }

  /**
   * Ask the source for more. A subclass must provide one.
   *
   * The argument is advisory: a stream may push more or less, and pushing
   * nothing is legal as long as it eventually pushes something or ends.
   */
  _read(_size: number): void {
    throw new ERR_METHOD_NOT_IMPLEMENTED("_read()");
  }

  override pipe<T extends PipeTarget>(destination: T, options?: { end?: boolean }): T {
    const source = this;
    const state = this._readableState;

    // A second destination means the single-writer optimisation no longer
    // holds; upgrade to a set, carrying the existing writer across.
    if (state.pipes.length === 1 && !state.multiAwaitDrain) {
      state.multiAwaitDrain = true;
      state.awaitDrainWriters = new Set<PipeTarget>(
        state.awaitDrainWriters ? [state.awaitDrainWriters as PipeTarget] : [],
      );
    }

    state.pipes.push(destination);

    // `process.stdout` and `process.stderr` are never ended by a pipe: they
    // outlive whatever was piped into them, and closing them would take the
    // program's output with it.
    const globalProcess = (globalThis as { process?: { stdout?: unknown; stderr?: unknown } })
      .process;
    const shouldEnd =
      (!options || options.end !== false) &&
      (destination as unknown) !== globalProcess?.stdout &&
      (destination as unknown) !== globalProcess?.stderr;

    const onSourceEnd = shouldEnd ? onEnd : unpipe;
    if (state.endEmitted) nextTick(onSourceEnd);
    else source.once("end", onSourceEnd);

    destination.on("unpipe", onUnpipe as never);
    function onUnpipe(readable: unknown, info?: { hasUnpiped: boolean }): void {
      if (readable === source && info && info.hasUnpiped === false) {
        info.hasUnpiped = true;
        cleanup();
      }
    }

    function onEnd(): void {
      destination.end?.();
    }

    let onDrain: (() => void) | undefined;
    let cleanedUp = false;

    function cleanup(): void {
      destination.removeListener("close", onClose);
      destination.removeListener("finish", onFinish);
      if (onDrain) destination.removeListener("drain", onDrain);
      destination.removeListener("error", onError as never);
      destination.removeListener("unpipe", onUnpipe as never);
      source.removeListener("end", onEnd);
      source.removeListener("end", unpipe);
      source.removeListener("data", onData as never);

      cleanedUp = true;

      // If the source is waiting on this destination's drain, that drain will
      // now never come, and the source would stay paused forever.
      if (
        onDrain &&
        state.awaitDrainWriters &&
        (!destination._writableState || destination._writableState.needDrain)
      ) {
        onDrain();
      }
    }

    function pause(): void {
      // The destination may have been unpiped from inside its own `write`,
      // in which case pausing for it would strand the source.
      if (!cleanedUp) {
        if (state.pipes.length === 1 && state.pipes[0] === destination) {
          state.awaitDrainWriters = destination;
          state.multiAwaitDrain = false;
        } else if (state.pipes.length > 1 && state.pipes.includes(destination)) {
          (state.awaitDrainWriters as Set<PipeTarget>).add(destination);
        }
        source.pause();
      }
      if (!onDrain) {
        // Attached once and left, rather than a `once` per chunk: adding and
        // removing a listener per write costs more than the pipe does.
        onDrain = pipeOnDrain(source, destination);
        destination.on("drain", onDrain);
      }
    }

    source.on("data", onData as never);
    function onData(chunk: unknown): void {
      try {
        if (destination.write(chunk) === false) pause();
      } catch (error) {
        destination.destroy?.(error);
      }
    }

    function onError(error: unknown): void {
      unpipe();
      destination.removeListener("error", onError as never);
      if (destination.listenerCount?.("error") === 0) {
        const s = destination._writableState || destination._readableState;
        if (s && !s.errorEmitted) {
          // The program emitted `error` on the stream itself rather than
          // failing it, so route it through the normal failure path.
          errorOrDestroy(destination as unknown as DestroyableStream, error);
        } else {
          destination.emit("error", error);
        }
      }
    }

    // Before any of the program's handlers, so the pipe is torn down even if
    // one of theirs rethrows.
    prependListener(destination as never, "error", onError as never);

    function onClose(): void {
      destination.removeListener("finish", onFinish);
      unpipe();
    }
    destination.once?.("close", onClose);

    function onFinish(): void {
      destination.removeListener("close", onClose);
      unpipe();
    }
    destination.once?.("finish", onFinish);

    function unpipe(): void {
      source.unpipe(destination);
    }

    destination.emit("pipe", source);

    // A destination that is already full starts the pipe paused, or the first
    // chunk would be written into a stream that has asked for a pause.
    if (destination.writableNeedDrain === true) {
      pause();
    } else if (!state.flowing) {
      source.resume();
    }

    return destination;
  }

  unpipe(destination?: PipeTarget): this {
    const state = this._readableState;
    if (state.pipes.length === 0) return this;

    if (!destination) {
      const all = state.pipes;
      state.pipes = [];
      this.pause();
      for (let i = 0; i < all.length; i++) {
        (all[i] as PipeTarget).emit("unpipe", this, { hasUnpiped: false });
      }
      return this;
    }

    const index = state.pipes.indexOf(destination);
    if (index === -1) return this;

    state.pipes.splice(index, 1);
    if (state.pipes.length === 0) this.pause();

    destination.emit("unpipe", this, { hasUnpiped: false });
    return this;
  }

  /**
   * Adding a listener can start the stream.
   *
   * This is where paused becomes flowing. A `data` listener means somebody
   * wants chunks pushed at them, so the stream starts; a `readable` listener
   * means the opposite, so it stops. Both are the documented behaviour and
   * both surprise people.
   */
  override on(event: string | symbol, listener: Listener): this {
    const result = super.on(event, listener);
    const state = this._readableState;

    if (event === "data") {
      state.dataListening = true;
      // Recomputed here so that the `resume` below is a no-op when someone is
      // also listening for `readable`, which supports `once('readable')`.
      state.readableListening = this.listenerCount("readable") > 0;

      // Unless the stream was explicitly paused, in which case the program
      // has said what it wants and adding a listener does not override it.
      if (!(state.hasFlowing && !state.flowing)) this.resume();
    } else if (event === "readable") {
      if (!state.endEmitted && !state.readableListening) {
        state.readableListening = true;
        state.needReadable = true;
        state.hasFlowing = true;
        state.flowing = false;
        state.emittedReadable = false;
        if (state.length) {
          emitReadable(this);
        } else if (!state.reading) {
          nextTick(readZero, this);
        }
      }
    }

    return result as this;
  }

  override addListener(event: string | symbol, listener: Listener): this {
    return this.on(event, listener);
  }

  override removeListener(event: string | symbol, listener: Listener): this {
    const result = super.removeListener(event, listener);
    const state = this._readableState;

    if (event === "readable") {
      // On a tick, so that a `once('readable', ...)` cycle -- where the
      // listener is removed as it runs -- does not look like nobody is
      // listening while the handler is still going.
      nextTick(updateReadableListening, this);
    } else if (event === "data" && this.listenerCount("data") === 0) {
      state.dataListening = false;
    }

    return result as this;
  }

  override off(event: string | symbol, listener: Listener): this {
    return this.removeListener(event, listener);
  }

  override removeAllListeners(event?: string | symbol): this {
    const result = super.removeAllListeners(event);
    if (event === "readable" || event === undefined) {
      nextTick(updateReadableListening, this);
    }
    return result as this;
  }

  /** Start flowing: chunks will be pushed at `data` listeners. */
  resume(): this {
    const state = this._readableState;
    if (!state.flowing) {
      state.hasFlowing = true;
      // Not actually flowing while somebody is listening for `readable`:
      // that consumer pulls, and pushing at it as well would deliver each
      // chunk twice.
      state.flowing = !state.readableListening;
      resume(this, state);
    }
    state.hasPaused = true;
    state.paused = false;
    return this;
  }

  pause(): this {
    const state = this._readableState;
    if (!(state.hasFlowing && !state.flowing)) {
      state.hasFlowing = true;
      state.flowing = false;
      this.emit("pause");
    }
    state.hasPaused = true;
    state.paused = true;
    return this;
  }

  get readable(): boolean {
    const r = this._readableState;
    return !!r && r.readable !== false && !r.destroyed && !r.errorEmitted && !r.endEmitted;
  }

  set readable(value: boolean) {
    if (this._readableState) this._readableState.readable = Boolean(value);
  }

  get readableDidRead(): boolean {
    return this._readableState.dataEmitted;
  }

  get readableAborted(): boolean {
    const state = this._readableState;
    return Boolean(state.destroyed || state.errored) && !state.endEmitted;
  }

  get readableHighWaterMark(): number {
    return this._readableState.highWaterMark;
  }

  get readableBuffer(): unknown[] {
    return this._readableState.buffer.slice(this._readableState.bufferIndex);
  }

  get readableFlowing(): boolean | null {
    return this._readableState.hasFlowing ? this._readableState.flowing : null;
  }

  set readableFlowing(value: boolean | null) {
    if (this._readableState) {
      this._readableState.hasFlowing = value !== null;
      this._readableState.flowing = Boolean(value);
    }
  }

  get readableLength(): number {
    return this._readableState.length;
  }

  get readableObjectMode(): boolean {
    return this._readableState ? this._readableState.objectMode : false;
  }

  get readableEncoding(): string | null {
    return this._readableState ? this._readableState.encoding : null;
  }

  get errored(): unknown {
    return this._readableState ? this._readableState.errored : null;
  }

  get closed(): boolean {
    return this._readableState ? this._readableState.closed : false;
  }

  get destroyed(): boolean {
    return this._readableState ? this._readableState.destroyed : false;
  }

  set destroyed(value: boolean) {
    if (this._readableState) this._readableState.destroyed = value;
  }

  get readableEnded(): boolean {
    return this._readableState ? this._readableState.endEmitted : false;
  }

  /**
   * `for await (const chunk of stream)`.
   *
   * The bridge back from streams to iterators: `readable` wakes the loop,
   * `read()` supplies the value, and end-of-stream ends the iteration or
   * throws. The consumer's `await` between chunks is what applies
   * backpressure -- the stream is not read again until the body returns.
   */
  [Symbol.asyncIterator](): AsyncGenerator<unknown, void, void> {
    return streamToAsyncIterator(this);
  }

  /**
   * The same, with control over what happens when the loop is left early.
   *
   * `destroyOnReturn: false` keeps the stream alive after a `break`, which is
   * what a caller reading a header and then handing the stream on wants.
   * Destroying is the default because abandoning a stream without closing it
   * is the more common mistake.
   */
  iterator(options?: { destroyOnReturn?: boolean }): AsyncGenerator<unknown, void, void> {
    if (options !== undefined) validateObject(options, "options");
    return streamToAsyncIterator(this, options);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    let error: unknown;
    if (!this.destroyed) {
      error = this.readableEnded ? null : new AbortError();
      this.destroy(error);
    }
    await new Promise<void>((resolve, reject) =>
      eos(this, (err) => (err && err !== error ? reject(err) : resolve()))
    );
  }
}

/**
 * What the readable side has to do once `_construct` has finished.
 *
 * A consumer that asked for data while the stream was still opening is
 * waiting; this is where that request finally reaches the source.
 */
export function onReadableConstructed(stream: Readable): void {
  const state = stream._readableState;
  if (state.needReadable) maybeReadMore(stream, state);
}

function streamToAsyncIterator(
  stream: Readable,
  options?: { destroyOnReturn?: boolean },
): AsyncGenerator<unknown, void, void> {
  return createAsyncIterator(stream, options);
}

async function* createAsyncIterator(
  stream: Readable,
  options?: { destroyOnReturn?: boolean },
): AsyncGenerator<unknown, void, void> {
  const nop = (): void => {};
  let wake: () => void = nop;

  // Doubles as the `readable` listener and as the promise executor. Called
  // with the stream as `this` it is the event, and releases whoever is
  // waiting; called by `new Promise` it is the executor, and records who to
  // release. One function because the two must not race.
  function next(this: unknown, resolve?: () => void): void {
    if (this === stream) {
      wake();
      wake = nop;
    } else if (resolve) {
      wake = resolve;
    }
  }

  stream.on("readable", next as never);

  // `undefined` means not finished; `null` means finished cleanly.
  let error: unknown;
  const cleanup = eos(stream, { writable: false }, (err) => {
    error = err ? aggregateTwoErrors(error, err) : null;
    wake();
    wake = nop;
  });

  try {
    for (;;) {
      const chunk = stream.destroyed ? null : stream.read();
      if (chunk !== null) {
        yield chunk;
      } else if (error) {
        throw error;
      } else if (error === null) {
        return;
      } else {
        await new Promise<void>(next as never);
      }
    }
  } catch (thrown) {
    error = aggregateTwoErrors(error, thrown);
    throw error;
  } finally {
    // A half-open duplex still being written to must survive the loop: the
    // reader finishing is not the writer finishing.
    const preserveHalfOpenDuplex =
      error === null &&
      (stream as unknown as { allowHalfOpen?: boolean }).allowHalfOpen === true &&
      (stream as unknown as { writable?: boolean }).writable === true &&
      (stream as unknown as { writableEnded?: boolean }).writableEnded !== true;

    if (
      (error || options?.destroyOnReturn !== false) &&
      (error === undefined || stream._readableState.autoDestroy) &&
      !preserveHalfOpenDuplex
    ) {
      destroyer(stream, null);
    } else {
      stream.off("readable", next as never);
      cleanup();
    }
  }
}

function clearAwaitDrain(state: ReadableState): void {
  if (state.multiAwaitDrain) (state.awaitDrainWriters as Set<PipeTarget>).clear();
  else state.awaitDrainWriters = null;
}

function pipeOnDrain(source: Readable, destination: PipeTarget): () => void {
  return function onPipeDrain(): void {
    const state = source._readableState;

    if (state.awaitDrainWriters === destination) {
      state.awaitDrainWriters = null;
    } else if (state.multiAwaitDrain) {
      (state.awaitDrainWriters as Set<PipeTarget>).delete(destination);
    }

    // Only once *every* destination has drained: resuming while one is still
    // full would write into it again immediately.
    if (
      (!state.awaitDrainWriters || (state.awaitDrainWriters as Set<PipeTarget>).size === 0) &&
      state.dataListening
    ) {
      source.resume();
    }
  };
}

function updateReadableListening(self: Readable): void {
  const state = self._readableState;
  state.readableListening = self.listenerCount("readable") > 0;

  if (state.hasPaused && !state.paused && state.resumeScheduled) {
    // A resume is already on its way and has to find the stream flowing, or
    // it will do nothing.
    state.hasFlowing = true;
    state.flowing = true;
  } else if (state.dataListening) {
    self.resume();
  } else if (!state.readableListening) {
    state.hasFlowing = false;
    state.flowing = false;
  }
}

function readZero(self: Readable): void {
  self.read(0);
}

function resume(stream: Readable, state: ReadableState): void {
  if (!state.resumeScheduled) {
    state.resumeScheduled = true;
    nextTick(resumeNextTick, stream, state);
  }
}

function resumeNextTick(stream: Readable, state: ReadableState): void {
  // A `read(0)` before `resume` is emitted, so that a listener added in the
  // `resume` handler still sees the data that was already buffered.
  if (!state.reading) stream.read(0);

  state.resumeScheduled = false;
  stream.emit("resume");
  flow(stream);
  if (state.flowing && !state.reading) stream.read(0);
}

function flow(stream: Readable): void {
  const state = stream._readableState;
  while (state.flowing && stream.read() !== null);
}

// --- push and unshift ------------------------------------------------------

function addChunkUnshiftByteMode(
  stream: Readable,
  state: ReadableState,
  chunk: unknown,
  encoding?: string,
): boolean {
  if (chunk === null) {
    state.reading = false;
    onEofChunk(stream, state);
    return false;
  }

  if (typeof chunk === "string") {
    encoding ||= state.defaultEncoding;
    if (state.encoding !== encoding) {
      // A decoder is in use, so what goes back onto the buffer has to be a
      // string in *its* encoding, not the one the caller happened to use.
      chunk = state.encoding
        ? Buffer.from(chunk, encoding).toString(state.encoding)
        : Buffer.from(chunk, encoding);
    }
  } else if (ArrayBuffer.isView(chunk)) {
    chunk = Buffer.from(chunk.buffer as ArrayBuffer, chunk.byteOffset, chunk.byteLength);
  } else if (chunk !== undefined && !(chunk instanceof Buffer)) {
    errorOrDestroy(
      stream as unknown as DestroyableStream,
      new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "TypedArray", "DataView"], chunk),
    );
    return false;
  }

  if (!(chunk && (chunk as { length: number }).length > 0)) return canPushMore(state);

  return addChunkUnshiftValue(stream, state, chunk);
}

function addChunkUnshiftObjectMode(
  stream: Readable,
  state: ReadableState,
  chunk: unknown,
): boolean {
  if (chunk === null) {
    state.reading = false;
    onEofChunk(stream, state);
    return false;
  }
  return addChunkUnshiftValue(stream, state, chunk);
}

function addChunkUnshiftValue(stream: Readable, state: ReadableState, chunk: unknown): boolean {
  if (state.endEmitted) {
    // The consumer has already been told the stream is over; putting
    // something back now would be data nobody will ever read.
    errorOrDestroy(stream as unknown as DestroyableStream, new ERR_STREAM_UNSHIFT_AFTER_END_EVENT());
  } else if (state.destroyed || state.errored) {
    return false;
  } else {
    addChunk(stream, state, chunk, true);
  }
  return canPushMore(state);
}

function addChunkPushByteMode(
  stream: Readable,
  state: ReadableState,
  chunk: unknown,
  encoding?: string,
): boolean {
  if (chunk === null) {
    state.reading = false;
    onEofChunk(stream, state);
    return false;
  }

  if (typeof chunk === "string") {
    encoding ||= state.defaultEncoding;
    if (state.encoding !== encoding) {
      chunk = Buffer.from(chunk, encoding);
      encoding = "";
    }
  } else if (chunk instanceof Buffer) {
    encoding = "";
  } else if (ArrayBuffer.isView(chunk)) {
    chunk = Buffer.from(chunk.buffer as ArrayBuffer, chunk.byteOffset, chunk.byteLength);
    encoding = "";
  } else if (chunk !== undefined) {
    errorOrDestroy(
      stream as unknown as DestroyableStream,
      new ERR_INVALID_ARG_TYPE("chunk", ["string", "Buffer", "TypedArray", "DataView"], chunk),
    );
    return false;
  }

  // An empty chunk is not data, but it *is* an answer: the source responded,
  // so the outstanding read is over and another may be started.
  if (!chunk || (chunk as { length: number }).length <= 0) {
    state.reading = false;
    maybeReadMore(stream, state);
    return canPushMore(state);
  }

  if (state.ended) {
    errorOrDestroy(stream as unknown as DestroyableStream, new ERR_STREAM_PUSH_AFTER_EOF());
    return false;
  }
  if (state.destroyed || state.errored) return false;

  state.reading = false;

  if (state.decoder && !encoding) {
    chunk = state.decoder.write(chunk as never);
    if ((chunk as string).length === 0) {
      // Every byte was the start of an incomplete character. Nothing to
      // deliver, but the source should keep going.
      maybeReadMore(stream, state);
      return canPushMore(state);
    }
  }

  addChunk(stream, state, chunk, false);
  return canPushMore(state);
}

function addChunkPushObjectMode(
  stream: Readable,
  state: ReadableState,
  chunk: unknown,
  encoding?: string,
): boolean {
  if (chunk === null) {
    state.reading = false;
    onEofChunk(stream, state);
    return false;
  }

  if (state.ended) {
    errorOrDestroy(stream as unknown as DestroyableStream, new ERR_STREAM_PUSH_AFTER_EOF());
    return false;
  }
  if (state.destroyed || state.errored) return false;

  state.reading = false;
  if (state.decoder && !encoding) chunk = state.decoder.write(chunk as never);

  addChunk(stream, state, chunk, false);
  return canPushMore(state);
}

function canPushMore(state: ReadableState): boolean {
  // The `length === 0` clause is for a high water mark of zero, where the
  // first comparison would always be false and the source would never be
  // asked for anything.
  return !state.ended && (state.length < state.highWaterMark || state.length === 0);
}

function addChunk(
  stream: Readable,
  state: ReadableState,
  chunk: unknown,
  addToFront: boolean,
): void {
  // Straight to the consumer when the stream is flowing, nothing is buffered
  // and we are not inside a `_read` -- buffering it only to emit it on the
  // next turn would add a copy and a delay for nothing.
  if (state.flowing && state.dataListening && !state.sync && state.length === 0) {
    clearAwaitDrain(state);
    state.dataEmitted = true;
    stream.emit("data", chunk);
  } else {
    state.length += state.objectMode ? 1 : (chunk as { length: number }).length;
    if (addToFront) {
      if (state.bufferIndex > 0) {
        // There is a gap at the front from chunks already read, so putting
        // one back costs nothing.
        state.buffer[--state.bufferIndex] = chunk;
      } else {
        state.buffer.unshift(chunk);
      }
    } else {
      state.buffer.push(chunk);
    }

    if (state.needReadable) emitReadable(stream);
  }
  maybeReadMore(stream, state);
}

function onEofChunk(stream: Readable, state: ReadableState): void {
  if (state.ended) return;

  if (state.decoder) {
    // Anything the decoder was holding for a character that never completed.
    const chunk = state.decoder.end();
    if (chunk?.length) {
      state.buffer.push(chunk);
      state.length += state.objectMode ? 1 : chunk.length;
    }
  }
  state.ended = true;

  if (state.sync) {
    // Inside a `_read`: deferred, or emitting now would re-enter `read` from
    // within itself.
    emitReadable(stream);
  } else {
    // Synchronously otherwise. Modules in the ecosystem depend on `readable`
    // arriving in the same turn as the end of the source.
    state.needReadable = false;
    state.emittedReadable = true;
    emitReadableNow(stream);
  }
}

function emitReadable(stream: Readable): void {
  const state = stream._readableState;
  state.needReadable = false;
  if (!state.emittedReadable) {
    state.emittedReadable = true;
    nextTick(emitReadableNow, stream);
  }
}

function emitReadableNow(stream: Readable): void {
  const state = stream._readableState;
  if (!state.destroyed && !state.errored && (state.length || state.ended)) {
    stream.emit("readable");
    state.emittedReadable = false;
  }

  // Another `readable` will be wanted unless the stream is flowing (where the
  // flow takes care of it) or over.
  state.needReadable = !state.flowing && !state.ended && state.length <= state.highWaterMark;
  flow(stream);
}

/**
 * Read ahead, if there is room.
 *
 * The consumer may not ask again for a while, and a stream that only read when
 * asked would never fill its buffer -- so the point of the high water mark
 * would be lost.
 */
function maybeReadMore(stream: Readable, state: ReadableState): void {
  if (!state.readingMore && !state.reading && state.constructed) {
    state.readingMore = true;
    nextTick(maybeReadMoreNow, stream, state);
  }
}

function maybeReadMoreNow(stream: Readable, state: ReadableState): void {
  // Keep asking while there is room, or while flowing with an empty buffer --
  // in flowing mode nothing else will call `read`, so stopping here would
  // stall the stream for a consumer that has just subscribed to `data`.
  while (
    !state.reading &&
    !state.ended &&
    (state.length < state.highWaterMark || (state.flowing && state.length === 0))
  ) {
    const before = state.length;
    stream.read(0);
    // Nothing arrived, so asking again would spin.
    if (before === state.length) break;
  }
  state.readingMore = false;
}

/**
 * Take `n` from the buffer.
 *
 * The cases are worth the length: returning the first chunk whole when it fits
 * exactly, and slicing it when it does not, avoids copying in the common case
 * where a consumer reads chunks the size the source produces them.
 */
function fromList(n: number, state: ReadableState): unknown {
  const total = state.length;
  if (total === 0) return null;

  let idx = state.bufferIndex;
  const buf = state.buffer;
  const len = buf.length;
  let ret: unknown;

  if (state.objectMode) {
    ret = buf[idx];
    buf[idx++] = null;
  } else if (!n || n >= total) {
    // Everything.
    if (state.decoder) {
      ret = "";
      while (idx < len) {
        ret = (ret as string) + (buf[idx] as string);
        buf[idx++] = null;
      }
    } else if (len - idx === 0) {
      ret = Buffer.alloc(0);
    } else if (len - idx === 1) {
      ret = buf[idx];
      buf[idx++] = null;
    } else {
      const out = Buffer.allocUnsafe(total);
      let at = 0;
      while (idx < len) {
        const data = buf[idx] as Buffer;
        out.set(data, at);
        at += data.length;
        buf[idx++] = null;
      }
      ret = out;
    }
  } else {
    const first = buf[idx] as { length: number; slice(a: number, b?: number): unknown };
    const firstLength = first.length;
    if (n < firstLength) {
      // `slice` means the same thing for a Buffer and a string here.
      ret = first.slice(0, n);
      buf[idx] = first.slice(n);
    } else if (n === firstLength) {
      ret = first;
      buf[idx++] = null;
    } else if (state.decoder) {
      ret = "";
      while (idx < len) {
        const str = buf[idx] as string;
        if (n > str.length) {
          ret = (ret as string) + str;
          n -= str.length;
          buf[idx++] = null;
        } else {
          if (n === str.length) {
            ret = (ret as string) + str;
            buf[idx++] = null;
          } else {
            ret = (ret as string) + str.slice(0, n);
            buf[idx] = str.slice(n);
          }
          break;
        }
      }
    } else {
      const out = Buffer.allocUnsafe(n);
      const wanted = n;
      while (idx < len) {
        const data = buf[idx] as Buffer;
        if (n > data.length) {
          out.set(data, wanted - n);
          n -= data.length;
          buf[idx++] = null;
        } else {
          if (n === data.length) {
            out.set(data, wanted - n);
            buf[idx++] = null;
          } else {
            out.set(data.subarray(0, n), wanted - n);
            buf[idx] = data.subarray(n);
          }
          break;
        }
      }
      ret = out;
    }
  }

  if (idx === len) {
    state.buffer.length = 0;
    state.bufferIndex = 0;
  } else if (idx > 1024) {
    // Compact only once the dead prefix is large; below that the index is
    // cheaper than the copy.
    state.buffer.splice(0, idx);
    state.bufferIndex = 0;
  } else {
    state.bufferIndex = idx;
  }

  return ret;
}

function endReadable(stream: Readable): void {
  const state = stream._readableState;
  if (!state.endEmitted) {
    state.ended = true;
    nextTick(endReadableNow, state, stream);
  }
}

function endReadableNow(state: ReadableState, stream: Readable): void {
  // Re-checked: an `unshift` between scheduling this and running it would
  // mean the stream is not over after all.
  if (!state.errored && !state.closeEmitted && !state.endEmitted && state.length === 0) {
    state.endEmitted = true;
    stream.emit("end");

    const duplex = stream as unknown as {
      writable?: boolean;
      allowHalfOpen?: boolean;
      writableEnded?: boolean;
      destroyed?: boolean;
      end(): void;
      _writableState?: { autoDestroy: boolean; finished: boolean; writable?: boolean };
    };

    if (duplex.writable && duplex.allowHalfOpen === false) {
      nextTick(endWritableNow, duplex);
    } else if (state.autoDestroy) {
      // A duplex is finished when both halves are. A writable side explicitly
      // disabled will never emit `finish`, so waiting for it would keep the
      // stream open forever.
      const wState = duplex._writableState;
      const bothDone =
        !wState || (wState.autoDestroy && (wState.finished || wState.writable === false));
      if (bothDone) stream.destroy();
    }
  }
}

function endWritableNow(stream: {
  writable?: boolean;
  writableEnded?: boolean;
  destroyed?: boolean;
  end(): void;
}): void {
  if (stream.writable && !stream.writableEnded && !stream.destroyed) stream.end();
}
