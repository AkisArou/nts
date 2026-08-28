// The iterator helpers, for streams, from node v24.20.0
// `lib/internal/streams/operators.js`.
//
// `stream.map(fn)`, `.filter`, `.take`, `.reduce` and the rest: the array
// methods, over something that arrives over time. Two families, and the
// difference matters -- `map`, `filter`, `flatMap`, `drop` and `take` return
// another stream and stay lazy, while `reduce`, `toArray`, `some`, `every`,
// `find` and `forEach` return a promise and therefore consume the whole
// stream.
//
// `map` is the only one with real machinery; everything else is written in
// terms of it. Its complication is `concurrency`: a mapper doing I/O should be
// allowed to have several calls in flight, but the *output* must still be in
// input order. So results are queued as promises in the order they were
// started, and the consumer awaits the head of the queue -- which gives out-
// of-order completion with in-order delivery, and needs no sorting.

import {
  AbortError,
  ERR_MISSING_ARGS,
  ERR_OUT_OF_RANGE,
} from "../../internal/errors.ts";
import {
  validateAbortSignal,
  validateFunction,
  validateInteger,
  validateObject,
} from "../../internal/validators.ts";
import type { AbortSignalLike } from "./end-of-stream.ts";
import { finished } from "./end-of-stream.ts";

declare const AbortSignal: {
  any(signals: AbortSignalLike[]): AbortSignalLike;
};
declare const AbortController: {
  new (): { readonly signal: AbortSignalLike; abort(reason?: unknown): void };
};

export interface OperatorOptions {
  signal?: AbortSignalLike | undefined;
  /** How many mapper calls may be in flight at once. Default 1. */
  concurrency?: number | undefined;
  /** How many results may be queued. Default `concurrency - 1`. */
  highWaterMark?: number | undefined;
}

/**
 * "This value is not part of the output."
 *
 * A sentinel rather than a flag, so that `filter` and `forEach` can be written
 * as maps: dropping a value is returning this. `undefined` could not serve --
 * a stream of `undefined` is a legitimate stream.
 */
const kEmpty = Symbol("kEmpty");
const kEof = Symbol("kEof");

type Source = AsyncIterable<unknown>;
type MapFn = (value: unknown, options: { signal: AbortSignalLike }) => unknown;

export function map(
  this: Source,
  fn: MapFn,
  options?: OperatorOptions,
): AsyncGenerator<unknown, void, void> {
  validateFunction(fn, "fn");
  if (options != null) validateObject(options, "options");
  if (options?.signal != null) validateAbortSignal(options.signal, "options.signal");

  let concurrency = 1;
  if (options?.concurrency != null) concurrency = Math.floor(options.concurrency);

  let highWaterMark = concurrency - 1;
  if (options?.highWaterMark != null) highWaterMark = Math.floor(options.highWaterMark);

  validateInteger(concurrency, "options.concurrency", 1);
  validateInteger(highWaterMark, "options.highWaterMark", 0);

  highWaterMark += concurrency;

  const stream = this;

  return (async function* mapped(): AsyncGenerator<unknown, void, void> {
    const signal = AbortSignal.any([options?.signal].filter(Boolean) as AbortSignalLike[]);
    const queue: unknown[] = [];
    const signalOpt = { signal };

    let next: (() => void) | null = null;
    let resume: (() => void) | null = null;
    let done = false;
    let inFlight = 0;

    function onCatch(): void {
      done = true;
      afterItemProcessed();
    }

    function afterItemProcessed(): void {
      inFlight -= 1;
      maybeResume();
    }

    function maybeResume(): void {
      if (resume && !done && inFlight < concurrency && queue.length < highWaterMark) {
        resume();
        resume = null;
      }
    }

    async function pump(): Promise<void> {
      try {
        for await (let value of stream) {
          if (done) return;
          if (signal.aborted) throw new AbortError();

          try {
            value = fn(value, signalOpt);
            if (value === kEmpty) continue;
            value = Promise.resolve(value);
          } catch (error) {
            // A synchronous throw becomes a rejected promise, so that the
            // consumer sees failures in the same order as successes rather
            // than jumping the queue.
            value = Promise.reject(error);
          }

          inFlight += 1;
          (value as Promise<unknown>).then(afterItemProcessed, onCatch);

          queue.push(value);
          if (next) {
            next();
            next = null;
          }

          // Park the producer once enough is in flight or queued. This is the
          // backpressure: without it, `concurrency` would bound nothing,
          // because the loop would keep starting calls.
          if (!done && (queue.length >= highWaterMark || inFlight >= concurrency)) {
            await new Promise<void>((r) => {
              resume = r;
            });
          }
        }
        queue.push(kEof);
      } catch (error) {
        const rejected = Promise.reject(error);
        rejected.then(afterItemProcessed, onCatch);
        queue.push(rejected);
      } finally {
        done = true;
        if (next) {
          next();
          next = null;
        }
      }
    }

    void pump();

    try {
      for (;;) {
        while (queue.length > 0) {
          // The *head*, so output order is input order even though the
          // promises settle out of order.
          const value = await queue[0];

          if (value === kEof) return;
          if (signal.aborted) throw new AbortError();
          if (value !== kEmpty) yield value;

          queue.shift();
          maybeResume();
        }

        await new Promise<void>((r) => {
          next = r;
        });
      }
    } finally {
      // A consumer that stopped early has to release the producer, or `pump`
      // waits on a `resume` that will never come and the stream is never
      // closed.
      done = true;
      // Cast, because `resume` is only ever assigned inside `pump` -- a
      // nested function -- and the checker's flow analysis does not carry
      // assignments across that boundary. It still believes the variable
      // holds its initial `null` here, which would narrow the call away.
      const pending = resume as (() => void) | null;
      if (pending) {
        pending();
        resume = null;
      }
    }
  })();
}

