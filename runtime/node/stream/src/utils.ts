// What a stream is, asked from outside, from node v24.20.0
// `lib/internal/streams/utils.js`.
//
// Every predicate here is duck-typed, and that is not laziness. A stream may
// come from `readable-stream` on npm, which is node's own implementation
// published separately and bundled by half the ecosystem; from an older
// version of node; or from a library that wrote its own. `instanceof` answers
// "is it ours", and the question these need to answer is "does it behave like
// one".
//
// The interoperability goes further than tests: the branding symbols are
// registered with `Symbol.for`, so two copies of the stream machinery in one
// process -- node's and a bundled `readable-stream` -- can read each other's
// state. A private symbol would make them strangers.
//
// Three-valued on purpose. `null` means "not a stream, so the question does
// not apply", which is different from `false`, "a stream, and no". A caller
// that collapses them treats a plain object as a finished stream.

/** Loose enough for an object from anywhere. Every field is a maybe. */
export interface StreamLike {
  [key: string | symbol]: unknown;
  _readableState?: StreamState;
  _writableState?: StreamState;
}

/** Event surface shared by every Node-style stream accepted at a boundary. */
export interface NodeStreamLike extends StreamLike {
  on<Args extends unknown[]>(
    event: string | symbol,
    listener: (...args: Args) => unknown,
  ): unknown;
  once<Args extends unknown[]>(
    event: string | symbol,
    listener: (...args: Args) => unknown,
  ): unknown;
  removeListener<Args extends unknown[]>(
    event: string | symbol,
    listener: (...args: Args) => unknown,
  ): unknown;
}

export interface ReadableNodeStreamLike extends NodeStreamLike {
  pipe(destination: unknown, options?: { end?: boolean }): unknown;
  readonly readableObjectMode?: boolean;
  readonly objectMode?: boolean;
  pause?(): unknown;
  resume?(): unknown;
  destroy?(error?: unknown): unknown;
}

export interface WritableNodeStreamLike extends NodeStreamLike {
  readonly writableObjectMode?: boolean;
  write(chunk: unknown, encoding?: string): boolean;
  end(): unknown;
}

export interface ReadableWebStreamLike extends StreamLike {
  pipeThrough(transform: unknown): unknown;
  getReader(): unknown;
  cancel(reason?: unknown): unknown;
}

export interface WritableWebStreamLike extends StreamLike {
  getWriter(): unknown;
  abort(reason?: unknown): unknown;
}

export interface TransformWebStreamLike extends StreamLike {
  readonly readable: unknown;
  readonly writable: unknown;
}

export interface StreamState {
  [key: string]: unknown;
  objectMode?: boolean;
  destroyed?: boolean;
  closed?: boolean;
  ended?: boolean;
  endEmitted?: boolean;
  finished?: boolean;
  errored?: unknown;
  errorEmitted?: boolean;
  autoDestroy?: boolean;
  emitClose?: boolean;
  readable?: boolean;
  writable?: boolean;
  length?: number;
}

// Registered rather than private, so a second copy of this machinery in the
// same process recognises the same brands. See the note above.
export const kIsDestroyed = Symbol.for("nodejs.stream.destroyed");
export const kIsErrored = Symbol.for("nodejs.stream.errored");
export const kIsReadable = Symbol.for("nodejs.stream.readable");
export const kIsWritable = Symbol.for("nodejs.stream.writable");
export const kIsDisturbed = Symbol.for("nodejs.stream.disturbed");

export const kIsClosedPromise = Symbol.for("nodejs.webstream.isClosedPromise");
export const kControllerErrorFunction = Symbol.for("nodejs.webstream.controllerErrorFunction");

/** Run once the stream's `_construct` has finished, if it had one. */
export const kOnConstructed = Symbol("kOnConstructed");

/**
 * A stream's flags, packed into one integer.
 *
 * Nine booleans on an object are nine properties to look up and, in an engine
 * that assigns them in different orders, more than one hidden class. Packing
 * them makes the state one number and each question one mask -- which matters
 * because these are read on every chunk.
 */
