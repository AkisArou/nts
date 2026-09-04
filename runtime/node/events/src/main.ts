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
// Node uses a null-prototype object as a property table. NTS deliberately has
// neither property maps nor mutable prototype chains, so this port uses the
// language's typed, insertion-ordered `Map`. One event still holds either one
// listener record or a list, preserving the allocation and dispatch behavior
// of the common single-listener case.

import {
  AbortError,
  ERR_INVALID_ARG_TYPE,
  ERR_UNHANDLED_ERROR,
} from "../../internal/errors.ts";
import {
  validateAbortSignal,
  validateBoolean,
  validateFunction,
  validateInteger,
  validateNumberRange,
  validateObject,
} from "../../internal/validators.ts";
import type { AbortSignalLike } from "../../internal/abort.ts";
import { nextTick } from "../../internal/tick.ts";
import {
  AsyncResource,
  type AsyncResourceOptions,
} from "../../async_hooks/src/resource.ts";
import { emitProcessWarning } from "../../internal/process-warning.ts";
import { inspect } from "../../util/src/inspect.ts";

export type Listener = (...args: unknown[]) => unknown;
export type EventName = string | symbol;

/**
 * The part of an `EventTarget` used by the public helpers in this module.
 *
 * This profile deliberately does not load the DOM ambient declarations. A
 * structural interface keeps the boundary explicit and lets a host-provided
 * `EventTarget` participate without importing an unrelated global type set.
 */
export interface EventTargetLike {
  addEventListener(
    type: EventName,
    listener: Listener,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: EventName, listener: Listener): void;
}

export type EventSource = EventEmitter | EventTargetLike;

interface MaxListenerTarget {
  setMaxListeners(value: number): unknown;
}

function isMaxListenerTarget(value: unknown): value is MaxListenerTarget {
  return value !== null && typeof value === "object" &&
    "setMaxListeners" in value && typeof value.setMaxListeners === "function";
}

function isEventTargetLike(value: unknown): value is EventTargetLike {
  return value !== null && typeof value === "object" &&
    "addEventListener" in value &&
    typeof value.addEventListener === "function" &&
    "removeEventListener" in value &&
    typeof value.removeEventListener === "function";
}

/**
 * The callable used by `emit` and the public listener originally registered.
 *
 * Node attaches `.listener` to a wrapper function created by `once`.
 * Functions are not metadata-bearing objects in NTS, so the relationship is a
 * statically typed record instead.
 */
class ListenerRecord {
  readonly callback: Listener;
  readonly original: Listener;

  constructor(
    callback: Listener,
    original: Listener,
  ) {
    this.callback = callback;
    this.original = original;
  }
}

/** Listener lists carry their warning state without decorating an array. */
class ListenerList {
  entries: ListenerRecord[];
  warned: boolean;
  emitting = 0;

  constructor(
    entries: ListenerRecord[],
    warned = false,
  ) {
    this.entries = entries;
    this.warned = warned;
  }
}

/** Either the one listener for an event, or all of them. */
type Registered = ListenerRecord | ListenerList;
type EventStore = Map<EventName, Registered | undefined>;

let defaultMaxListeners = 10;

/** Max-listener overrides for host EventTargets, without decorating them. */
const eventTargetMaxListeners = new Map<EventTargetLike, number>();

/**
 * `events.captureRejectionSymbol`. An emitter that defines a method under this
 * key handles its own rejections instead of having them turned into `error`.
 */
declare const captureRejectionSymbolType: unique symbol;
export const captureRejectionSymbol: typeof captureRejectionSymbolType =
  Symbol.for("nodejs.rejection") as typeof captureRejectionSymbolType;

/** The value a new emitter takes when its options say nothing. */
let captureRejectionsDefault = false;

function emptyStore(): EventStore {
  return new Map<EventName, Registered>();
}

function checkListener(listener: unknown): asserts listener is Listener {
  validateFunction(listener, "listener");
}

function listenerAt(
  listeners: readonly ListenerRecord[],
  index: number,
): ListenerRecord {
  const listener = listeners[index];
  if (listener === undefined) {
    throw new Error("EventEmitter listener-store invariant violated");
  }
  return listener;
}

function eventListenerAt(
  listeners: readonly Listener[],
  index: number,
): Listener {
  const listener = listeners[index];
  if (listener === undefined) {
    throw new Error("EventTarget listener-store invariant violated");
  }
  return listener;
}

export class EventEmitter {
  /**
   * Statically named optional rejection hook. A computed symbol known at
   * compile time is a normal field in NTS, not a dynamic property lookup.
   */
  declare [captureRejectionSymbol]:
    | ((err: unknown, type: EventName, ...args: unknown[]) => void)
    | undefined;

  _events: EventStore | undefined = undefined;
  _eventsCount = 0;
  _maxListeners: number | undefined = undefined;
  _captureRejections = false;
  private _preserveEventShape = false;

