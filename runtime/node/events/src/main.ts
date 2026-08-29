// `node:events`, from node v24.20.0 `lib/events.js`.
//
// # Shape
//
// Node defines `EventEmitter` as a function with methods hung off its
// prototype, which is how the module predates `class`. Here it is a class.
// That is the same object with the same behaviour -- `EventEmitter.prototype.on`
// exists either way -- expressed in the syntax TypeScript has.
//
// # The listener store
//
// One key per event name, holding *either* the single listener or an array of
// them. That is upstream's representation and it is load-bearing rather than an
// optimisation detail: `listenerCount` and `emit` both branch on it, and a
// program that adds one listener never allocates an array. Storing an array
// always would be simpler and would change what `emit` costs in the common
// case.

import {
  AbortError,
  ERR_INVALID_ARG_TYPE,
  ERR_UNHANDLED_ERROR,
} from "../../internal/errors.ts";
import {
  validateBoolean, validateFunction, validateInteger, validateNumberRange, validateObject,
} from "../../internal/validators.ts";
import type { AbortSignalLike } from "../../internal/abort.ts";
import { nextTick } from "../../internal/tick.ts";
import { inspect } from "../../util/src/inspect.ts";

export type Listener = (...args: unknown[]) => unknown;

/** A listener registered through `once`, carrying the function it wraps. */
interface OnceWrapper extends Listener {
  listener?: Listener;
}

/** Either the one listener for an event, or all of them. */
type Registered = OnceWrapper | OnceWrapper[];

/** An array of listeners that has already warned about the leak limit. */
interface ListenerArray extends Array<OnceWrapper> {
  warned?: boolean;
}

let defaultMaxListeners = 10;

/**
 * Whether this emitter turns a listener's rejected promise into an `error`
 * event. A symbol on the instance, as node has it, because the default lives
 * on the prototype and an instance may override it.
 */
const kCapture: unique symbol = Symbol("kCapture") as never;

/**
 * `events.captureRejectionSymbol`. An emitter that defines a method under this
 * key handles its own rejections instead of having them turned into `error`.
 */
export const captureRejectionSymbol: unique symbol =
  Symbol.for("nodejs.rejection") as never;
const kRejection = captureRejectionSymbol;

/** The value a new emitter takes when its options say nothing. */
let captureRejectionsDefault = false;

/**
 * The listener store, with no prototype.
 *
 * Upstream writes `{ __proto__: null }`, and the null prototype is not
 * decoration: an event named `toString` or `constructor` has to be a key that
 * is absent until something registers it, not a method inherited from
 * `Object.prototype` that `events[type] !== undefined` would find.
 */
function emptyStore(): Record<string | symbol, Registered | undefined> {
  return Object.create(null) as Record<string | symbol, Registered | undefined>;
}

function checkListener(listener: unknown): asserts listener is Listener {
  validateFunction(listener, "listener");
}

export class EventEmitter {
  declare [kCapture]: boolean;

  // Upstream keeps these on the prototype so that an emitter that never
  // registers anything allocates nothing. A class field would allocate per
  // instance; `undefined` until first use is the same observable state.
  _events: Record<string | symbol, Registered | undefined> | undefined = undefined;
  _eventsCount = 0;
  _maxListeners: number | undefined = undefined;

  constructor(options?: { captureRejections?: boolean }) {
    this._events = emptyStore();
    this._eventsCount = 0;
    this._maxListeners = this._maxListeners || undefined;
    if (options?.captureRejections) {
      validateBoolean(options.captureRejections, "options.captureRejections");
      this[kCapture] = Boolean(options.captureRejections);
    } else {
      this[kCapture] = captureRejectionsDefault;
    }
  }

  /**
   * The default every new emitter takes for rejection capture.
   *
   * A process-wide switch, because the emitters that most need it -- streams,
   * which want a rejected handler to destroy them -- are constructed by
   * libraries rather than by the application that wants the behaviour.
   */
  static get captureRejections(): boolean {
    return captureRejectionsDefault;
  }

