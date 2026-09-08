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
} from "../src/index.ts";
import { HostNodeDurableStore } from "../host/node-runtime.ts";
import { createHostNodePrimitives } from "../host/node-primitives.ts";
import type { RequestBodyStore } from "../src/fetch/transport.ts";
import type {
  FetchTransport,
  TransportRequest,
  TransportResponse,
} from "../src/fetch/transport.ts";
import { must } from "./harness.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};
const encoder = new TextEncoder();
const none = () => new AbortController().signal;

class ImmediateScheduler {
  readonly delays: number[] = [];
  readonly errors: unknown[] = [];

  enqueue(task: () => void): void {
    queueMicrotask(task);
  }

  delay(milliseconds: number, task: () => void): { cancel(): void } {
    this.delays.push(milliseconds);
    queueMicrotask(task);
    return { cancel() {} };
  }

  reportError(error: unknown): void {
    this.errors.push(error);
  }
}

function chunkedStream(chunks: readonly string[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) controller.close();
      else controller.enqueue(encoder.encode(chunks[index++]));
    },
  });
}

async function consume(body: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
  if (body === null || body === undefined) return "";
  const reader = body.getReader();
  // Bytes rather than chunks: the loop spreads each chunk into this.
  const parts: number[] = [];
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
function flakyTransport(failures: number): FetchTransport & {
  sent: string[];
  readonly attempts: number;
} {
  const sent: string[] = [];
  let attempts = 0;
  return {
    sent,
    get attempts() {
      return attempts;
    },
    async dispatch(request: TransportRequest): Promise<TransportResponse> {
      attempts++;
      sent.push(await consume(request.body));
      if (attempts <= failures) throw new TransportError("ECONNRESET", "reset");
      return { status: 200, statusText: "OK", headers: [], body: null, trailers: undefined };
    },
  };
}

function area(
  t: TestContext,
  options: Record<string, unknown> = {},
): { bytes: HostNodeDurableStore; open: () => Promise<DurableSpillArea> } {
  const root = mkdtempSync(join(tmpdir(), "nts-replay-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bytes = new HostNodeDurableStore({ root });
  return { bytes, open: () => DurableSpillArea.open(bytes, options) };
}

function retrying(store?: RequestBodyStore): RetryInterceptor {
  return new RetryInterceptor({
    scheduler: new ImmediateScheduler(),
    maxRetries: 3,
    methods: ["POST", "GET"],
    minTimeoutMilliseconds: 0,
    ...(store === undefined ? {} : { requestBodyStore: store }),
  });
}

const urls = createHostNodePrimitives().urls;

function post(
  body: ReadableStream<Uint8Array> | null,
  overrides: Partial<TransportRequest> = {},
): TransportRequest {
  return {
    // A parsed record rather than a `{ href }` stub: `TransportRequest.url` is a `URLRecord`,
    // and the stub satisfied nothing but the one field this file happened to read.
    url: urls.parse("https://replay.test/upload"),
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

  // Assigned only from inside the dispatch, so it needs to say what it will hold.
  let listedDuring: readonly unknown[] | null = null;
  const watching = {
    async dispatch(request: TransportRequest): Promise<TransportResponse> {
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

  // Recorded into an array rather than a `let`: the only assignment is inside the dispatch, and
  // control-flow analysis cannot see that it ran, so afterwards the variable reads as still
  // holding its initialiser. Pushing keeps the first observation with the same first-write-wins
  // meaning `??=` had.
  const listedDuring: (readonly unknown[])[] = [];
  const watching = {
    async dispatch(request: TransportRequest): Promise<TransportResponse> {
      const result = await transport.dispatch(request);
      if (listedDuring.length === 0) listedDuring.push(await bytes.list("spill", none()));
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
  assert.equal(
    must(listedDuring[0], "the watcher observed the store during the dispatch").length,
    1,
    "the spilled body is in the store during the dispatch",
  );
  assert.deepEqual(await bytes.list("spill", none()), [], "and gone once the dispatch settles");
});

suite("the held body is released when the dispatch fails too", async (t) => {
  const { bytes, open } = area(t, { memoryThresholdBytes: 4 });
  const failing = {
    attempts: 0,
    async dispatch(request: TransportRequest): Promise<TransportResponse> {
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

  // Assigned only from inside the dispatch, so it needs to say what it will hold.
  let listedDuring: readonly unknown[] | null = null;
  const watching = {
    async dispatch(request: TransportRequest): Promise<TransportResponse> {
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

  // Assigned only from inside the dispatch, so it needs to say what it will hold.
  let listedDuring: readonly unknown[] | null = null;
  const watching = {
    async dispatch(request: TransportRequest): Promise<TransportResponse> {
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
