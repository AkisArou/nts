// `node:timers/promises`, from node v24.20.0 `lib/timers/promises.js`.
//
// Not `promisify` applied to the callback forms. A promisified `setTimeout`
// would resolve with the timer handle and give the caller no way to cancel;
// these take an `AbortSignal` instead, which is what a caller actually needs
// when the thing being waited for may stop being interesting.
//
// The cancellation path is the whole of the difficulty. A signal that fires
// must reject the promise *and* cancel the timer, and a timer that fires must
// remove the listener -- otherwise a long-lived signal accumulates one
// listener per elapsed wait, which is a leak that only shows up under load.
//
// One thing here is node's and cannot be reproduced: node passes a private
// symbol to `addEventListener` that makes its abort listener survive
// `stopPropagation` from another listener on the same signal. The symbol
// belongs to node's `EventTarget` implementation, which this profile does not
// have, so a program that calls `stopPropagation` in an abort listener
// registered before ours will see the wait hang rather than reject. That is
// the only difference, and it is a property of the event target rather than of
// these functions.

import { AbortError, ERR_ILLEGAL_CONSTRUCTOR, ERR_INVALID_THIS } from "../../internal/errors.ts";
import {
  validateAbortSignal,
  validateBoolean,
  validateNumber,
  validateObject,
} from "../../internal/validators.ts";
import { Immediate, clearImmediate } from "./immediate.ts";
import { Timeout, clearTimeout, insert } from "./timeout.ts";

/**
 * As much of an `AbortSignal` as a wait touches.
 *
 * Declared here rather than taken from a DOM library because that is exactly
 * what `validateAbortSignal` accepts: anything with an `aborted` property. A
 * signal from a worker, a different realm, or a polyfill is a working signal,
 * and naming the concrete class in the type would be a stricter claim than the
 * code makes.
 */
export interface AbortSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(
    type: "abort",
    listener: () => void,
    options?: { once?: boolean },
  ): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

export interface TimerOptions {
  /** Cancels the wait, rejecting with an `AbortError`. */
  signal?: AbortSignal | undefined;
  /** Whether the pending wait should hold the process open. Default true. */
  ref?: boolean | undefined;
}

const kEmptyOptions: TimerOptions = {};

/** The shape shared by both waits, so the cancellation dance is written once. */
interface Cancellable {
  _destroyed: boolean;
}

/**
 * Wire a signal to a pending wait, and give back the promise to return.
 *
 * Both waits need exactly this: reject and cancel when the signal fires, and
 * detach the listener however the wait ends. Written once because getting the
 * detach wrong is invisible until a program has run for a while.
 */
function withCancellation<T, Handle extends Cancellable>(
  promise: Promise<T>,
  handle: Handle,
  cancel: (handle: Handle) => void,
  reject: (reason: unknown) => void,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) return promise;

  const onAbort = (): void => {
    // A wait that already finished has nothing to cancel, and rejecting it
    // now would be rejecting a settled promise -- harmless, but it would also
    // cancel a *reused* handle if one had taken its place.
    if (!handle._destroyed) {
      cancel(handle);
      reject(new AbortError(undefined, { cause: signal.reason }));
    }
  };

  signal.addEventListener("abort", onAbort);
  return promise.finally(() => signal.removeEventListener("abort", onAbort));
}

/** Reject rather than throw, so a bad argument is a rejected promise. */
function checkOptions(options: TimerOptions): void {
  validateObject(options, "options");
  if (options.signal !== undefined) validateAbortSignal(options.signal, "options.signal");
  if (options.ref !== undefined) validateBoolean(options.ref, "options.ref");
}

/**
 * Resolve with `value` after `after` milliseconds.
 *
 * Errors come back as a rejected promise rather than being thrown, because
 * this function is nearly always called in an `await` position and a caller
 * who wrote `await setTimeout(...)` inside a `try` expects both kinds of
 * failure to land in the same `catch`.
 */
export function setTimeout(after?: number): Promise<void>;
export function setTimeout<T>(
  after: number | undefined,
  value: T,
  options?: TimerOptions,
): Promise<T>;
export function setTimeout<T>(
  after?: number,
  value?: T,
  options: TimerOptions = kEmptyOptions,
): Promise<T | undefined> {
  try {
    if (after !== undefined) validateNumber(after, "delay");
    checkOptions(options);
  } catch (err) {
    return Promise.reject(err);
  }

  const { signal, ref = true } = options;

  if (signal?.aborted) {
    return Promise.reject(new AbortError(undefined, { cause: signal.reason }));
  }

  const { promise, resolve, reject } = Promise.withResolvers<T | undefined>();
  const args: [T | undefined] = [value];
  const timeout = new Timeout(resolve, after, args, false, ref);
  insert(timeout, timeout._idleTimeout);
  return withCancellation(promise, timeout, clearTimeout, reject, signal);
}