export const kState = Symbol("kState");
export const kObjectMode = 1 << 0;
export const kErrorEmitted = 1 << 1;
export const kAutoDestroy = 1 << 2;
export const kEmitClose = 1 << 3;
export const kDestroyed = 1 << 4;
export const kClosed = 1 << 5;
export const kCloseEmitted = 1 << 6;
export const kErrored = 1 << 7;
export const kConstructed = 1 << 8;

const fn = (value: unknown): boolean => typeof value === "function";

function isStreamLike(value: unknown): value is StreamLike {
  return value !== null && typeof value === "object";
}

/**
 * A readable stream of node's kind.
 *
 * `strict` additionally requires `pause` and `resume`, which is what `pipe`
 * needs and what an object claiming only to emit `data` may not have.
 *
 * The last two clauses are about duplexes. A `Writable` has `pipe` inherited
 * from the legacy base, so `pipe` alone does not make a stream readable; and a
 * duplex whose readable side has been shut down is not readable even though it
 * still has the methods.
 */
export function isReadableNodeStream(
  obj: unknown,
  strict = false,
): obj is ReadableNodeStreamLike {
  if (!isStreamLike(obj)) return false;
  const s = obj;
  return !!(
    s &&
    fn(s["pipe"]) &&
    fn(s["on"]) &&
    (!strict || (fn(s["pause"]) && fn(s["resume"]))) &&
    (!s._writableState || s._readableState?.readable !== false) &&
    (!s._writableState || s._readableState)
  );
}

export function isWritableNodeStream(obj: unknown): obj is WritableNodeStreamLike {
  if (!isStreamLike(obj)) return false;
  const s = obj;
  return !!(
    s &&
    fn(s["write"]) &&
    fn(s["on"]) &&
    (!s._readableState || s._writableState?.writable !== false)
  );
}

export function isDuplexNodeStream(
  obj: unknown,
): obj is ReadableNodeStreamLike & WritableNodeStreamLike {
  if (!isStreamLike(obj)) return false;
  const s = obj;
  return !!(s && fn(s["pipe"]) && s._readableState && fn(s["on"]) && fn(s["write"]));
}

export function isNodeStream(obj: unknown): obj is NodeStreamLike {
  if (!isStreamLike(obj)) return false;
  const s = obj;
  return !!(
    s &&
    (s._readableState ||
      s._writableState ||
      (fn(s["write"]) && fn(s["on"])) ||
      (fn(s["pipe"]) && fn(s["on"])))
  );
}

// The web streams, which are a different design with a different vocabulary.
// Recognised so that `pipeline` and `Readable.from` can accept them, and
// excluded from the node predicates so that neither is mistaken for the other.
export function isReadableStream(obj: unknown): obj is ReadableWebStreamLike {
  if (!isStreamLike(obj)) return false;
  const s = obj;
  return !!(
    s && !isNodeStream(s) && fn(s["pipeThrough"]) && fn(s["getReader"]) && fn(s["cancel"])
  );
}

export function isWritableStream(obj: unknown): obj is WritableWebStreamLike {
  if (!isStreamLike(obj)) return false;
  const s = obj;
  return !!(s && !isNodeStream(s) && fn(s["getWriter"]) && fn(s["abort"]));
}

export function isTransformStream(obj: unknown): obj is TransformWebStreamLike {
  if (!isStreamLike(obj)) return false;
  const s = obj;
  return !!(
    s && !isNodeStream(s) && typeof s["readable"] === "object" && typeof s["writable"] === "object"
  );
}

export function isWebStream(
  obj: unknown,
): obj is ReadableWebStreamLike | WritableWebStreamLike | TransformWebStreamLike {
  return isReadableStream(obj) || isWritableStream(obj) || isTransformStream(obj);
}

/**
 * Whether `obj` can be iterated, optionally of a particular kind.
 *
 * `isAsync` undefined means either will do. Passing it explicitly matters
 * where the caller is going to `await` or not: a sync iterable driven as an
 * async one yields promises as values instead of resolving them.
 */