  static set captureRejections(value: boolean) {
    validateBoolean(value, "EventEmitter.captureRejections");
    captureRejectionsDefault = value;
    // Instances that never chose for themselves follow the default, which is
    // what putting it on the prototype achieves.
    (EventEmitter.prototype as unknown as Record<symbol, unknown>)[kCapture] = value;
  }

  /** `events.captureRejectionSymbol`, on the class as node has it. */
  static readonly captureRejectionSymbol: typeof captureRejectionSymbol = captureRejectionSymbol;

  /** The limit before `emit` warns about a suspected leak. */
  static get defaultMaxListeners(): number {
    return defaultMaxListeners;
  }

  static set defaultMaxListeners(value: number) {
    validateNumberRange(value, "defaultMaxListeners", 0);
    defaultMaxListeners = value;
  }

  /** Upstream `lib/events.js:304`. */
  static setMaxListeners(n: number = defaultMaxListeners, ...targets: EventEmitter[]): void {
    validateNumberRange(n, "setMaxListeners", 0);
    if (targets.length === 0) {
      defaultMaxListeners = n;
      return;
    }
    for (const target of targets) {
      // Upstream accepts an `EventTarget` here too. Anything that is neither is
      // named in the error rather than failing on a missing method.
      if (typeof (target as { setMaxListeners?: unknown })?.setMaxListeners !== "function") {
        throw new ERR_INVALID_ARG_TYPE("eventTargets", ["EventEmitter", "EventTarget"], target);
      }
      target.setMaxListeners(n);
    }
  }

  /** Upstream `lib/events.js`. The static form of the method. */
  static listenerCount(emitter: EventEmitter, type: string | symbol): number {
    return emitter.listenerCount(type);
  }

  setMaxListeners(n: number): this {
    validateNumberRange(n, "setMaxListeners", 0);
    this._maxListeners = n;
    return this;
  }

  getMaxListeners(): number {
    return maxListenersOf(this);
  }

  addListener(type: string | symbol, listener: Listener): this {
    return addListener(this, type, listener, false) as this;
  }

  on(type: string | symbol, listener: Listener): this {
    return addListener(this, type, listener, false) as this;
  }

  prependListener(type: string | symbol, listener: Listener): this {
    return addListener(this, type, listener, true) as this;
  }

  once(type: string | symbol, listener: Listener): this {
    checkListener(listener);
    this.on(type, onceWrap(this, type, listener));
    return this;
  }

  prependOnceListener(type: string | symbol, listener: Listener): this {
    checkListener(listener);
    this.prependListener(type, onceWrap(this, type, listener));
    return this;
  }