  constructor(options?: { captureRejections?: boolean }) {
    this._events = emptyStore();
    this._eventsCount = 0;
    this._configureCaptureRejections(options?.captureRejections);
  }

  protected _configureCaptureRejections(capture: boolean | undefined): void {
    if (capture !== undefined) {
      validateBoolean(capture, "options.captureRejections");
      this._captureRejections = capture;
    } else {
      this._captureRejections = captureRejectionsDefault;
    }
  }

  /**
   * Reserve known event slots in a stable order.
   *
   * Streams add and remove the same handful of listeners throughout their
   * lifetime. Keeping empty slots avoids changing the store shape on every
   * transition and preserves Node's observable `eventNames()` order without
   * a prototype-owned property table.
   */
  protected _initializeEventShape(names: readonly EventName[]): void {
    const events = emptyStore();
    for (const name of names) events.set(name, undefined);
    this._events = events;
    this._eventsCount = 0;
    this._preserveEventShape = true;
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
  }

  /** `events.captureRejectionSymbol`, on the class as node has it. */
  static readonly captureRejectionSymbol: typeof captureRejectionSymbol = captureRejectionSymbol;

  /** Module helpers are the same function values on Node's exported class. */
  static readonly getEventListeners = getEventListeners;
  static readonly getMaxListeners = getMaxListeners;
  static readonly listenerCount = listenerCount;
  static readonly once = once;
  static readonly on = on;

  /** Node exposes this lazily; a getter also avoids a forwarding class. */
  static get EventEmitterAsyncResource(): typeof EventEmitterAsyncResource {
    return EventEmitterAsyncResource;
  }

  /** The limit before `emit` warns about a suspected leak. */
  static get defaultMaxListeners(): number {
    return defaultMaxListeners;
  }

  static set defaultMaxListeners(value: number) {
    validateNumberRange(value, "defaultMaxListeners", 0);
    defaultMaxListeners = value;
  }

  /** Upstream `lib/events.js:304`. */
  static setMaxListeners(
    n: number = defaultMaxListeners,
    ...targets: unknown[]
  ): void {
    validateNumberRange(n, "setMaxListeners", 0);
    if (targets.length === 0) {
      defaultMaxListeners = n;
      return;
    }
    for (const target of targets) {
      if (isMaxListenerTarget(target)) {
        target.setMaxListeners(n);
      } else if (isEventTargetLike(target)) {
        eventTargetMaxListeners.set(target, n);
      } else {
        throw new ERR_INVALID_ARG_TYPE(
          "eventTargets",
          ["EventEmitter", "EventTarget"],
          target,
        );
      }
    }
  }

  setMaxListeners(n: number): this {
    validateNumberRange(n, "setMaxListeners", 0);
    this._maxListeners = n;
    return this;
  }

  getMaxListeners(): number {
    return maxListenersOf(this);
  }

  addListener<Args extends unknown[]>(
    type: EventName,
    listener: (...args: Args) => unknown,
  ): this;
  addListener(type: EventName, listener: unknown): this {
    checkListener(listener);
    return addListener(
      this,
      type,
      new ListenerRecord(listener, listener),
      false,
    );
  }

  on<Args extends unknown[]>(
    type: EventName,
    listener: (...args: Args) => unknown,
  ): this;
  on(type: EventName, listener: unknown): this {
    checkListener(listener);
    return addListener(
      this,
      type,
      new ListenerRecord(listener, listener),
      false,
    );
  }

  prependListener<Args extends unknown[]>(
    type: EventName,
    listener: (...args: Args) => unknown,
  ): this;
  prependListener(type: EventName, listener: unknown): this {
    checkListener(listener);
    return addListener(
      this,
      type,
      new ListenerRecord(listener, listener),
      true,
    );
  }

  once<Args extends unknown[]>(
    type: EventName,
    listener: (...args: Args) => unknown,
  ): this;
  once(type: EventName, listener: unknown): this {
    checkListener(listener);
    return addListener(this, type, onceRecord(this, type, listener), false);
  }

  prependOnceListener<Args extends unknown[]>(
    type: EventName,
    listener: (...args: Args) => unknown,
  ): this;
  prependOnceListener(type: EventName, listener: unknown): this {
    checkListener(listener);
    return addListener(this, type, onceRecord(this, type, listener), true);
  }


  /** Upstream `lib/events.js:679`. */
  removeListener<Args extends unknown[]>(
    type: EventName,
    listener: (...args: Args) => unknown,
  ): this;
  removeListener(type: EventName, listener: unknown): this {
    checkListener(listener);

    const events = this._events;
    if (events === undefined) {
      return this;
    }

    const registered = events.get(type);
    if (registered === undefined) {
      return this;
    }

    if (registered instanceof ListenerRecord) {
      if (
        registered.callback !== listener &&
        registered.original !== listener
      ) {
        return this;
      }
      this._eventsCount -= 1;
      if (this._preserveEventShape) {
        events.set(type, undefined);
      } else if (this._eventsCount === 0) {
        this._events = emptyStore();
      } else {
        events.delete(type);
      }
      if (events.get("removeListener") !== undefined) {
        this.emit("removeListener", type, registered.original);
      }
      return this;
    }

    const entries = registered.entries;
    let position = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      const candidate = listenerAt(entries, i);
      if (candidate.callback === listener || candidate.original === listener) {
        position = i;
        break;
      }
    }
    if (position < 0) {
      return this;
    }

