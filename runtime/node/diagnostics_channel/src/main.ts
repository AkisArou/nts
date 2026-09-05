// `node:diagnostics_channel`, from node v24.20.0 `lib/diagnostics_channel.js`.
//
// A named publish/subscribe point. A library publishes to a channel whether or
// not anyone listens, and the cost when nobody does has to be near zero --
// that constraint is why `hasSubscribers` exists and why callers guard on it
// rather than building an event object first.
//
// `node:console` is the first caller here: `console.log` publishes its raw
// arguments before formatting them, so a subscriber sees what was logged
// rather than what it looked like.

import { ERR_INVALID_ARG_TYPE } from "../../internal/errors.ts";
import { validateFunction } from "../../internal/validators.ts";
import { triggerUncaughtException } from "../../internal/tick.ts";

/** What a subscriber is handed: the published value and the channel's name. */
export type Subscriber = (message: unknown, name: string | symbol) => void;

/**
 * Anything with `run(context, fn)`: `AsyncLocalStorage` is the one node ships,
 * but the channel does not need to know that.
 */
export interface Store {
  run<T>(context: unknown, fn: () => T): T;
}

export type Transform = (message: unknown) => unknown;

function defaultTransform(data: unknown): unknown {
  return data;
}

/** Invoke a callback with the receiver and argument tuple supplied by the caller. */
function apply<A extends unknown[], T>(
  fn: (...args: A) => T,
  thisArg: unknown,
  args: A,
): T {
  return fn.apply(thisArg, args);
}

/**
 * A named channel.
 *
 * Node has two classes here and swaps an instance's prototype between them as
 * its first subscriber arrives and its last leaves, so that the common case --
 * publishing to a channel nobody listens to -- reaches a `publish` that is an
 * empty function. That is a V8 inline-cache trick with no semantic content,
 * and it is the reason node also has to define `Symbol.hasInstance`. One class
 * with a `#subscribers` array that is empty until someone subscribes says the
 * same thing; the branch in `publish` costs a length check.
 */
export class Channel {
  readonly name: string | symbol;
  #subscribers: Subscriber[] = [];
  #stores = new Map<Store, Transform>();
  /** Set when a native channel of the same name is linked to this one. */
  _index: number | undefined = undefined;

  constructor(name: string | symbol) {
    this.name = name;
    channels.set(name, this);
  }

  get hasSubscribers(): boolean {
    return this.#subscribers.length > 0 || this.#stores.size > 0;
  }

  subscribe(subscription: Subscriber): void {
    validateFunction(subscription, "subscription");
    // A fresh array rather than a push, so that a subscriber added or removed
    // during a `publish` does not change the list that publish is walking.
    this.#subscribers = [...this.#subscribers, subscription];
    channels.incRef(this.name);
  }

  unsubscribe(subscription: Subscriber): boolean {
    const index = this.#subscribers.indexOf(subscription);
    if (index === -1) return false;
    this.#subscribers = [
      ...this.#subscribers.slice(0, index),
      ...this.#subscribers.slice(index + 1),
    ];
    channels.decRef(this.name);
    return true;
  }

  bindStore(store: Store, transform?: Transform): void {
    if (!this.#stores.has(store)) {
      channels.incRef(this.name);
    }
    this.#stores.set(store, transform ?? defaultTransform);
  }

  unbindStore(store: Store): boolean {
    if (!this.#stores.delete(store)) return false;
    channels.decRef(this.name);
    return true;
  }

  /**
   * Hand `message` to every subscriber.
   *
   * A subscriber that throws does not stop the others and does not reach the
   * publisher: the publisher is instrumented code that never asked to handle a
   * listener's bug. The error surfaces on the next tick instead.
   */
  publish(message?: unknown): void {
    const subscribers = this.#subscribers;
    for (let i = 0; i < subscribers.length; i++) {
      const subscriber = subscribers[i];
      if (subscriber === undefined) continue;
      try {
        subscriber(message, this.name);
      } catch (err) {
        triggerUncaughtException(err);
      }
    }
  }

  /**
   * Publish, then run `fn` inside every bound store's context.
   *
   * Each bound store wraps the chain built so far, so the most recently bound
   * store is outermost and the first bound store is nearest the callback.
   */
  runStores<A extends unknown[], T>(
    message: unknown,
    fn: (...args: A) => T,
    thisArg?: unknown,
    ...args: A
  ): T {
    let run = (): T => {
      this.publish(message);
      return fn.apply(thisArg, args);
    };

    for (const [store, transform] of this.#stores.entries()) {
      const next = run;
      run = (): T => {
        let context: unknown;
        try {
          context = transform(message);
        } catch (err) {
          // A broken transform must not lose the call it was wrapping.
          triggerUncaughtException(err);
          return next();
        }
        return store.run(context, next);
      };
    }

    return run();
  }
}

