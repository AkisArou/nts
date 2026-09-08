// @ts-nocheck -- converted from `.mjs` and not yet typed.
//
// This file was JavaScript until the suite moved to running TypeScript source directly,
// and it was never type-checked. The pragma says so out loud rather than leaving the
// `.ts` extension to imply a guarantee that does not hold. Removing it is a per-file
// job: `grep -lc "@ts-nocheck" test/*.ts` is the remaining list.
// Holding a one-shot request body so a retry has something to send.
//
// This is the spill area's caller. Until it existed, spilling was a mechanism with no
// consumer -- the pattern this ledger keeps naming -- and the retry interceptor refused
// every streaming body outright, which was correct and unhelpful in equal measure.
//
// The refusal is still the default. A body is held only because a caller supplied
// somewhere to hold it: nothing here decides on a caller's behalf that an arbitrary
// upload may be buffered, which is the guess the old error existed to avoid.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AbortController,
  DurableSpillArea,
  ReadableStream,
  RetryInterceptor,
  spilledRequestBodyStore,
  TextDecoder,
  TextEncoder,
  TransportError,
  UnreplayableRequestError,
} from "../../../../runtime/web-platform/src/index.ts";
import { HostNodeDurableStore } from "../node-runtime.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};
const encoder = new TextEncoder();
const none = () => new AbortController().signal;

class ImmediateScheduler {
  delays = [];
  errors = [];

  enqueue(task) {
    queueMicrotask(task);
  }

  delay(milliseconds, task) {
    this.delays.push(milliseconds);
    queueMicrotask(task);
    return { cancel() {} };
  }

  reportError(error) {
    this.errors.push(error);
  }
}

function chunkedStream(chunks) {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) controller.close();
      else controller.enqueue(encoder.encode(chunks[index++]));
    },
  });
}

async function consume(body) {
  if (body === null || body === undefined) return "";
  const reader = body.getReader();
  const parts = [];
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      parts.push(...item.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Uint8Array.from(parts));
}

/** Fails `failures` times with a retryable transport error, recording each body sent. */
function flakyTransport(failures) {
  const sent = [];
  let attempts = 0;
  return {
    sent,
    get attempts() {
      return attempts;
    },
    async dispatch(request) {
      attempts++;
      sent.push(await consume(request.body));
      if (attempts <= failures) throw new TransportError("ECONNRESET", "reset");
      return { status: 200, statusText: "OK", headers: [], body: null, trailers: null };
    },
  };
}

function area(t, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "nts-replay-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes = new HostNodeDurableStore({ root });
  return { bytes, open: () => DurableSpillArea.open(bytes, options) };
}

function retrying(store) {
  return new RetryInterceptor({
    scheduler: new ImmediateScheduler(),
    maxRetries: 3,
    methods: ["POST", "GET"],
    minTimeoutMilliseconds: 0,
    ...(store === undefined ? {} : { requestBodyStore: store }),
  });
}

function post(body, overrides = {}) {
  return {
    url: { href: "https://replay.test/upload" },
    method: "POST",
    headers: [],
    body,
    bodyLength: null,
    signal: none(),
    ...overrides,
  };
}

suite("without somewhere to hold it, a one-shot body is still refused", async (t) => {
  const transport = flakyTransport(1);
  const interceptor = retrying(undefined);

  await assert.rejects(
    () => interceptor.dispatch(post(chunkedStream(["one shot"])), transport),
    UnreplayableRequestError,
  );
  assert.equal(transport.attempts, 1, "the first attempt happened; the retry did not");
});

suite("a held one-shot body is replayed byte for byte", async (t) => {
  const { bytes, open } = area(t, { memoryThresholdBytes: 8 });
  const transport = flakyTransport(2);
  const interceptor = retrying(spilledRequestBodyStore(await open()));

  const response = await interceptor.dispatch(
    post(chunkedStream(["a body ", "in several ", "pieces"])),
    transport,
  );

  assert.equal(response.status, 200);
  assert.equal(transport.attempts, 3);
  assert.deepEqual(transport.sent, [
    "a body in several pieces",
    "a body in several pieces",
    "a body in several pieces",
  ]);
  assert.deepEqual(
    await bytes.list("spill", none()),
    [],
    "the held body is released when the dispatch settles",
  );
});