    const removed = listenerAt(entries, position);
    const mutable = mutableListenerList(events, type, registered);
    const mutableEntries = mutable.entries;
    if (entries.length === 2) {
      events.set(type, listenerAt(mutableEntries, position === 0 ? 1 : 0));
    } else {
      const next = new Array<ListenerRecord>(mutableEntries.length - 1);
      let destination = 0;
      for (let source = 0; source < mutableEntries.length; source++) {
        if (source !== position) {
          next[destination] = listenerAt(mutableEntries, source);
          destination += 1;
        }
      }
      mutable.entries = next;
    }
    if (events.get("removeListener") !== undefined) {
      this.emit("removeListener", type, removed.original);
    }
    return this;
  }

  off<Args extends unknown[]>(
    type: EventName,
    listener: (...args: Args) => unknown,
  ): this;
  off(type: EventName, listener: unknown): this {
    checkListener(listener);
    return this.removeListener(type, listener);
  }

  /** Upstream `lib/events.js:743`. */
  removeAllListeners(type?: string | symbol): this {
    const events = this._events;
    if (events === undefined) {
      return this;
    }

    // Nobody is watching removals, so the store can be dropped wholesale.
    if (events.get("removeListener") === undefined) {
      if (type === undefined) {
        this._events = emptyStore();
        this._eventsCount = 0;
        this._preserveEventShape = false;
      } else if (events.get(type) !== undefined) {
        if (this._preserveEventShape) events.set(type, undefined);
        else events.delete(type);
        if (--this._eventsCount === 0 && !this._preserveEventShape) {
          this._events = emptyStore();
        }
      }
      return this;
    }

    if (type === undefined) {
      const keys = new Array<EventName>(events.size);
      let index = 0;
      for (const key of events.keys()) {
        keys[index] = key;
        index += 1;
      }
      for (const key of keys) {
        if (key === "removeListener") {
          continue;
        }
        this.removeAllListeners(key);
      }
      this.removeAllListeners("removeListener");
      this._events = emptyStore();
      this._eventsCount = 0;
      this._preserveEventShape = false;
      return this;
    }

    const listeners = events.get(type);
    if (listeners instanceof ListenerRecord) {
      this.removeListener(type, listeners.callback);
    } else if (listeners !== undefined) {
      // Last in, first out, so a listener that removes another still sees it.
      const entries = listeners.entries;
      for (let i = entries.length - 1; i >= 0; i--) {
        this.removeListener(type, listenerAt(entries, i).callback);
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
  listenerCount<Args extends unknown[]>(
    type: EventName,
    listener?: (...args: Args) => unknown,
  ): number;
  listenerCount(type: EventName, listener?: unknown): number {
    const events = this._events;
    if (events === undefined) {
      return 0;
    }
    const registered = events.get(type);
    if (registered === undefined) {
      return 0;
    }
    if (registered instanceof ListenerRecord) {
      if (listener !== undefined && listener !== null) {
        return listener === registered.callback || listener === registered.original ? 1 : 0;
      }
      return 1;
    }
    if (listener !== undefined && listener !== null) {
      let matching = 0;
      for (const candidate of registered.entries) {
        if (candidate.callback === listener || candidate.original === listener) {
          matching++;
        }
      }
      return matching;
    }
    return registered.entries.length;
  }

  /** Upstream `lib/events.js:866`. */
  eventNames(): Array<string | symbol> {
    if (this._eventsCount === 0) {
      return [];
    }
    const events = this._events;
    if (events === undefined) {
      return [];
    }
    const names = new Array<EventName>(this._eventsCount);
    let index = 0;
    for (const key of events.keys()) {
      if (events.get(key) !== undefined) {
        names[index] = key;
        index += 1;
      }
    }
    return names;
  }

  /** Upstream `lib/events.js:489`. */
  emit(type: string | symbol, ...args: unknown[]): boolean {
    const events = this._events;
    const isError = type === "error";
    if (events === undefined) {
      if (isError) {
        throw unhandledErrorException(args);
      }
      return false;
    }

    if (isError && events.get(EventEmitter.errorMonitor) !== undefined) {
      this.emit(EventEmitter.errorMonitor, ...args);
    }

    // An `error` event with nobody listening is thrown rather than dropped.
    if (isError && events.get("error") === undefined) {
      throw unhandledErrorException(args);
    }

    const handler = events.get(type);
    if (handler === undefined) {
      return false;
    }

    if (handler instanceof ListenerRecord) {
      // Read the function out before invoking it. Calling
      // `handler.callback(...)` would make the private ListenerRecord the
      // JavaScript receiver, leaking an implementation detail as `this`.
      const callback = handler.callback;
      const result = callback.call(this, ...args);
      if (result !== undefined && result !== null) {
        addCatch(this, result, type, args);
      }
    } else {
      // Mutations copy only while a dispatch is active, so the hot path does
      // not allocate and this dispatch still sees exactly its starting set.
      handler.emitting += 1;
      try {
        for (const listener of handler.entries) {
          const callback = listener.callback;
          const result = callback.call(this, ...args);
          if (result !== undefined && result !== null) {
            addCatch(this, result, type, args);
          }
        }
      } finally {
        handler.emitting -= 1;
      }
    }
    return true;
  }

  /** The symbol whose listeners see an `error` before it is thrown. */
  static readonly errorMonitor: unique symbol = Symbol("events.errorMonitor");

}

export interface EventEmitterAsyncResourceOptions
  extends AsyncResourceOptions {
  captureRejections?: boolean | undefined;
  name?: string | undefined;
}

class EventEmitterReferencingAsyncResource extends AsyncResource {
  readonly eventEmitter: EventEmitterAsyncResource;

  constructor(
    eventEmitter: EventEmitterAsyncResource,
    type: string,
    options: AsyncResourceOptions,
  ) {
    super(type, options);
    this.eventEmitter = eventEmitter;
  }
}

/**
 * An EventEmitter whose listeners run in the async scope captured at creation.
 *
 * Node derives the default name of an empty subclass from `new.target.name`.
 * Observable function/class names are a §13 non-goal, so subclasses that need
 * a distinct resource type pass it explicitly through the string or `name`
 * option form.
 */
export class EventEmitterAsyncResource extends EventEmitter {
  readonly #asyncResource: EventEmitterReferencingAsyncResource;

  constructor(options?: string | EventEmitterAsyncResourceOptions) {
    const emitterOptions = typeof options === "string" ? undefined : options;
    super(emitterOptions);

    const name = typeof options === "string"
      ? options
      : options?.name ?? "EventEmitterAsyncResource";
    this.#asyncResource = new EventEmitterReferencingAsyncResource(
      this,
      name,
      emitterOptions ?? {},
    );
  }

  override emit(type: EventName, ...args: unknown[]): boolean {
    return this.#asyncResource.runInAsyncScope(
      super.emit,
      this,
      type,
      ...args,
    );
  }

  emitDestroy(): this {
    this.#asyncResource.emitDestroy();
    return this;
  }

  get asyncId(): number {
    return this.#asyncResource.asyncId();
  }

  get triggerAsyncId(): number {
    return this.#asyncResource.triggerAsyncId();
  }

  get asyncResource(): AsyncResource & {
    readonly eventEmitter: EventEmitterAsyncResource;
  } {
    return this.#asyncResource;
  }
}