export function isIterable(obj: unknown, isAsync: true): obj is AsyncIterable<unknown>;
export function isIterable(obj: unknown, isAsync: false): obj is Iterable<unknown>;
export function isIterable(
  obj: unknown,
  isAsync?: undefined,
): obj is AsyncIterable<unknown> | Iterable<unknown>;
export function isIterable(obj: unknown, isAsync?: boolean): boolean {
  if (obj === null || obj === undefined) return false;
  if (typeof obj === "string") return isAsync !== true;
  if (!isStreamLike(obj)) return false;
  const s = obj;
  if (isAsync === true) return fn(s[Symbol.asyncIterator]);
  if (isAsync === false) return fn(s[Symbol.iterator]);
  return fn(s[Symbol.asyncIterator]) || fn(s[Symbol.iterator]);
}

export function isDestroyed(stream: unknown): boolean | null {
  if (!isNodeStream(stream)) return null;
  const s = stream;
  const state = s._writableState || s._readableState;
  return !!(s["destroyed"] || s[kIsDestroyed] || state?.destroyed);
}

/** `end()` has been called. Not the same as having finished writing. */
export function isWritableEnded(stream: unknown): boolean | null {
  if (!isWritableNodeStream(stream)) return null;
  const s = stream;
  if (s["writableEnded"] === true) return true;
  const state = s._writableState;
  if (state?.errored) return false;
  if (typeof state?.ended !== "boolean") return null;
  return state.ended;
}

/**
 * `finish` has been emitted.
 *
 * `strict === false` also accepts a stream that has been ended and has
 * nothing buffered -- it will emit `finish`, it just has not yet. Callers
 * deciding whether to wait want the loose answer; callers reporting state want
 * the strict one.
 */
export function isWritableFinished(stream: unknown, strict?: boolean): boolean | null {
  if (!isWritableNodeStream(stream)) return null;
  const s = stream;
  if (s["writableFinished"] === true) return true;
  const state = s._writableState;
  if (state?.errored) return false;
  if (typeof state?.finished !== "boolean") return null;
  return !!(state.finished || (strict === false && state.ended === true && state.length === 0));
}

/** `push(null)` has happened. */
export function isReadableEnded(stream: unknown): boolean | null {
  if (!isReadableNodeStream(stream)) return null;
  const s = stream;
  if (s["readableEnded"] === true) return true;
  const state = s._readableState;
  if (!state || state.errored) return false;
  if (typeof state.ended !== "boolean") return null;
  return state.ended;
}

/** `end` has been emitted. */
export function isReadableFinished(stream: unknown, strict?: boolean): boolean | null {
  if (!isReadableNodeStream(stream)) return null;
  const state = stream._readableState;
  if (state?.errored) return false;
  if (typeof state?.endEmitted !== "boolean") return null;
  return !!(state.endEmitted || (strict === false && state.ended === true && state.length === 0));
}

export function isReadable(stream: unknown): boolean | null {
  if (!isStreamLike(stream)) return null;
  const s = stream;
  const branded = s[kIsReadable];
  if (typeof branded === "boolean") return branded;
  if (typeof s["readable"] !== "boolean") return null;
  if (isDestroyed(s)) return false;
  return isReadableNodeStream(s) && s["readable"] && !isReadableFinished(s);
}

export function isWritable(stream: unknown): boolean | null {
  if (!isStreamLike(stream)) return null;
  const s = stream;
  const branded = s[kIsWritable];
  if (typeof branded === "boolean") return branded;
  if (typeof s["writable"] !== "boolean") return null;
  if (isDestroyed(s)) return false;
  return isWritableNodeStream(s) && s["writable"] && !isWritableEnded(s);
}

export interface FinishedOptions {
  readable?: boolean | undefined;
  writable?: boolean | undefined;
}

/**
 * Whether the stream has nothing left to do on the sides the caller cares
 * about.
 *
 * A duplex is finished when both halves are, unless the caller says it is only
 * reading from it or only writing to it -- which is the usual case in a
 * pipeline, where each stage watches one side.
 */