suite("a body under the threshold is held without touching the store", async (t) => {
  const { bytes, open } = area(t, { memoryThresholdBytes: 1024 });
  const transport = flakyTransport(1);
  const interceptor = retrying(spilledRequestBodyStore(await open()));

  let listedDuring = null;
  const watching = {
    async dispatch(request) {
      listedDuring ??= await bytes.list("spill", none());
      return transport.dispatch(request);
    },
  };

  await interceptor.dispatch(post(chunkedStream(["small"])), watching);
  assert.deepEqual(transport.sent, ["small", "small"]);
  assert.deepEqual(listedDuring, [], "nothing was written for a body that fits in memory");
});

suite("a body over the threshold is in the store while it is held", async (t) => {
  const { bytes, open } = area(t, { memoryThresholdBytes: 4 });
  const transport = flakyTransport(1);
  const interceptor = retrying(spilledRequestBodyStore(await open()));

  let listedDuring = null;
  const watching = {
    async dispatch(request) {
      const result = await transport.dispatch(request);
      listedDuring ??= await bytes.list("spill", none());
      return result;
    },
  };

  // The first attempt fails and the second succeeds; the point is what was in the store
  // while the body was held.
  const response = await interceptor.dispatch(
    post(chunkedStream(["a body larger than the threshold"])),
    watching,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(transport.sent, [
    "a body larger than the threshold",
    "a body larger than the threshold",
  ]);
  assert.equal(listedDuring?.length, 1, "the spilled body is in the store during the dispatch");
  assert.deepEqual(await bytes.list("spill", none()), [], "and gone once the dispatch settles");
});

suite("the held body is released when the dispatch fails too", async (t) => {
  const { bytes, open } = area(t, { memoryThresholdBytes: 4 });
  const failing = {
    attempts: 0,
    async dispatch(request) {
      this.attempts++;
      await consume(request.body);
      throw new TransportError("ECONNRESET", "reset");
    },
  };
  const interceptor = retrying(spilledRequestBodyStore(await open()));

  await assert.rejects(
    () => interceptor.dispatch(post(chunkedStream(["a body larger than the threshold"])), failing),
    TransportError,
  );
  assert.equal(failing.attempts, 4, "the initial attempt and three retries");
  assert.deepEqual(await bytes.list("spill", none()), [], "a failed dispatch releases too");
});

suite("a declared length the body does not have is still an error", async (t) => {
  const { open } = area(t, { memoryThresholdBytes: 4 });
  const transport = flakyTransport(1);
  const interceptor = retrying(spilledRequestBodyStore(await open()));

  // Correcting the length here would turn a caller's inconsistency into a silent
  // success, which is exactly what the refusal is for.
  await assert.rejects(
    () =>
      interceptor.dispatch(
        post(chunkedStream(["twelve bytes"]), { bodyLength: 999 }),
        transport,
      ),
    TypeError,
  );
});

suite("a method this interceptor would not retry is not held", async (t) => {
  const { bytes, open } = area(t, { memoryThresholdBytes: 4 });
  const transport = flakyTransport(1);
  const interceptor = retrying(spilledRequestBodyStore(await open()));

  let listedDuring = null;
  const watching = {
    async dispatch(request) {
      listedDuring ??= await bytes.list("spill", none());
      return transport.dispatch(request);
    },
  };

  // PUT is not in this interceptor's method list, so the body would be held for a
  // retry that will never be attempted.
  await assert.rejects(
    () =>
      interceptor.dispatch(
        post(chunkedStream(["a body larger than the threshold"]), { method: "PUT" }),
        watching,
      ),
    TransportError,
  );
  assert.deepEqual(listedDuring, [], "nothing was held for an ineligible method");
});

suite("a body that can already replay itself is not held again", async (t) => {
  const { bytes, open } = area(t, { memoryThresholdBytes: 4 });
  const transport = flakyTransport(1);
  const interceptor = retrying(spilledRequestBodyStore(await open()));
  const text = "a body larger than the threshold";
  const source = {
    length: encoder.encode(text).length,
    open: () => chunkedStream([text]),
  };

  let listedDuring = null;
  const watching = {
    async dispatch(request) {
      listedDuring ??= await bytes.list("spill", none());
      return transport.dispatch(request);
    },
  };

  await interceptor.dispatch(
    post(source.open(), { replayBody: source, bodyLength: source.length }),
    watching,
  );
  assert.deepEqual(transport.sent, [text, text]);
  assert.deepEqual(listedDuring, [], "a body with its own replay source is left alone");
});