  /** Upstream `lib/events.js:679`. */
  removeListener(type: string | symbol, listener: Listener): this {
    checkListener(listener);

    const events = this._events;
    if (events === undefined) {
      return this;
    }

    const list = events[type];
    if (list === undefined) {
      return this;
    }

    if (list === listener || (typeof list === "function" && list.listener === listener)) {
      this._eventsCount -= 1;
      if (this._eventsCount === 0) {
        this._events = emptyStore();
      } else {
        delete events[type];
      }
      if (events["removeListener"] !== undefined) {
        this.emit("removeListener", type, (list as OnceWrapper).listener || listener);
      }
      return this;
    }

    if (typeof list === "function") {
      return this;
    }

    let position = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] === listener || list[i]!.listener === listener) {
        position = i;
        break;
      }
    }
    if (position < 0) {
      return this;
    }

    if (position === 0) {
      list.shift();
    } else {
      // `spliceOne`, upstream `lib/internal/util.js`: shift the tail down by
      // one rather than allocating the array `splice` would return.
      for (let i = position, k = i + 1, n = list.length; k < n; i += 1, k += 1) {
        list[i] = list[k]!;
      }
      list.pop();
    }

    if (list.length === 1) {
      events[type] = list[0];
    }
    if (events["removeListener"] !== undefined) {
      this.emit("removeListener", type, listener);
    }
    return this;
  }

  off(type: string | symbol, listener: Listener): this {
    return this.removeListener(type, listener);
  }

  /** Upstream `lib/events.js:743`. */
  removeAllListeners(type?: string | symbol): this {
    const events = this._events;
    if (events === undefined) {
      return this;
    }

    // Nobody is watching removals, so the store can be dropped wholesale.
    if (events["removeListener"] === undefined) {
      if (type === undefined) {
        this._events = emptyStore();
        this._eventsCount = 0;
      } else if (events[type] !== undefined) {
        if (--this._eventsCount === 0) {
          this._events = emptyStore();
        } else {
          delete events[type];
        }
      }
      return this;
    }

    if (type === undefined) {
      for (const key of Reflect.ownKeys(events)) {
        if (key === "removeListener") {
          continue;
        }
        this.removeAllListeners(key);
      }
      this.removeAllListeners("removeListener");
      this._events = emptyStore();
      this._eventsCount = 0;
      return this;
    }

    const listeners = events[type];
    if (typeof listeners === "function") {
      this.removeListener(type, listeners);
    } else if (listeners !== undefined) {
      // Last in, first out, so a listener that removes another still sees it.
      for (let i = listeners.length - 1; i >= 0; i--) {
        this.removeListener(type, listeners[i]!);
      }
    }
    return this;
  }

  listeners(type: string | symbol): Listener[] {
    return collect(this, type, true);
  }

  rawListeners(type: string | symbol): Listener[] {
    return collect(this, type, false);
  }

  /** Upstream `lib/events.js`. */
  listenerCount(type: string | symbol, listener?: Listener): number {
    const events = this._events;
    if (events === undefined) {
      return 0;
    }
    const registered = events[type];
    if (registered === undefined) {
      return 0;
    }
    if (typeof registered === "function") {
      if (listener !== undefined && listener !== null) {
        return listener === registered || listener === registered.listener ? 1 : 0;
      }
      return 1;
    }
    if (listener !== undefined && listener !== null) {
      let matching = 0;
      for (const candidate of registered) {
        if (candidate === listener || candidate.listener === listener) {
          matching++;
        }
      }
      return matching;
    }
    return registered.length;
  }

  /** Upstream `lib/events.js:866`. */
  eventNames(): Array<string | symbol> {
    if (this._eventsCount === 0) {
      return [];
    }
    const events = this._events!;
    const names: Array<string | symbol> = [];
    for (const key of Reflect.ownKeys(events)) {
      // A removed listener can leave the key with an `undefined` value.
      if (events[key] !== undefined) {
        names.push(key);
      }
    }
    return names;
  }

  /** Upstream `lib/events.js:489`. */
  emit(type: string | symbol, ...args: unknown[]): boolean {
    let doError = type === "error";

    const events = this._events;
    if (events !== undefined) {
      if (doError && events[EventEmitter.errorMonitor] !== undefined) {
        this.emit(EventEmitter.errorMonitor, ...args);
      }
      doError = doError && events["error"] === undefined;
    } else if (!doError) {
      return false;
    }

    // An `error` event with nobody listening is thrown rather than dropped.
    if (doError) {
      throw unhandledErrorException(args);
    }

    const handler = events![type];
    if (handler === undefined) {
      return false;
    }

    if (typeof handler === "function") {
      const result = handler.apply(this, args);
      if (result !== undefined && result !== null) {
        addCatch(this, result, type, args);
      }
    } else {
      // A copy, because a listener may add or remove listeners while running
      // and upstream's contract is that `emit` calls the set present when it
      // started.
      const copy = handler.slice();
      for (const listener of copy) {
        const result = listener.apply(this, args);
        if (result !== undefined && result !== null) {
          addCatch(this, result, type, args);
        }
      }
    }
    return true;
  }

  /** The symbol whose listeners see an `error` before it is thrown. */
  static readonly errorMonitor: unique symbol = Symbol("events.errorMonitor");

}