/**
 * Upstream `lib/events.js:545`, and a free function for the same reason it is
 * one there: `this` is not required to be an `EventEmitter`. Node's own tests
 * call `EventEmitter.prototype.on` with a plain object as the receiver, and a
 * method reaching for `this.add` would not find it.
 */
function addListener<T extends EventEmitter>(
  target: T,
  type: EventName,
  listener: ListenerRecord,
  prepend: boolean,
): T {
  let events = target._events;
  if (events === undefined) {
    events = target._events = emptyStore();
    target._eventsCount = 0;
  } else if (events.get("newListener") !== undefined) {
    // Announce before adding -- and re-read `_events`, because the handler for
    // `newListener` may have replaced the whole store. Upstream reassigns for
    // exactly this reason.
    target.emit("newListener", type, listener.original);
    events = target._events;
    if (events === undefined) {
      events = target._events = emptyStore();
      target._eventsCount = 0;
    }
  }

  const existing = events.get(type);
  if (existing === undefined) {
    // One listener needs no array. `emit` branches on this.
    events.set(type, listener);
    ++target._eventsCount;
    return target;
  }

  let list: ListenerList;
  if (existing instanceof ListenerRecord) {
    list = new ListenerList(
      prepend ? [listener, existing] : [existing, listener],
    );
    events.set(type, list);
  } else {
    list = mutableListenerList(events, type, existing);
    const current = list.entries;
    const next = new Array<ListenerRecord>(current.length + 1);
    if (prepend) {
      next[0] = listener;
      for (let i = 0; i < current.length; i++) {
        next[i + 1] = listenerAt(current, i);
      }
    } else {
      for (let i = 0; i < current.length; i++) {
        next[i] = listenerAt(current, i);
      }
      next[current.length] = listener;
    }
    list.entries = next;
  }

  const limit = maxListenersOf(target);
  if (limit > 0 && list.entries.length > limit && !list.warned) {
    warnMaxListenersExceeded(target, type, list, limit);
  }
  return target;
}

/**
 * Preserve the listener set seen by an active `emit` without copying on every
 * dispatch. This is upstream's copy-on-write rule expressed as typed state on
 * the list rather than metadata attached to an array.
 */
