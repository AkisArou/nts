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
  ERR_INVALID_ARG_TYPE,
  ERR_UNHANDLED_ERROR,
  inspectValue,
} from "../../internal/errors.ts";
import { validateFunction, validateNumberRange } from "../../internal/validators.ts";

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
    if (options?.captureRejections !== undefined) {
      // Rejection capture turns a rejected promise returned by a listener into
      // an `error` event. It needs promises, so it is refused rather than
      // ignored: a program that asked for it and did not get it would lose
      // errors silently.
      throw new ERR_INVALID_ARG_TYPE("options.captureRejections", "undefined", options.captureRejections);
    }
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
      handler.apply(this, args);
    } else {
      // A copy, because a listener may add or remove listeners while running
      // and upstream's contract is that `emit` calls the set present when it
      // started.
      const copy = handler.slice();
      for (const listener of copy) {
        listener.apply(this, args);
      }
    }
    return true;
  }

  /** The symbol whose listeners see an `error` before it is thrown. */
  static readonly errorMonitor: unique symbol = Symbol("events.errorMonitor");

  static readonly captureRejectionSymbol: unique symbol = Symbol.for("nodejs.rejection");
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
  const error = new ERR_UNHANDLED_ERROR(first === undefined ? undefined : inspectValue(first));
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

export default EventEmitter;