/**
 * The channel registry, holding channels weakly.
 *
 * A channel that nobody has a reference to and nobody subscribes to is dead
 * weight, and a long-running process that names channels dynamically would
 * otherwise leak one per name. The finalizer clears the entry only if nothing
 * has taken the name in the meantime -- finalization is not synchronous with
 * collection, so the name may already belong to a newer channel.
 */
class WeakRefMap {
  #map = new Map<string | symbol, WeakRef<Channel>>();
  // Node's internal WeakReference has incRef/decRef. Ordinary WeakRef does
  // not, so active channels are retained explicitly until their last
  // subscriber or store is removed.
  #active = new Map<string | symbol, Channel>();
  #refs = new Map<string | symbol, number>();
  #finalizers = new FinalizationRegistry<string | symbol>((key) => {
    if (this.#map.get(key)?.deref() === undefined) {
      this.#map.delete(key);
    }
  });

  set(key: string | symbol, value: Channel): void {
    this.#finalizers.register(value, key);
    this.#map.set(key, new WeakRef(value));
  }

  get(key: string | symbol): Channel | undefined {
    return this.#map.get(key)?.deref();
  }

  has(key: string | symbol): boolean {
    return this.get(key) !== undefined;
  }

  incRef(key: string | symbol): void {
    const value = this.get(key);
    if (!value) return;

    const refs = this.#refs.get(key) ?? 0;
    if (refs === 0) this.#active.set(key, value);
    this.#refs.set(key, refs + 1);
  }

  decRef(key: string | symbol): void {
    const refs = this.#refs.get(key);
    if (refs === undefined) return;

    if (refs === 1) {
      this.#refs.delete(key);
      this.#active.delete(key);
    } else {
      this.#refs.set(key, refs - 1);
    }
  }
}

const channels = new WeakRefMap();

/** The channel with this name, created on first ask. Always the same object. */
export function channel(name: string | symbol): Channel {
  const existing = channels.get(name);
  if (existing) return existing;

  if (typeof name !== "string" && typeof name !== "symbol") {
    throw new ERR_INVALID_ARG_TYPE("channel", ["string", "symbol"], name);
  }

  return new Channel(name);
}

export function subscribe(name: string | symbol, subscription: Subscriber): void {
  channel(name).subscribe(subscription);
}

export function unsubscribe(name: string | symbol, subscription: Subscriber): boolean {
  return channel(name).unsubscribe(subscription);
}

/** False without creating the channel: asking must not cost an allocation. */
export function hasSubscribers(name: string | symbol): boolean {
  return channels.get(name)?.hasSubscribers ?? false;
}

// ------------------------------------------------------------ tracing

/** The five moments a traced call passes through. */
type TraceEvent = "start" | "end" | "asyncStart" | "asyncEnd" | "error";

export interface TracingChannelSubscribers {
  start?: Subscriber | undefined;
  end?: Subscriber | undefined;
  asyncStart?: Subscriber | undefined;
  asyncEnd?: Subscriber | undefined;
  error?: Subscriber | undefined;
}