function mutableListenerList(
  events: EventStore,
  type: EventName,
  list: ListenerList,
): ListenerList {
  if (list.emitting === 0) {
    return list;
  }
  const copy = new ListenerList(list.entries.slice(), list.warned);
  events.set(type, copy);
  return copy;
}

/**
 * Upstream `lib/events.js:410` (`_getMaxListeners`). A free function reading
 * the field, not a method call: the receiver here need not be an
 * `EventEmitter`, and node's own tests pass a plain object.
 */
function maxListenersOf(target: EventEmitter): number {
  return target._maxListeners === undefined ? defaultMaxListeners : target._maxListeners;
}

/** Upstream `lib/events.js:633`, with wrapper metadata kept in a record. */
function onceRecord(
  target: EventEmitter,
  type: EventName,
  listener: Listener,
): ListenerRecord {
  let fired = false;
  const wrapper: Listener = function (this: unknown, ...args: unknown[]): unknown {
    if (fired) {
      return undefined;
    }
    fired = true;
    target.removeListener(type, wrapper);
    return listener.call(target, ...args);
  };
  return new ListenerRecord(wrapper, listener);
}

/** Upstream `lib/events.js:791`. `unwrap` reports what `once` was given. */
function collect(target: EventEmitter, type: string | symbol, unwrap: boolean): Listener[] {
  const events = target._events;
  if (events === undefined) {
    return [];
  }
  const registered = events.get(type);
  if (registered === undefined) {
    return [];
  }
  if (registered instanceof ListenerRecord) {
    return [unwrap ? registered.original : registered.callback];
  }
  const source = registered.entries;
  const listeners = new Array<Listener>(source.length);
  for (let i = 0; i < source.length; i++) {
    const record = listenerAt(source, i);
    listeners[i] = unwrap ? record.original : record.callback;
  }
  return listeners;
}

interface ThenableLike {
  then(
    onFulfilled: undefined,
    onRejected: (reason: unknown) => void,
  ): unknown;
}

function isThenableLike(value: unknown): value is ThenableLike {
  return value !== null && typeof value === "object" &&
    "then" in value && typeof value.then === "function";
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
  if (!that._captureRejections) {
    return;
  }
  try {
    if (!isThenableLike(promise)) return;
    promise.then(undefined, (err: unknown) => {
      // On a later tick, so that a throw from the `error` handler is an
      // uncaught exception rather than another rejection.
      nextTick(emitUnhandledRejectionOrErr, that, err, type, args);
    });
  } catch (error) {
    that.emit("error", error);
  }
}