/**
 * Upstream `lib/events.js:545`, and a free function for the same reason it is
 * one there: `this` is not required to be an `EventEmitter`. Node's own tests
 * call `EventEmitter.prototype.on` with a plain object as the receiver, and a
 * method reaching for `this.add` would not find it.
 */
function addListener(
  target: EventEmitter,
  type: string | symbol,
  listener: OnceWrapper,
  prepend: boolean,
): EventEmitter {
  checkListener(listener);

  let events = target._events;
  if (events === undefined) {
    events = target._events = emptyStore();
    target._eventsCount = 0;
  } else if (events["newListener"] !== undefined) {
    // Announce before adding -- and re-read `_events`, because the handler for
    // `newListener` may have replaced the whole store. Upstream reassigns for
    // exactly this reason.
    target.emit("newListener", type, listener.listener ?? listener);
    events = target._events!;
  }

  const existing = events[type];
  if (existing === undefined) {
    // One listener needs no array. `emit` branches on this.
    events[type] = listener;
    ++target._eventsCount;
    return target;
  }

  let list: ListenerArray;
  if (typeof existing === "function") {
    list = prepend ? [listener, existing] : [existing, listener];
    events[type] = list;
  } else {
    list = existing;
    if (prepend) {
      list.unshift(listener);
    } else {
      list.push(listener);
    }
  }

  const limit = maxListenersOf(target);
  if (limit > 0 && list.length > limit && !list.warned) {
    warnMaxListenersExceeded(target, type, list, limit);
  }
  return target;
}

/**
 * Upstream `lib/events.js:410` (`_getMaxListeners`). A free function reading
 * the field, not a method call: the receiver here need not be an
 * `EventEmitter`, and node's own tests pass a plain object.
 */
function maxListenersOf(target: EventEmitter): number {
  return target._maxListeners === undefined ? defaultMaxListeners : target._maxListeners;
}

/** Upstream `lib/events.js:633`. The wrapper carries what it wraps. */
function onceWrap(
  target: EventEmitter,
  type: string | symbol,
  listener: Listener,
): OnceWrapper {
  let fired = false;
  const wrapper: OnceWrapper = function (this: unknown, ...args: unknown[]): unknown {
    if (fired) {
      return undefined;
    }
    fired = true;
    target.removeListener(type, wrapper);
    return listener.apply(target, args);
  };
  wrapper.listener = listener;
  return wrapper;
}

/** Upstream `lib/events.js:791`. `unwrap` reports what `once` was given. */
function collect(target: EventEmitter, type: string | symbol, unwrap: boolean): Listener[] {
  const events = target._events;
  if (events === undefined) {
    return [];
  }
  const registered = events[type];
  if (registered === undefined) {
    return [];
  }
  if (typeof registered === "function") {
    return unwrap ? [registered.listener || registered] : [registered];
  }
  return unwrap ? registered.map((l) => l.listener || l) : registered.slice();
}

/**
 * A listener that returned a promise, watched for rejection.
 *
 * Without this an `async` listener that throws produces an unhandled
 * rejection, which is reported somewhere far from the emitter and carries no
 * hint of which event it came from. With `captureRejections` the rejection
 * becomes an `error` event on the emitter, which is where a handler for it
 * already is.
 */
function addCatch(that: EventEmitter, promise: unknown, type: string | symbol, args: unknown[]): void {
  if (!that[kCapture]) {
    return;
  }
  try {
    const then = (promise as { then?: unknown }).then;
    if (typeof then === "function") {
      (then as (this: unknown, onOk: undefined, onErr: (e: unknown) => void) => void)
        .call(promise, undefined, (err: unknown) => {
          // On a later tick, so that a throw from the `error` handler is an
          // uncaught exception rather than another rejection.
          nextTick(emitUnhandledRejectionOrErr, that, err, type, args);
        });
    }
  } catch (err) {
    that.emit("error", err);
  }
}

