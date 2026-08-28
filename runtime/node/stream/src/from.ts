// A stream out of anything iterable, from node v24.20.0
// `lib/internal/streams/from.js`.
//
// `Readable.from(iterable)` is the bridge from the iterator protocol to the
// stream one, and the two disagree in an important way: an iterator is pulled
// one value at a time and a stream is pushed at until it says stop. This
// reconciles them by pulling exactly as fast as `push` allows -- the loop runs
// while `push` returns true and parks when it returns false, resuming from
// `_read`.
//
// The three near-identical loops are node's, kept on purpose. A synchronous
// iterable of synchronous values is the common case and can run without ever
// creating a promise; the moment a value turns out to be a promise, the loop
// changes to one that awaits. Merging them would put an `await` in the hot
// path, which turns every value into a microtask.

import { Buffer } from "../../buffer/src/main.ts";
import {
  aggregateTwoErrors,
  ERR_INVALID_ARG_TYPE,
  ERR_STREAM_NULL_VALUES,
} from "../../internal/errors.ts";
import { nextTick } from "../../internal/tick.ts";
import { Readable } from "./readable.ts";
import type { ReadableOptions } from "./readable.ts";

type AnyIterator = {
  next(): { value: unknown; done?: boolean } | Promise<{ value: unknown; done?: boolean }>;
  return?(): { value: unknown; done?: boolean } | Promise<{ value: unknown; done?: boolean }>;
  throw?(error: unknown): { value: unknown; done?: boolean } | Promise<{ value: unknown; done?: boolean }>;
};

const isThenable = (value: unknown): boolean =>
  Boolean(value) && typeof (value as { then?: unknown }).then === "function";

export function from(iterable: unknown, opts?: ReadableOptions): Readable {
  // A string or a buffer is iterable, but iterating it would produce one
  // stream chunk per character or per byte, which is never what the caller
  // meant. It becomes a stream of exactly one chunk.
  if (typeof iterable === "string" || iterable instanceof Buffer) {
    return new Readable({
      objectMode: true,
      ...opts,
      read() {
        this.push(iterable);
        this.push(null);
      },
    });
  }

  let iterator: AnyIterator;
  let isAsync: boolean;

  const source = iterable as Record<symbol, (() => AnyIterator) | undefined>;
  if (source?.[Symbol.asyncIterator]) {
    isAsync = true;
    iterator = (source[Symbol.asyncIterator] as () => AnyIterator)();
  } else if (source?.[Symbol.iterator]) {
    isAsync = false;
    iterator = (source[Symbol.iterator] as () => AnyIterator)();
  } else {
    throw new ERR_INVALID_ARG_TYPE("iterable", ["Iterable"], iterable);
  }

  const readable = new Readable({
    objectMode: true,
    // One at a time. The iterator is the buffer; reading ahead would mean
    // pulling values the consumer has not asked for, which for a generator
    // with side effects is a behaviour change rather than a cache.
    highWaterMark: 1,
    ...opts,
  });

  const originalDestroy = readable._destroy.bind(readable);

  // Guards against `_read` being called again while a loop is still running.
  let reading = false;
  let valuesAreAsync = false;

  readable._read = function (): void {
    if (reading) return;
    reading = true;
    if (isAsync) void nextAsync();
    else if (valuesAreAsync) void nextSyncWithAsyncValues();
    else nextSyncWithSyncValues();
  };

  readable._destroy = function (error: unknown, callback: (error?: unknown) => void): void {
    originalDestroy(error, (destroyError?: unknown) => {
      const combined = destroyError || error;
      // The iterator gets to clean up too -- a generator with a `finally` has
      // not run it yet -- and its own failure is kept alongside ours rather
      // than replacing it.
      closeIterator(combined).then(
        () => nextTick(callback, combined),
        (closeError: unknown) => nextTick(callback, aggregateTwoErrors(combined, closeError)),
      );
    });
  };

  /**
   * Tell the iterator we are done with it.
   *
   * `throw` when there was an error, so a generator's `catch` sees it;
   * `return` otherwise, so its `finally` runs. A generator that swallows the
   * thrown error and yields again is respected -- that is what `done` being
   * false means here.
   */
  async function closeIterator(error: unknown): Promise<void> {
    const hadError = error !== undefined && error !== null;
    if (hadError && typeof iterator.throw === "function") {
      const { value, done } = await iterator.throw(error);
      await value;
      if (done) return;
    }
    if (typeof iterator.return === "function") {
      const { value } = await iterator.return();
      await value;
    }
  }

  function nextSyncWithSyncValues(): void {
    for (;;) {
      try {
        const { value, done } = iterator.next() as { value: unknown; done?: boolean };

        if (done) {
          readable.push(null);
          return;
        }

        // The first promise changes the loop for the rest of the iteration.
        if (isThenable(value)) {
          void changeToAsyncValues(value);
          return;
        }

        if (value === null) {
          reading = false;
          throw new ERR_STREAM_NULL_VALUES();
        }

        if (readable.push(value)) continue;

        // Told to stop. `_read` will start us again.
        reading = false;
      } catch (error) {
        readable.destroy(error);
      }
      break;
    }
  }

  async function changeToAsyncValues(value: unknown): Promise<void> {
    valuesAreAsync = true;
    try {
      const resolved = await value;
      if (resolved === null) {
        reading = false;
        throw new ERR_STREAM_NULL_VALUES();
      }
      if (readable.push(resolved)) {
        await nextSyncWithAsyncValues();
        return;
      }
      reading = false;
    } catch (error) {
      readable.destroy(error);
    }
  }

  async function nextSyncWithAsyncValues(): Promise<void> {
    for (;;) {
      try {
        const { value, done } = iterator.next() as { value: unknown; done?: boolean };

        if (done) {
          readable.push(null);
          return;
        }

        const resolved = isThenable(value) ? await value : value;

        if (resolved === null) {
          reading = false;
          throw new ERR_STREAM_NULL_VALUES();
        }

        if (readable.push(resolved)) continue;

        reading = false;
      } catch (error) {
        readable.destroy(error);
      }
      break;
    }
  }

  async function nextAsync(): Promise<void> {
    for (;;) {
      try {
        const { value, done } = await iterator.next();

        if (done) {
          readable.push(null);
          return;
        }

        // `null` is the stream's end-of-stream marker, so an iterable that
        // yields it is refused rather than silently truncating the stream.
        if (value === null) {
          reading = false;
          throw new ERR_STREAM_NULL_VALUES();
        }

        if (readable.push(value)) continue;

        reading = false;
      } catch (error) {
        readable.destroy(error);
      }
      break;
    }
  }

  return readable;
}