/** Resolve with `value` on the next pass of the check phase. */
export function setImmediate(): Promise<void>;
export function setImmediate<T>(value: T, options?: TimerOptions): Promise<T>;
export function setImmediate<T>(
  value?: T,
  options: TimerOptions = kEmptyOptions,
): Promise<T | undefined> {
  try {
    checkOptions(options);
  } catch (err) {
    return Promise.reject(err);
  }

  const { signal, ref = true } = options;

  if (signal?.aborted) {
    return Promise.reject(new AbortError(undefined, { cause: signal.reason }));
  }

  const { promise, resolve, reject } = Promise.withResolvers<T | undefined>();
  const args: [T | undefined] = [value];
  const immediate = new Immediate(resolve, args);
  if (!ref) immediate.unref();
  return withCancellation(promise, immediate, clearImmediate, reject, signal);
}

/**
 * Yield `value` every `after` milliseconds, until the signal aborts.
 *
 * The counter is what makes this correct rather than merely working. A
 * consumer slower than the interval would otherwise miss ticks silently; here
 * every tick increments, and the loop yields once per tick even when several
 * accumulated while the consumer was away. Node calls it `notYielded`.
 */
export function setInterval(after?: number): AsyncGenerator<void, void, void>;
export function setInterval<T>(
  after: number | undefined,
  value: T,
  options?: TimerOptions,
): AsyncGenerator<T, void, void>;
export async function* setInterval<T>(
  after?: number,
  value?: T,
  options: TimerOptions = kEmptyOptions,
): AsyncGenerator<T | undefined, void, void> {
  if (after !== undefined) validateNumber(after, "delay");
  checkOptions(options);

  const { signal, ref = true } = options;

  if (signal?.aborted) {
    throw new AbortError(undefined, { cause: signal.reason });
  }

  let onCancel: (() => void) | undefined;
  let interval: Timeout | undefined;
  try {
    let pending = 0;
    let wake: ((value?: unknown) => void) | undefined;

    interval = new Timeout(
      () => {
        pending++;
        if (wake) {
          wake();
          wake = undefined;
        }
      },
      after,
      undefined,
      true,
      ref,
    );
    insert(interval, interval._idleTimeout);

    if (signal) {
      onCancel = () => {
        clearTimeout(interval);
        if (wake) {
          // Handed a rejected promise rather than called with a value: the
          // loop below awaits whatever this resolves with, so this is how the
          // abort reaches the awaiting consumer.
          wake(Promise.reject(new AbortError(undefined, { cause: signal.reason })));
          wake = undefined;
        }
      };
      signal.addEventListener("abort", onCancel, { once: true });
    }

    while (!signal?.aborted) {
      if (pending === 0) {
        await new Promise((resolve) => {
          wake = resolve;
        });
      }
      for (; pending > 0; pending--) {
        yield value;
      }
    }
    throw new AbortError(undefined, { cause: signal?.reason });
  } finally {
    // Reached however the generator ends, including a `break` in the caller's
    // `for await`, which is the common case and the one that would otherwise
    // leave an interval running forever.
    clearTimeout(interval);
    if (onCancel) signal?.removeEventListener("abort", onCancel);
  }
}

const kScheduler = Symbol("kScheduler");
const schedulerToken = {};

/**
 * The WICG scheduling API, as much of it as node exposes.
 *
 * Not constructible: there is one instance and it is this module's. The brand
 * check on every method is what makes the private constructor mean something
 * -- without it, `Object.create(Scheduler.prototype).wait(0)` would work and
 * the class would be a namespace with extra steps.
 */
class Scheduler {
  [kScheduler]?: boolean;

  constructor(token?: object) {
    if (token !== schedulerToken) throw new ERR_ILLEGAL_CONSTRUCTOR();
    this[kScheduler] = true;
  }

  /** Give the loop a turn, and resume on the next check phase. */
  yield(): Promise<void> {
    if (!this[kScheduler]) throw new ERR_INVALID_THIS("Scheduler");
    return setImmediate();
  }

  /** Resolve after `delay` milliseconds. */
  wait(delay?: number, options?: TimerOptions): Promise<void> {
    if (!this[kScheduler]) throw new ERR_INVALID_THIS("Scheduler");
    return setTimeout(delay, undefined, options);
  }
}

/**
 * The one instance. Its constructor requires a module-private token, so a
 * caller reaching the class through `scheduler.constructor` still cannot make
 * another one. This is the same invariant as node's `Reflect.construct`
 * scaffolding without requiring a runtime metaobject protocol.
 */
export const scheduler = new Scheduler(schedulerToken);