export interface TracingChannels {
  start: Channel;
  end: Channel;
  asyncStart: Channel;
  asyncEnd: Channel;
  error: Channel;
}

function assertChannel(value: unknown, name: string): asserts value is Channel {
  // Node's excluded Symbol.hasInstance hook calls Object.getPrototypeOf first,
  // and that operation supplies this observable error for a missing value.
  // Preserve the API result with an ordinary static check.
  if (value === undefined || value === null) {
    throw new TypeError("Cannot convert undefined or null to object");
  }
  if (!(value instanceof Channel)) {
    throw new ERR_INVALID_ARG_TYPE(name, ["Channel"], value);
  }
}

function tracingChannelFrom(
  nameOrChannels: string | Partial<TracingChannels>,
  name: TraceEvent,
): Channel {
  if (typeof nameOrChannels === "string") {
    return channel(`tracing:${nameOrChannels}:${name}`);
  }

  if (typeof nameOrChannels === "object" && nameOrChannels !== null) {
    let found: Channel | undefined;
    switch (name) {
      case "start": found = nameOrChannels.start; break;
      case "end": found = nameOrChannels.end; break;
      case "asyncStart": found = nameOrChannels.asyncStart; break;
      case "asyncEnd": found = nameOrChannels.asyncEnd; break;
      case "error": found = nameOrChannels.error; break;
    }
    assertChannel(found, `nameOrChannels.${name}`);
    return found;
  }

  throw new ERR_INVALID_ARG_TYPE(
    "nameOrChannels",
    ["string", "TracingChannel", "Object"],
    nameOrChannels,
  );
}

/**
 * Five channels moved as one, so that a caller instruments a whole operation
 * rather than remembering to publish at each of its edges.
 */
export class TracingChannel {
  declare readonly start: Channel;
  declare readonly end: Channel;
  declare readonly asyncStart: Channel;
  declare readonly asyncEnd: Channel;
  declare readonly error: Channel;

  constructor(nameOrChannels: string | Partial<TracingChannels>) {
    this.start = tracingChannelFrom(nameOrChannels, "start");
    this.end = tracingChannelFrom(nameOrChannels, "end");
    this.asyncStart = tracingChannelFrom(nameOrChannels, "asyncStart");
    this.asyncEnd = tracingChannelFrom(nameOrChannels, "asyncEnd");
    this.error = tracingChannelFrom(nameOrChannels, "error");
  }

  get hasSubscribers(): boolean {
    return (
      this.start.hasSubscribers ||
      this.end.hasSubscribers ||
      this.asyncStart.hasSubscribers ||
      this.asyncEnd.hasSubscribers ||
      this.error.hasSubscribers
    );
  }

  subscribe(handlers: TracingChannelSubscribers): void {
    if (handlers.start) this.start.subscribe(handlers.start);
    if (handlers.end) this.end.subscribe(handlers.end);
    if (handlers.asyncStart) this.asyncStart.subscribe(handlers.asyncStart);
    if (handlers.asyncEnd) this.asyncEnd.subscribe(handlers.asyncEnd);
    if (handlers.error) this.error.subscribe(handlers.error);
  }

  unsubscribe(handlers: TracingChannelSubscribers): boolean {
    let done = true;
    if (handlers.start && !this.start.unsubscribe(handlers.start)) done = false;
    if (handlers.end && !this.end.unsubscribe(handlers.end)) done = false;
    if (handlers.asyncStart && !this.asyncStart.unsubscribe(handlers.asyncStart)) done = false;
    if (handlers.asyncEnd && !this.asyncEnd.unsubscribe(handlers.asyncEnd)) done = false;
    if (handlers.error && !this.error.unsubscribe(handlers.error)) done = false;
    return done;
  }