function emitUnhandledRejectionOrErr(
  ee: EventEmitter,
  err: unknown,
  type: string | symbol,
  args: unknown[],
): void {
  const handler = ee[captureRejectionSymbol];
  if (typeof handler === "function") {
    handler.call(ee, err, type, ...args);
    return;
  }
  // Capture is turned off around the emit: an `error` handler that itself
  // returns a rejected promise would otherwise loop.
  const prev = ee._captureRejections;
  try {
    ee._captureRejections = false;
    ee.emit("error", err);
  } finally {
    ee._captureRejections = prev;
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
  list: ListenerList,
  limit: number,
): void {
  list.warned = true;
  emitWarning(
    new MaxListenersExceededWarning(
      target,
      type,
      list.entries.length,
      limit,
    ),
  );
}

class MaxListenersExceededWarning extends Error {
  readonly emitter: EventEmitter;
  readonly type: EventName;
  readonly count: number;

  constructor(
    emitter: EventEmitter,
    type: EventName,
    count: number,
    limit: number,
  ) {
    super(
      `Possible EventEmitter memory leak detected. ${count} ${String(type)} listeners ` +
        `added to [EventEmitter]. MaxListeners is ${limit}. ` +
        `Use emitter.setMaxListeners() to increase limit`,
    );
    this.name = "MaxListenersExceededWarning";
    this.emitter = emitter;
    this.type = type;
    this.count = count;
  }
}

function emitWarning(warning: MaxListenersExceededWarning): void {
  emitProcessWarning(warning);
}

function copyOwnedEventTargetListeners(
  target: EventTargetLike,
  type: EventName,
): Listener[] {
  const current = ownedEventTargetListenersStore(target, type);
  if (current === undefined) {
    return [];
  }
  const copy = new Array<Listener>(current.length);
  for (let i = 0; i < current.length; i++) {
    copy[i] = eventListenerAt(current, i);
  }
  return copy;
}

function ownedEventTargetListenersStore(
  target: EventTargetLike,
  type: EventName,
): Listener[] | undefined {
  return ownedEventTargetListeners.get(target)?.get(type);
}

/** Upstream `lib/events.js:216`. */
export function getEventListeners(
  emitter: EventSource,
  type: EventName,
): Listener[];
export function getEventListeners(
  emitter: unknown,
  type: EventName,
): Listener[] {
  if (eventSourceIsEmitter(emitter)) {
    return emitter.listeners(type);
  }
  if (isEventTargetLike(emitter)) {
    return copyOwnedEventTargetListeners(emitter, type);
  }
  throw new ERR_INVALID_ARG_TYPE(
    "emitter",
    ["EventEmitter", "EventTarget"],
    emitter,
  );
}

export function getMaxListeners(emitter: EventSource): number;
export function getMaxListeners(emitter: unknown): number {
  if (eventSourceIsEmitter(emitter)) {
    return emitter.getMaxListeners();
  }
  if (isEventTargetLike(emitter)) {
    const configured = eventTargetMaxListeners.get(emitter);
    if (configured !== undefined) {
      return configured;
    }
    // AbortSignal is the one Node EventTarget whose default is unlimited.
    return "aborted" in emitter ? 0 : defaultMaxListeners;
  }
  throw new ERR_INVALID_ARG_TYPE(
    "emitter",
    ["EventEmitter", "EventTarget"],
    emitter,
  );
}

export function listenerCount(emitter: EventSource, type: EventName): number;
export function listenerCount(emitter: unknown, type: EventName): number {
  if (eventSourceIsEmitter(emitter)) {
    return emitter.listenerCount(type);
  }
  if (isEventTargetLike(emitter)) {
    return ownedEventTargetListenersStore(emitter, type)?.length ?? 0;
  }
  throw new ERR_INVALID_ARG_TYPE(
    "emitter",
    ["EventEmitter", "EventTarget"],
    emitter,
  );
}

export function setMaxListeners(n?: number, ...targets: EventSource[]): void {
  EventEmitter.setMaxListeners(n, ...targets);
}

export interface OnceOptions {
  signal?: AbortSignalLike | undefined;
}

type TrackedEventTarget = EventTargetLike | AbortSignalLike;

/**
 * Listeners installed by this module on an EventTarget.
 *
 * Node can inspect its internal EventTarget registry. This profile cannot, but
 * it can account exactly for listeners it owns, which is enough for cleanup
 * and for `listenerCount(signal, "abort")` around `once`.
 */
const ownedEventTargetListeners =
  new Map<TrackedEventTarget, Map<EventName, Listener[]>>();

function eventSourceIsEmitter(source: unknown): source is EventEmitter {
  return source instanceof EventEmitter;
}

function trackEventTargetListener(
  target: TrackedEventTarget,
  type: EventName,
  listener: Listener,
): void {
  let events = ownedEventTargetListeners.get(target);
  if (events === undefined) {
    events = new Map<EventName, Listener[]>();
    ownedEventTargetListeners.set(target, events);
  }
  const current = events.get(type);
  if (current === undefined) {
    events.set(type, [listener]);
    return;
  }
  const next = new Array<Listener>(current.length + 1);
  for (let i = 0; i < current.length; i++) {
    next[i] = eventListenerAt(current, i);
  }
  next[current.length] = listener;
  events.set(type, next);
}

function untrackEventTargetListener(
  target: TrackedEventTarget,
  type: EventName,
  listener: Listener,
): void {
  const events = ownedEventTargetListeners.get(target);
  const current = events?.get(type);
  if (events === undefined || current === undefined) {
    return;
  }
  let found = -1;
  for (let i = current.length - 1; i >= 0; i--) {
    if (current[i] === listener) {
      found = i;
      break;
    }
  }
  if (found < 0) {
    return;
  }
  if (current.length === 1) {
    events.delete(type);
    if (events.size === 0) {
      ownedEventTargetListeners.delete(target);
    }
    return;
  }
  const next = new Array<Listener>(current.length - 1);
  let destination = 0;
  for (let source = 0; source < current.length; source++) {
    if (source !== found) {
      next[destination] = eventListenerAt(current, source);
      destination += 1;
    }
  }
  events.set(type, next);
}

function addEventSourceListener(
  source: EventSource,
  type: EventName,
  listener: Listener,
  onceOnly: boolean,
): void {
  if (eventSourceIsEmitter(source)) {
    if (onceOnly) {
      source.once(type, listener);
    } else {
      source.on(type, listener);
    }
    return;
  }
  if (typeof source.addEventListener !== "function") {
    throw new ERR_INVALID_ARG_TYPE(
      "emitter",
      ["EventEmitter", "EventTarget"],
      source,
    );
  }
  source.addEventListener(type, listener, onceOnly ? { once: true } : undefined);
  trackEventTargetListener(source, type, listener);
}

function removeEventSourceListener(
  source: EventSource,
  type: EventName,
  listener: Listener,
): void {
  if (eventSourceIsEmitter(source)) {
    source.removeListener(type, listener);
    return;
  }
  if (typeof source.removeEventListener !== "function") {
    throw new ERR_INVALID_ARG_TYPE(
      "emitter",
      ["EventEmitter", "EventTarget"],
      source,
    );
  }
  source.removeEventListener(type, listener);
  untrackEventTargetListener(source, type, listener);
}

/**
 * `events.once(emitter, name)`, upstream `lib/events.js`.
 *
 * Resolves with the arguments of the next matching event, or rejects on
 * `error`. It is a promise, so it needs the runtime's promise support; the
 * shape is here so that it arrives complete rather than as an afterthought.
 */
export function once(
  emitter: EventSource,
  name: EventName,
  options: OnceOptions = {},
): Promise<unknown[]> {
  try {
    validateObject(options, "options");
    validateAbortSignal(options.signal, "options.signal");
  } catch (error) {
    return Promise.reject(error);
  }

  const signal = options.signal;
  if (signal?.aborted) {
    return Promise.reject(
      new AbortError("The operation was aborted", { cause: signal.reason }),
    );
  }

  return new Promise<unknown[]>((resolve, reject) => {
    const eventListener = (...args: unknown[]): void => {
      removeEventSourceListener(emitter, name, eventListener);
      if (errorListener !== undefined && eventSourceIsEmitter(emitter)) {
        emitter.removeListener("error", errorListener);
      }
      if (signal !== undefined) {
        signal.removeEventListener("abort", abortListener);
        untrackEventTargetListener(signal, "abort", abortListener);
      }
      resolve(args);
    };
    let errorListener: Listener | undefined;

    // An `error` while waiting rejects, unless `error` is what we are waiting
    // for. Upstream makes the same exception.
    if (name !== "error") {
      errorListener = (err: unknown): void => {
        removeEventSourceListener(emitter, name, eventListener);
        if (signal !== undefined) {
          signal.removeEventListener("abort", abortListener);
          untrackEventTargetListener(signal, "abort", abortListener);
        }
        reject(err);
      };
      if (eventSourceIsEmitter(emitter)) {
        emitter.once("error", errorListener);
      }
    }

    const abortListener = (): void => {
      removeEventSourceListener(emitter, name, eventListener);
      if (errorListener !== undefined && eventSourceIsEmitter(emitter)) {
        emitter.removeListener("error", errorListener);
      }
      if (signal !== undefined) {
        signal.removeEventListener("abort", abortListener);
        untrackEventTargetListener(signal, "abort", abortListener);
      }
      reject(
        new AbortError("The operation was aborted", { cause: signal?.reason }),
      );
    };

    addEventSourceListener(emitter, name, eventListener, true);
    if (signal !== undefined) {
      signal.addEventListener("abort", abortListener, { once: true });
      trackEventTargetListener(signal, "abort", abortListener);
    }
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

/**
 * Where the queue's state is visible from outside.
 *
 * `Symbol.for` rather than `Symbol`, because it is a cross-realm agreement:
 * anything that wants to see whether an iterator is holding events back has to
 * be able to name the slot without importing this module.
 */
declare const kWatermarkDataType: unique symbol;
export const kWatermarkData: typeof kWatermarkDataType =
  Symbol.for("nodejs.watermarkData") as typeof kWatermarkDataType;

export interface OnOptions {
  signal?: AbortSignalLike | undefined;
  /** Pause the emitter once this many events are waiting. */
  highWaterMark?: number | undefined;
  /** Backwards-compatible spelling retained by Node. */
  highWatermark?: number | undefined;
  /** Resume it once fewer than this many are. */
  lowWaterMark?: number | undefined;
  /** Backwards-compatible spelling retained by Node. */
  lowWatermark?: number | undefined;
  /** Additional events that finish the iterator. */
  close?: readonly EventName[] | undefined;
  [kFirstEventParam]?: boolean | undefined;
}

/** Options proving that `on` yields the event's first argument directly. */
export interface FirstEventOnOptions extends OnOptions {
  [kFirstEventParam]: true;
}

interface PendingEventPromise {
  resolve(result: IteratorResult<unknown>): void;
  reject(error: unknown): void;
}

class QueueNode<T> {
  readonly value: T;
  next: QueueNode<T> | undefined = undefined;

  constructor(value: T) {
    this.value = value;
  }
}

/** A FIFO that releases each consumed entry and never grows an array. */
class EventQueue<T> {
  private head: QueueNode<T> | undefined = undefined;
  private tail: QueueNode<T> | undefined = undefined;
  size = 0;

  enqueue(value: T): void {
    const node = new QueueNode(value);
    const tail = this.tail;
    if (tail === undefined) {
      this.head = node;
    } else {
      tail.next = node;
    }
    this.tail = node;
    this.size += 1;
  }

  dequeue(): T {
    const head = this.head;
    if (head === undefined) {
      throw new Error("EventEmitter async-iterator queue invariant violated");
    }
    const next = head.next;
    this.head = next;
    if (next === undefined) {
      this.tail = undefined;
    }
    this.size -= 1;
    return head.value;
  }
}

interface WatermarkData {
  readonly size: number;
  readonly low: number;
  readonly high: number;
  readonly isPaused: boolean;
}

interface EventAsyncIterator extends AsyncIterableIterator<unknown> {
  readonly [kWatermarkData]: WatermarkData;
}

function pauseEventSource(source: EventSource): boolean {
  if ("pause" in source && typeof source.pause === "function") {
    source.pause();
    return true;
  }
  return false;
}

function resumeEventSource(source: EventSource): void {
  if ("resume" in source && typeof source.resume === "function") {
    source.resume();
  }
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
export function on<T>(
  emitter: EventSource,
  event: EventName,
  options: FirstEventOnOptions,
): AsyncIterableIterator<T>;
export function on(
  emitter: EventSource,
  event: EventName,
  options?: OnOptions,
): AsyncIterableIterator<unknown>;
export function on(
  emitter: EventSource,
  event: EventName,
  options: OnOptions = {},
): AsyncIterableIterator<unknown> {
  validateObject(options, "options");
  const signal = options.signal;
  if (signal !== undefined && signal !== null) {
    if (typeof signal.addEventListener !== "function") {
      throw new ERR_INVALID_ARG_TYPE("options.signal", "AbortSignal", signal);
    }
    if (signal.aborted) {
      throw new AbortError("The operation was aborted", { cause: signal.reason });
    }
  }

  // Unbounded by default, because `on` is also used on emitters that cannot be
  // paused and pausing one that cannot would be worse than queueing.
  const highWaterMark = options.highWaterMark ??
    options.highWatermark ??
    Number.MAX_SAFE_INTEGER;
  validateInteger(highWaterMark, "options.highWaterMark", 1);
  const lowWaterMark = options.lowWaterMark ?? options.lowWatermark ?? 1;
  validateInteger(lowWaterMark, "options.lowWaterMark", 1);

  const unconsumedEvents = new EventQueue<unknown>();
  const unconsumedPromises = new EventQueue<PendingEventPromise>();

  let paused = false;
  let error: unknown = null;
  let finished = false;

  function closeHandler(): Promise<IteratorResult<unknown>> {
    if (signal) {
      signal.removeEventListener("abort", abortListener);
      untrackEventTargetListener(signal, "abort", abortListener);
    }
    removeEventSourceListener(emitter, event, listener);
    if (event !== "error" && eventSourceIsEmitter(emitter)) {
      emitter.removeListener("error", errorHandler);
    }
    for (const name of closeEvents) {
      removeEventSourceListener(emitter, name, closeHandler);
    }
    finished = true;
    paused = false;
    const result: IteratorResult<unknown> = { value: undefined, done: true };
    while (unconsumedPromises.size > 0) {
      unconsumedPromises.dequeue().resolve(result);
    }
    return Promise.resolve(result);
  }

  function eventHandler(value: unknown): void {
    if (unconsumedPromises.size === 0) {
      unconsumedEvents.enqueue(value);
      if (!paused && unconsumedEvents.size > highWaterMark) {
        paused = pauseEventSource(emitter);
      }
      return;
    }
    unconsumedPromises.dequeue().resolve({ value, done: false });
  }

  function errorHandler(err: unknown): void {
    if (unconsumedPromises.size === 0) error = err;
    else {
      unconsumedPromises.dequeue().reject(err);
    }
    void closeHandler();
  }

  function abortListener(): void {
    errorHandler(
      new AbortError("The operation was aborted", { cause: signal?.reason }),
    );
  }

  const first = options[kFirstEventParam] === true;
  const listener = first
    ? (value: unknown): void => eventHandler(value)
    : (...args: unknown[]): void => eventHandler(args);

  addEventSourceListener(emitter, event, listener, false);
  if (event !== "error" && eventSourceIsEmitter(emitter)) {
    emitter.on("error", errorHandler);
  }
  const closeEvents = options.close ?? [];
  for (const name of closeEvents) {
    addEventSourceListener(emitter, name, closeHandler, false);
  }
  if (signal) {
    signal.addEventListener("abort", abortListener, { once: true });
    trackEventTargetListener(signal, "abort", abortListener);
  }

  const iterator: EventAsyncIterator = {
    next(): Promise<IteratorResult<unknown>> {
      if (unconsumedEvents.size > 0) {
        const value = unconsumedEvents.dequeue();
        // Released only once the backlog is genuinely small, not at the first
        // free slot: resuming at the high mark would pause and resume on every
        // single event.
        if (paused && unconsumedEvents.size < lowWaterMark) {
          paused = false;
          resumeEventSource(emitter);
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
        unconsumedPromises.enqueue({ resolve, reject });
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
      return Promise.resolve({ value: undefined, done: true });
    },

    [Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
      return iterator;
    },

    // Observable rather than private, because backpressure that cannot be
    // seen cannot be tested: whether the emitter is currently held back is a
    // fact about the queue, and the only way to check it from outside is to
    // ask.
    [kWatermarkData]: {
      get size(): number { return unconsumedEvents.size; },
      get low(): number { return lowWaterMark; },
      get high(): number { return highWaterMark; },
      get isPaused(): boolean { return paused; },
    },
  };

  return iterator;
}

export default EventEmitter;