export function isFinished(stream: unknown, opts?: FinishedOptions): boolean | null {
  if (!isNodeStream(stream)) return null;
  if (isDestroyed(stream)) return true;
  if (opts?.readable !== false && isReadable(stream)) return false;
  if (opts?.writable !== false && isWritable(stream)) return false;
  return true;
}

export function isWritableErrored(stream: unknown): unknown {
  if (!isNodeStream(stream)) return null;
  const s = stream;
  if (s["writableErrored"]) return s["writableErrored"];
  return s._writableState?.errored ?? null;
}

export function isReadableErrored(stream: unknown): unknown {
  if (!isNodeStream(stream)) return null;
  const s = stream;
  if (s["readableErrored"]) return s["readableErrored"];
  return s._readableState?.errored ?? null;
}

export function isClosed(stream: unknown): boolean | null {
  if (!isNodeStream(stream)) return null;
  const s = stream;
  if (typeof s["closed"] === "boolean") return s["closed"];

  const w = s._writableState;
  const r = s._readableState;
  if (typeof w?.closed === "boolean" || typeof r?.closed === "boolean") {
    return Boolean(w?.closed || r?.closed);
  }

  // An `http.OutgoingMessage` predates the state objects and tracks this
  // itself. Recognised by shape rather than imported, because `node:http`
  // depends on this file and not the other way round.
  if (typeof s["_closed"] === "boolean" && isOutgoingMessage(s)) {
    return s["_closed"];
  }

  return null;
}

export function isOutgoingMessage(stream: unknown): boolean {
  if (!isStreamLike(stream)) return false;
  const s = stream;
  return (
    typeof s?.["_closed"] === "boolean" &&
    typeof s["_defaultKeepAlive"] === "boolean" &&
    typeof s["_removedConnection"] === "boolean" &&
    typeof s["_removedContLen"] === "boolean"
  );
}

export function isServerResponse(stream: unknown): boolean {
  return isStreamLike(stream) &&
    typeof stream["_sent100"] === "boolean" && isOutgoingMessage(stream);
}

export function isServerRequest(stream: unknown): boolean {
  if (!isStreamLike(stream)) return false;
  const s = stream;
  const request = s["req"];
  return (
    typeof s["_consuming"] === "boolean" &&
    typeof s["_dumped"] === "boolean" &&
    (!isStreamLike(request) || request["upgradeOrConnect"] === undefined)
  );
}

/**
 * Whether waiting for `close` will ever be answered.
 *
 * A caller that waits for a `close` the stream will never emit waits forever,
 * so `end-of-stream` asks this before deciding what to listen for.
 */
export function willEmitClose(stream: unknown): boolean | null {
  if (!isNodeStream(stream)) return null;
  const s = stream;
  const state = s._writableState || s._readableState;
  return (
    (!state && isServerResponse(s)) ||
    !!(state?.autoDestroy && state.emitClose && state.closed === false)
  );
}

/**
 * Whether anything has been read from this stream.
 *
 * Not "is it empty": a stream that was read to exhaustion is disturbed, and so
 * is one that was read once and abandoned. The question is whether handing it
 * to something else would give that consumer the whole of the data, and after
 * a single read the answer is no.
 */
export function isDisturbed(stream: unknown): boolean {
  if (!isStreamLike(stream)) return false;
  const branded = stream[kIsDisturbed];
  if (typeof branded === "boolean") return branded;
  return Boolean(stream["readableDidRead"] || stream["readableAborted"]);
}

export function isErrored(stream: unknown): boolean {
  if (!isStreamLike(stream)) return false;
  const branded = stream[kIsErrored];
  if (typeof branded === "boolean") return branded;
  return Boolean(
    stream["readableErrored"] ??
    stream["writableErrored"] ??
    stream._readableState?.errorEmitted ??
    stream._writableState?.errorEmitted ??
    stream._readableState?.errored ??
    stream._writableState?.errored
  );
}
