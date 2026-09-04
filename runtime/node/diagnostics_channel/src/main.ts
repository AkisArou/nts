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
  }

  unsubscribe(subscription: Subscriber): boolean {
    const index = this.#subscribers.indexOf(subscription);
    if (index === -1) return false;
    this.#subscribers = [
      ...this.#subscribers.slice(0, index),
      ...this.#subscribers.slice(index + 1),
    ];
    return true;
  }

  bindStore(store: Store, transform?: Transform): void {
    this.#stores.set(store, transform ?? defaultTransform);
  }

  unbindStore(store: Store): boolean {
    return this.#stores.delete(store);
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
      try {
        subscribers[i]!(message, this.name);
      } catch (err) {
        triggerUncaughtException(err);
      }
    }
  }

  /**
   * Publish, then run `fn` inside every bound store's context.
   *
   * The stores are entered from the inside out, so the first bound store is
   * the outermost -- which is what makes nesting two of them predictable.
   */
  runStores<T>(message: unknown, fn: (...args: never[]) => T, thisArg?: unknown, ...args: unknown[]): T {
    let run = (): T => {
      this.publish(message);
      return Reflect.apply(fn, thisArg, args) as T;
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
const traceEvents = ["start", "end", "asyncStart", "asyncEnd", "error"] as const;
type TraceEvent = (typeof traceEvents)[number];

export type TracingChannelSubscribers = Partial<Record<TraceEvent, Subscriber>>;
export type TracingChannels = Record<TraceEvent, Channel>;

function assertChannel(value: unknown, name: string): asserts value is Channel {
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
    const found = nameOrChannels[name];
    assertChannel(found, `nameOrChannels.${name}`);
    return found;
  }

  throw new ERR_INVALID_ARG_TYPE(
    "nameOrChannels",
    ["string", "object", "TracingChannel"],
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
    for (const eventName of traceEvents) {
      Object.defineProperty(this, eventName, {
        __proto__: null,
        value: tracingChannelFrom(nameOrChannels, eventName),
      } as PropertyDescriptor);
    }
  }

  get hasSubscribers(): boolean {
    return this.start.hasSubscribers ||
      this.end.hasSubscribers ||
      this.asyncStart.hasSubscribers ||
      this.asyncEnd.hasSubscribers ||
      this.error.hasSubscribers;
  }

  subscribe(handlers: TracingChannelSubscribers): void {
    for (const name of traceEvents) {
      const handler = handlers[name];
      if (!handler) continue;
      this[name].subscribe(handler);
    }
  }

  unsubscribe(handlers: TracingChannelSubscribers): boolean {
    let done = true;
    for (const name of traceEvents) {
      const handler = handlers[name];
      if (!handler) continue;
      if (!this[name].unsubscribe(handler)) {
        done = false;
      }
    }
    return done;
  }

  /** A synchronous call, traced. `context` accumulates the result or error. */
  traceSync<T>(
    fn: (...args: never[]) => T,
    context: Record<string, unknown> = {},
    thisArg?: unknown,
    ...args: unknown[]
  ): T {
    if (!this.hasSubscribers) {
      return Reflect.apply(fn, thisArg, args) as T;
    }

    const { start, end, error } = this;

    return start.runStores(context, () => {
      try {
        const result = Reflect.apply(fn, thisArg, args) as T;
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
  tracePromise<T>(
    fn: (...args: never[]) => Promise<T>,
    context: Record<string, unknown> = {},
    thisArg?: unknown,
    ...args: unknown[]
  ): Promise<T> {
    if (!this.hasSubscribers) {
      return Reflect.apply(fn, thisArg, args) as Promise<T>;
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
        let promise = Reflect.apply(fn, thisArg, args) as Promise<T>;
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
  traceCallback<T>(
    fn: (...args: never[]) => T,
    position = -1,
    context: Record<string, unknown> = {},
    thisArg?: unknown,
    ...args: unknown[]
  ): T {
    if (!this.hasSubscribers) {
      return Reflect.apply(fn, thisArg, args) as T;
    }

    const { start, end, asyncStart, asyncEnd, error } = this;

    const callback = args.at(position);
    validateFunction(callback, "callback");

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
          return Reflect.apply(callback as (...a: never[]) => unknown, self, callbackArgs);
        } finally {
          asyncEnd.publish(context);
        }
      });
    }

    args.splice(position, 1, wrappedCallback);

    return start.runStores(context, () => {
      try {
        return Reflect.apply(fn, thisArg, args) as T;
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

export function tracingChannel(
  nameOrChannels: string | Partial<TracingChannels>,
): TracingChannel {
  return new TracingChannel(nameOrChannels);
}