function emitUnhandledRejectionOrErr(
  ee: EventEmitter,
  err: unknown,
  type: string | symbol,
  args: unknown[],
): void {
  const handler = (ee as unknown as Record<symbol, unknown>)[kRejection];
  if (typeof handler === "function") {
    (handler as (...a: unknown[]) => void).call(ee, err, type, ...args);
    return;
  }
  // Capture is turned off around the emit: an `error` handler that itself
  // returns a rejected promise would otherwise loop.
  const prev = ee[kCapture];
  try {
    ee[kCapture] = false;
    ee.emit("error", err);
  } finally {
    ee[kCapture] = prev;
  }
}

/**
 * What the unhandled value looked like.
 *
 * `inspect` can throw -- the value may define a custom inspection that does --
 * and the error being reported is the emitter's, not that one's. Coercion is
 * the fallback because it is what remains that cannot fail.
 */
function describeUndeliverable(value: unknown): string {
  try {
    return inspect(value);
  } catch {
    return `${value}`;
  }
}

/** Upstream `lib/events.js:449`. */
function unhandledErrorException(args: unknown[]): Error {
  const first = args.length > 0 ? args[0] : undefined;
  if (first instanceof Error) {
    return first;
  }
  // Node prints no parenthetical when `emit('error')` carried nothing, which
  // is why `ERR_UNHANDLED_ERROR` takes an optional argument rather than a
  // stringified `undefined`.
  // Node inspects rather than stringifies, so a string argument is quoted:
  // `Unhandled error. ('Accepts a string')`.
  const error = new ERR_UNHANDLED_ERROR(first === undefined ? undefined : describeUndeliverable(first));
  error.context = first;
  return error;
}

/** Upstream `lib/events.js:599`. A warning, not an error: the limit is a hint. */
function warnMaxListenersExceeded(
  target: EventEmitter,
  type: string | symbol,
  list: ListenerArray,
  limit: number,
): void {
  list.warned = true;
  const warning = new Error(
    `Possible EventEmitter memory leak detected. ${list.length} ${String(type)} listeners ` +
      `added to [${target.constructor.name}]. MaxListeners is ${limit}. ` +
      `Use emitter.setMaxListeners() to increase limit`,
  ) as MaxListenersExceededWarning;
  warning.name = "MaxListenersExceededWarning";
  // Node's tests read all three off the warning, so they are part of its shape
  // rather than debugging decoration.
  warning.emitter = target;
  warning.type = type;
  warning.count = list.length;
  emitWarning(warning);
}

interface MaxListenersExceededWarning extends Error {
  emitter: EventEmitter;
  type: string | symbol;
  count: number;
}

/**
 * A distinct binding from `nts_process_emit_warning`, because this warning is
 * not just a name and a message: node's tests read `emitter`, `type` and
 * `count` off the object they catch, so the object the implementation built has
 * to be the one that is emitted. Sharing the general binding would mean
 * sharing its signature, and a symbol that means two things is a link error
 * waiting to happen.
 */
declare function nts_events_emit_max_listeners_warning(
  message: string,
  warning: unknown,
): void;

function emitWarning(warning: MaxListenersExceededWarning): void {
  nts_events_emit_max_listeners_warning(warning.message, warning);
}

/** Upstream `lib/events.js:216`. */
export function getEventListeners(emitter: EventEmitter, type: string | symbol): Listener[] {
  return emitter.listeners(type);
}

export function getMaxListeners(emitter: EventEmitter): number {
  return emitter.getMaxListeners();
}

export function listenerCount(emitter: EventEmitter, type: string | symbol): number {
  return emitter.listenerCount(type);
}

export function setMaxListeners(n?: number, ...targets: EventEmitter[]): void {
  EventEmitter.setMaxListeners(n, ...targets);
}

