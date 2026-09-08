import assert from "node:assert/strict";
import test from "node:test";

import { ReadableStream, WritableStream } from "../src/index.ts";

// Moving a chunk must not be observable to a page that has replaced `Object.prototype.then`.
//
// Resolving a promise *with* an ordinary object performs a `Get` for `then` on it, so any
// internal path that hands a caller a `{ done, value }` through a promise lets a replaced `then`
// see every chunk the stream carries -- and call into it, and lie about it. The specification
// avoids this by giving internal consumers *read requests*, whose steps take the value directly,
// and building a promise only at the public `read()`.
//
// `then-interception.any.js` upstream asserts this for piping and teeing on a **default**
// stream, and it is pinned. It says nothing about byte streams, about the async iterator, or
// about `tee` on a byte source -- and the byte path was still observable after the default path
// was fixed, which is why this file exists. Upstream tests what upstream tests; the hole was
// found by asking whether the fix covered the cases upstream does not.
//
// **The interception must be well-behaved.** It calls the resolver it is handed. A `then` that
// does not is not a test of streams -- it takes the module system down with it, and did once.

/** The upstream fixture's interceptor, which records what it was allowed to see. */
function interceptThen(): unknown[] {
  const intercepted: unknown[] = [];
  let callCount = 0;
  (Object.prototype as unknown as { then?: unknown }).then = function (
    this: { done?: unknown; value?: unknown },
    resolve: (value: unknown) => void,
  ): void {
    if (!this.done) intercepted.push(this.value);
    const retval = Object.create(null) as { done: boolean; value: number };
    retval.done = ++callCount === 3;
    retval.value = callCount;
    resolve(retval);
    if (retval.done) delete (Object.prototype as unknown as { then?: unknown }).then;
  };
  return intercepted;
}

function releaseThen(): void {
  delete (Object.prototype as unknown as { then?: unknown }).then;
}

function defaultStream(): ReadableStream<string> {
  return new ReadableStream<string>({
    start(controller) {
      controller.enqueue("a");
      controller.close();
    },
  });
}

function byteStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    type: "bytes",
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

const suite = (name: string, fn: () => Promise<void>): void => {
  void test(name, { timeout: 10000 }, fn);
};

async function pipeUnobserved<T>(source: ReadableStream<T>): Promise<unknown[]> {
  const written: unknown[] = [];
  const sink = new WritableStream<T>({
    write(chunk) {
      written.push(chunk);
    },
  });
  const intercepted = interceptThen();
  try {
    await source.pipeTo(sink);
  } finally {
    releaseThen();
  }
  assert.equal(written.length, 1, "the chunk should still have been written");
  return intercepted;
}

suite("piping a default stream is not observable through Object.prototype.then", async () => {
  assert.deepEqual(await pipeUnobserved(defaultStream()), []);
});

suite("piping a byte stream is not observable through Object.prototype.then", async () => {
  // Upstream does not cover this and it was observable until the byte read path took a read
  // request too. `readDefault` returning a promise was the last place a chunk reached a caller
  // as the resolution value of one.
  assert.deepEqual(await pipeUnobserved(byteStream()), []);
});

/**
 * Both branches, one at a time.
 *
 * `Promise.all` cannot be used here and the reason is the subject of the file: it resolves with
 * an **array**, which is an ordinary object, so awaiting it performs exactly the `Get` for
 * `then` being measured and the harness reports its own interception as the stream's. That cost
 * three failing tests before it was spotted.
 */
async function teeUnobserved<T>(source: ReadableStream<T>): Promise<unknown[]> {
  const [first, second] = source.tee();
  const intercepted = interceptThen();
  try {
    await first.pipeTo(new WritableStream<T>());
    await second.pipeTo(new WritableStream<T>());
  } finally {
    releaseThen();
  }
  return intercepted;
}

suite("teeing a default stream is not observable", async () => {
  assert.deepEqual(await teeUnobserved(defaultStream()), []);
});

suite("teeing a byte stream is not observable", async () => {
  assert.deepEqual(await teeUnobserved(byteStream()), []);
});

suite("async iteration IS observable, because the standard says the result is an object", async () => {
  // Not a gap. 27.1.2 requires `next()` to fulfil with an ordinary `IteratorResult`, so `then`
  // is findable on it by construction, and upstream's `then-interception.any.js` covers piping
  // and teeing only -- it does not ask this of iteration.
  //
  // Pinned in the direction it actually holds, so that nobody "fixes" it into a spec violation
  // and so the three tests above are not quietly weakened to match it.
  const seen: string[] = [];
  const stream = defaultStream();
  const intercepted = interceptThen();
  try {
    for await (const chunk of stream) seen.push(chunk);
  } finally {
    releaseThen();
  }
  assert.ok(
    intercepted.length > 0,
    "the iterator result is an ordinary object and `then` is found on it",
  );
});

suite("the public read() still resolves with an ordinary object, as the standard requires", async () => {
  // The other side of the rule, so a future change cannot satisfy the tests above by making
  // `read()` resolve with something exotic. 25.5 says the result is an ordinary object, and its
  // prototype being `Object.prototype` is exactly what makes `then` findable on it.
  const reader = defaultStream().getReader();
  const result = await reader.read();
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.deepEqual(Object.keys(result).sort(), ["done", "value"]);
  assert.equal(result.done, false);
  assert.equal(result.value, "a");
});