export function filter(
  this: Source,
  fn: MapFn,
  options?: OperatorOptions,
): AsyncGenerator<unknown, void, void> {
  validateFunction(fn, "fn");
  async function filterFn(value: unknown, opts: { signal: AbortSignalLike }): Promise<unknown> {
    if (await fn(value, opts)) return value;
    return kEmpty;
  }
  return map.call(this, filterFn, options);
}

export async function some(
  this: Source,
  fn: MapFn,
  options?: OperatorOptions,
): Promise<boolean> {
  // Short-circuits: the `return` abandons the iterator, which closes the
  // stream, so a `some` over an infinite stream terminates.
  for await (const _ of filter.call(this, fn, options)) {
    void _;
    return true;
  }
  return false;
}

export async function every(
  this: Source,
  fn: MapFn,
  options?: OperatorOptions,
): Promise<boolean> {
  validateFunction(fn, "fn");
  // De Morgan: everything satisfies `fn` exactly when nothing satisfies its
  // negation. Written this way to inherit `some`'s short-circuiting.
  return !(await some.call(this, async (...args: [unknown, { signal: AbortSignalLike }]) =>
    !(await fn(...args)), options));
}

export async function find(
  this: Source,
  fn: MapFn,
  options?: OperatorOptions,
): Promise<unknown> {
  for await (const result of filter.call(this, fn, options)) {
    return result;
  }
  return undefined;
}

export async function forEach(
  this: Source,
  fn: MapFn,
  options?: OperatorOptions,
): Promise<void> {
  validateFunction(fn, "fn");
  async function forEachFn(value: unknown, opts: { signal: AbortSignalLike }): Promise<unknown> {
    await fn(value, opts);
    return kEmpty;
  }
  // Every value is dropped, so the loop body is empty; the work happens in
  // the mapper, which gets `concurrency` for free.
  for await (const _ of map.call(this, forEachFn, options)) void _;
}

/**
 * `reduce` with no initial value, over a stream that turned out to be empty.
 *
 * A distinct class because the generic "missing argument" message is
 * misleading here: the argument is only *required* when the stream is empty,
 * which the caller could not have known.
 */
class ReduceOfEmptyStream extends ERR_MISSING_ARGS {
  constructor() {
    super("reduce");
    this.message = "Reduce of an empty stream requires an initial value";
  }
}