  /** A synchronous call, traced. `context` accumulates the result or error. */
  traceSync<A extends unknown[], T>(
    fn: (...args: A) => T,
    context: Record<string, unknown> = {},
    thisArg?: unknown,
    ...args: A
  ): T {
    if (!this.hasSubscribers) {
      return apply(fn, thisArg, args);
    }

    const { start, end, error } = this;

    return start.runStores(context, () => {
      try {
        const result = apply(fn, thisArg, args);
        context["result"] = result;
        return result;
      } catch (err) {
        context["error"] = err;
        error.publish(context);
        throw err;
      } finally {
        end.publish(context);
      }
    });
  }

  /**
   * A promise-returning call, traced.
   *
   * `end` fires when the function returns, `asyncStart`/`asyncEnd` when the
   * promise settles -- which is the distinction the two pairs exist to draw.
   */
  tracePromise<A extends unknown[], T>(
    fn: (...args: A) => Promise<T>,
    context: Record<string, unknown> = {},
    thisArg?: unknown,
    ...args: A
  ): Promise<T> {
    if (!this.hasSubscribers) {
      return apply(fn, thisArg, args);
    }

    const { start, end, asyncStart, asyncEnd, error } = this;

    function reject(err: unknown): Promise<never> {
      context["error"] = err;
      error.publish(context);
      asyncStart.publish(context);
      asyncEnd.publish(context);
      return Promise.reject(err);
    }

    function resolve(result: T): T {
      context["result"] = result;
      asyncStart.publish(context);
      asyncEnd.publish(context);
      return result;
    }

    return start.runStores(context, () => {
      try {
        let promise = apply(fn, thisArg, args);
        // A thenable is not a promise, and `then` on it is not ours to trust.
        if (!(promise instanceof Promise)) {
          promise = Promise.resolve(promise);
        }
        return promise.then(resolve, reject);
      } catch (err) {
        context["error"] = err;
        error.publish(context);
        throw err;
      } finally {
        end.publish(context);
      }
    });
  }

  /**
   * A callback-taking call, traced. `position` is where the callback sits in
   * the argument list; `-1`, the default, means last.
   */
  traceCallback<A extends unknown[], T>(
    fn: (...args: A) => T,
    position?: number,
    context?: Record<string, unknown>,
    thisArg?: unknown,
    ...args: A
  ): T;
  traceCallback(
    fn: (...args: unknown[]) => unknown,
    position = -1,
    context: Record<string, unknown> = {},
    thisArg?: unknown,
    ...args: unknown[]
  ): unknown {
    if (!this.hasSubscribers) {
      return fn.apply(thisArg, args);
    }

    const { start, end, asyncStart, asyncEnd, error } = this;

    const callback = args.at(position);
    if (typeof callback !== "function") {
      throw new ERR_INVALID_ARG_TYPE("callback", "Function", callback);
    }
    const checkedCallback = callback;

    function wrappedCallback(this: unknown, ...callbackArgs: unknown[]): unknown {
      const err = callbackArgs[0];
      if (err) {
        context["error"] = err;
        error.publish(context);
      } else {
        context["result"] = callbackArgs[1];
      }

      // Through `runStores` rather than `publish`, so a subscriber can restore
      // a context that was lost across the asynchronous gap.
      const self = this;
      return asyncStart.runStores(context, () => {
        try {
          return checkedCallback.apply(self, callbackArgs);
        } finally {
          asyncEnd.publish(context);
        }
      });
    }

    const callArgs: unknown[] = [...args];
    callArgs.splice(position, 1, wrappedCallback);

    return start.runStores(context, () => {
      try {
        return fn.apply(thisArg, callArgs);
      } catch (err) {
        context["error"] = err;
        error.publish(context);
        throw err;
      } finally {
        end.publish(context);
      }
    });
  }
}

export function tracingChannel(nameOrChannels: string | Partial<TracingChannels>): TracingChannel {
  return new TracingChannel(nameOrChannels);
}