// Node writes `EventEmitter.prototype.on = EventEmitter.prototype.addListener`,
// so the two are *the same function object* and `emitter.on === emitter.addListener`
// is true. Two class methods would be two objects, and node's own tests compare
// them with `strictEqual`.
EventEmitter.prototype.on = EventEmitter.prototype.addListener;
EventEmitter.prototype.off = EventEmitter.prototype.removeListener;

/**
 * `events.once(emitter, name)`, upstream `lib/events.js`.
 *
 * Resolves with the arguments of the next matching event, or rejects on
 * `error`. It is a promise, so it needs the runtime's promise support; the
 * shape is here so that it arrives complete rather than as an afterthought.
 */
export function once(
  emitter: EventEmitter,
  name: string | symbol,
): Promise<unknown[]> {
  return new Promise<unknown[]>((resolve, reject) => {
    const eventListener = (...args: unknown[]): void => {
      if (errorListener !== undefined) {
        emitter.removeListener("error", errorListener);
      }
      resolve(args);
    };
    let errorListener: Listener | undefined;

    // An `error` while waiting rejects, unless `error` is what we are waiting
    // for. Upstream makes the same exception.
    if (name !== "error") {
      errorListener = (err: unknown): void => {
        emitter.removeListener(name, eventListener);
        reject(err);
      };
      emitter.once("error", errorListener);
    }

    emitter.once(name, eventListener);
  });
}

/**
 * Hand the listener the first argument rather than the whole array.
 *
 * `on(emitter, "line")` yields `["a line"]`, because an event can carry any
 * number of arguments and the general answer is the list. A `line` event never
 * carries more than one, and `for await (const line of rl)` should yield the
 * line rather than a one-element array -- so `node:readline` asks for this.
 * Node has the same escape hatch under the same name.
 */
export const kFirstEventParam: unique symbol = Symbol("nodejs.kFirstEventParam");

export interface OnOptions {
  signal?: AbortSignalLike | undefined;
  /** Pause the emitter once this many events are waiting. */
  highWaterMark?: number | undefined;
  /** Resume it once fewer than this many are. */
  lowWaterMark?: number | undefined;
  [kFirstEventParam]?: boolean | undefined;
}

interface PausableEmitter extends EventEmitter {
  pause?(): unknown;
  resume?(): unknown;
}

/**
 * An event, as an async iterable.
 *
 * The interesting part is the backpressure, and it is the reason this cannot
 * be three lines. Events arrive whether or not anyone is consuming them, so an
 * iterator over a busy emitter is a queue that grows without bound -- which is
 * how a program that reads lines slower than they arrive runs out of memory
 * rather than slowing down. So the queue has a high-water mark: cross it and
 * the emitter is paused; drain below the low mark and it is resumed.
 *
 * Two queues, not one. Either events are waiting for a consumer or consumers
 * are waiting for an event, never both, and keeping them apart means `next`
 * never has to ask which situation it is in -- it looks at the one that could
 * have something in it.
 */