export async function reduce(
  this: Source & { once(e: string, l: () => void): unknown; destroy(e?: unknown): unknown },
  reducer: (accumulator: unknown, value: unknown, opts: { signal: AbortSignalLike }) => unknown,
  initialValue?: unknown,
  options?: OperatorOptions,
): Promise<unknown> {
  validateFunction(reducer, "reducer");
  if (options != null) validateObject(options, "options");
  if (options?.signal != null) validateAbortSignal(options.signal, "options.signal");

  let hasInitialValue = arguments.length > 1;

  if (options?.signal?.aborted) {
    const error = new AbortError(undefined, { cause: options.signal.reason });
    // The rejection below is the report; this stops the destroy from also
    // raising an unhandled `error` event.
    this.once("error", () => {});
    await finished(this.destroy(error));
    throw error;
  }

  const controller = new AbortController();
  const signal = controller.signal;
  if (options?.signal) {
    options.signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  let sawAnything = false;
  try {
    for await (const value of this) {
      sawAnything = true;
      if (options?.signal?.aborted) throw new AbortError();
      if (!hasInitialValue) {
        initialValue = value;
        hasInitialValue = true;
      } else {
        initialValue = await reducer(initialValue, value, { signal });
      }
    }
    if (!sawAnything && !hasInitialValue) throw new ReduceOfEmptyStream();
  } finally {
    // Cancels whatever the reducer had in flight when the loop ended, however
    // it ended.
    controller.abort();
  }

  return initialValue;
}

export async function toArray(this: Source, options?: OperatorOptions): Promise<unknown[]> {
  if (options != null) validateObject(options, "options");
  if (options?.signal != null) validateAbortSignal(options.signal, "options.signal");

  const result: unknown[] = [];
  for await (const value of this) {
    if (options?.signal?.aborted) {
      throw new AbortError(undefined, { cause: options.signal.reason });
    }
    result.push(value);
  }
  return result;
}

export function flatMap(
  this: Source,
  fn: MapFn,
  options?: OperatorOptions,
): AsyncGenerator<unknown, void, void> {
  const values = map.call(this, fn, options);
  return (async function* flattened(): AsyncGenerator<unknown, void, void> {
    for await (const value of values) {
      yield* value as Iterable<unknown>;
    }
  })();
}

/**
 * The count `drop` and `take` accept.
 *
 * Coerced rather than validated, to match the iterator-helpers proposal:
 * `take("2")` takes two, and `take(NaN)` takes none. Negative is refused,
 * because there is no reading of it that means anything.
 */
function toIntegerOrInfinity(value: unknown): number {
  const number = Number(value);
  if (Number.isNaN(number)) return 0;
  if (number < 0) throw new ERR_OUT_OF_RANGE("number", ">= 0", number);
  return number;
}

export function drop(
  this: Source,
  count: unknown,
  options?: OperatorOptions,
): AsyncGenerator<unknown, void, void> {
  if (options != null) validateObject(options, "options");
  if (options?.signal != null) validateAbortSignal(options.signal, "options.signal");

  let remaining = toIntegerOrInfinity(count);
  const stream = this;

  return (async function* dropped(): AsyncGenerator<unknown, void, void> {
    if (options?.signal?.aborted) throw new AbortError();
    for await (const value of stream) {
      if (options?.signal?.aborted) throw new AbortError();
      if (remaining-- <= 0) yield value;
    }
  })();
}

export function take(
  this: Source,
  count: unknown,
  options?: OperatorOptions,
): AsyncGenerator<unknown, void, void> {
  if (options != null) validateObject(options, "options");
  if (options?.signal != null) validateAbortSignal(options.signal, "options.signal");

  let remaining = toIntegerOrInfinity(count);
  const stream = this;

  return (async function* taken(): AsyncGenerator<unknown, void, void> {
    if (options?.signal?.aborted) throw new AbortError();
    for await (const value of stream) {
      if (options?.signal?.aborted) throw new AbortError();
      if (remaining-- > 0) yield value;
      // Returned as soon as the count is met, rather than pulling one more
      // and discarding it -- which would consume a value the caller did not
      // ask for, and on a stream that matters.
      if (remaining <= 0) return;
    }
  })();
}

export const streamReturningOperators = { drop, filter, flatMap, map, take };
export const promiseReturningOperators = { every, forEach, reduce, toArray, some, find };