export function on(
  emitter: PausableEmitter,
  event: string | symbol,
  options: OnOptions = {},
): AsyncIterableIterator<unknown> {
  validateObject(options, "options");
  const signal = options.signal;
  if (signal !== undefined && signal !== null) {
    if (typeof (signal as AbortSignalLike).addEventListener !== "function") {
      throw new ERR_INVALID_ARG_TYPE("options.signal", "AbortSignal", signal);
    }
    if (signal.aborted) throw new AbortError();
  }

  // Unbounded by default, because `on` is also used on emitters that cannot be
  // paused and pausing one that cannot would be worse than queueing.
  const highWaterMark = options.highWaterMark ?? Number.MAX_SAFE_INTEGER;
  validateInteger(highWaterMark, "options.highWaterMark", 1);
  const lowWaterMark = options.lowWaterMark ?? 1;
  validateInteger(lowWaterMark, "options.lowWaterMark", 1);

  // Index-based rather than `shift`, which is linear: this queue is drained
  // one element at a time and the whole point of it is to hold many.
  const unconsumedEvents: unknown[] = [];
  let eventsHead = 0;
  const unconsumedPromises: {
    resolve(r: IteratorResult<unknown>): void;
    reject(e: unknown): void;
  }[] = [];
  let promisesHead = 0;

  let paused = false;
  let error: unknown = null;
  let finished = false;

  const pendingEvents = (): number => unconsumedEvents.length - eventsHead;
  const pendingPromises = (): number => unconsumedPromises.length - promisesHead;

  const done = (): IteratorResult<unknown> => ({ value: undefined, done: true });

  function closeHandler(): Promise<IteratorResult<unknown>> {
    if (signal) signal.removeEventListener("abort", abortListener);
    emitter.removeListener(event, listener);
    emitter.removeListener("error", errorHandler);
    for (const name of closeEvents) emitter.removeListener(name, closeHandler);
    finished = true;
    paused = false;
    while (pendingPromises() > 0) {
      (unconsumedPromises[promisesHead++] as { resolve(r: IteratorResult<unknown>): void })
        .resolve(done());
    }
    return Promise.resolve(done());
  }

  function eventHandler(value: unknown): void {
    if (pendingPromises() === 0) {
      unconsumedEvents.push(value);
      if (!paused && pendingEvents() > highWaterMark && typeof emitter.pause === "function") {
        paused = true;
        emitter.pause();
      }
      return;
    }
    (unconsumedPromises[promisesHead++] as { resolve(r: IteratorResult<unknown>): void })
      .resolve({ value, done: false });
  }

  function errorHandler(err: unknown): void {
    if (pendingPromises() === 0) error = err;
    else (unconsumedPromises[promisesHead++] as { reject(e: unknown): void }).reject(err);
    void closeHandler();
  }

  function abortListener(): void {
    errorHandler(new AbortError());
  }

  const first = options[kFirstEventParam] === true;
  const listener = first
    ? (value: unknown): void => eventHandler(value)
    : (...args: unknown[]): void => eventHandler(args);

  emitter.on(event, listener as Listener);
  if (event !== "error") emitter.on("error", errorHandler as Listener);
  const closeEvents: string[] = ["close"];
  for (const name of closeEvents) emitter.on(name, closeHandler as unknown as Listener);
  if (signal) signal.addEventListener("abort", abortListener, { once: true });

  const iterator: AsyncIterableIterator<unknown> = {
    next(): Promise<IteratorResult<unknown>> {
      if (pendingEvents() > 0) {
        const value = unconsumedEvents[eventsHead++];
        // Released only once the backlog is genuinely small, not at the first
        // free slot: resuming at the high mark would pause and resume on every
        // single event.
        if (paused && pendingEvents() < lowWaterMark && typeof emitter.resume === "function") {
          paused = false;
          emitter.resume();
        }
        return Promise.resolve({ value, done: false });
      }

      if (error !== null) {
        const rejected = Promise.reject(error);
        error = null;
        return rejected;
      }

      if (finished) return closeHandler();

      return new Promise((resolve, reject) => {
        unconsumedPromises.push({ resolve, reject });
      });
    },

    return(): Promise<IteratorResult<unknown>> {
      return closeHandler();
    },

    throw(err: unknown): Promise<IteratorResult<unknown>> {
      if (!err || !(err instanceof Error)) {
        throw new ERR_INVALID_ARG_TYPE("EventEmitter.AsyncIterator", "Error", err);
      }
      errorHandler(err);
      return Promise.resolve(done());
    },

    [Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
      return iterator;
    },
  };

  return iterator;
}

export default EventEmitter;

// The default lives on the prototype, so an emitter that did not choose for
// itself follows `EventEmitter.captureRejections` as it changes.
(EventEmitter.prototype as unknown as Record<symbol, unknown>)[kCapture] = false;
