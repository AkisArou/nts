import test from "node:test";
import assert from "node:assert/strict";
import {
  AbortController,
  DeduplicationBufferError,
  DeduplicationInterceptor,
  ReadableStream,
  TextDecoder,
  TextEncoder,
} from "../src/index.ts";
import { createHostNodePrimitives } from "../host/node-primitives.ts";
import { must } from "./harness.ts";
import type {
  FetchTransport,
  TransportRequest,
  TransportResponse,
} from "../src/fetch/transport.ts";

function request(path = "/resource", overrides: Partial<TransportRequest> = {}): TransportRequest {
  const primitives = createHostNodePrimitives();
  return {
    url: primitives.urls.parse("https://deduplicate.test" + path),
    method: "GET",
    headers: [],
    body: null,
    bodyLength: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function body(
  chunks: readonly string[],
  onCancel: (reason?: unknown) => void = () => {},
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream(
    {
      pull(controller) {
        const value = chunks[index++];
        if (value === undefined) controller.close();
        else controller.enqueue(encoder.encode(value));
      },
      cancel: onCancel,
    },
    { highWaterMark: 0 },
  );
}

async function consume(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (stream === null) return "";
  const reader = stream.getReader();
  const bytes: number[] = [];
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes.push(...item.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

test("concurrent identical requests share one dispatch and independent bodies", async () => {
  const interceptor = new DeduplicationInterceptor();
  const deferred = Promise.withResolvers<TransportResponse>();
  let dispatches = 0;
  const transport: FetchTransport = {
    dispatch(): Promise<TransportResponse> {
      dispatches++;
      return deferred.promise;
    },
  };
  const first = interceptor.dispatch(request(), transport);
  const second = interceptor.dispatch(request(), transport);
  const third = interceptor.dispatch(request(), transport);
  deferred.resolve({
    status: 200,
    statusText: "OK",
    headers: [["x-source", "one"]],
    body: body(["shared", "-body"]),
    trailers: Promise.resolve([["x-end", "yes"]]),
  });
  const responses = await Promise.all([first, second, third]);
  assert.equal(dispatches, 1);
  assert.deepEqual(await Promise.all(responses.map((response) => consume(response.body))), [
    "shared-body",
    "shared-body",
    "shared-body",
  ]);
  const trailers = await Promise.all(responses.map((response) => response.trailers));
  assert.deepEqual(trailers, [[["x-end", "yes"]], [["x-end", "yes"]], [["x-end", "yes"]]]);
  assert.notEqual(trailers[0], trailers[1]);
});

test("different paths and hostile header boundaries never collide", async () => {
  const interceptor = new DeduplicationInterceptor();
  let dispatches = 0;
  const pending: PromiseWithResolvers<TransportResponse>[] = [];
  const transport: FetchTransport = {
    dispatch(): Promise<TransportResponse> {
      dispatches++;
      const result = Promise.withResolvers<TransportResponse>();
      pending.push(result);
      return result.promise;
    },
  };
  const requests = [
    request("/a", { headers: [["a", "x:b=y"]] }),
    request("/a", {
      headers: [
        ["a", "x"],
        ["b", "y"],
      ],
    }),
    request("/b", { headers: [["a", "x:b=y"]] }),
  ];
  const results = requests.map((value) => interceptor.dispatch(value, transport));
  while (pending.length < 3) await Promise.resolve();
  for (const result of pending) {
    result.resolve({ status: 204, statusText: "", headers: [], body: null });
  }
  await Promise.all(results);
  assert.equal(dispatches, 3);
});

test("excluded headers may share while skipped headers always bypass", async () => {
  const excluded = new DeduplicationInterceptor({ excludeHeaderNames: ["x-trace"] });
  let excludedDispatches = 0;
  const deferred = Promise.withResolvers<TransportResponse>();
  const transport: FetchTransport = {
    dispatch(): Promise<TransportResponse> {
      excludedDispatches++;
      return deferred.promise;
    },
  };
  const shared = [
    excluded.dispatch(request("/shared", { headers: [["x-trace", "one"]] }), transport),
    excluded.dispatch(request("/shared", { headers: [["x-trace", "two"]] }), transport),
  ];
  deferred.resolve({ status: 204, statusText: "", headers: [], body: null });
  await Promise.all(shared);
  assert.equal(excludedDispatches, 1);

  const skipped = new DeduplicationInterceptor({ skipHeaderNames: ["authorization"] });
  let skippedDispatches = 0;
  const direct = {
    dispatch() {
      skippedDispatches++;
      return Promise.resolve({ status: 204, statusText: "", headers: [], body: null });
    },
  };
  await Promise.all([
    skipped.dispatch(request("/private", { headers: [["authorization", "one"]] }), direct),
    skipped.dispatch(request("/private", { headers: [["authorization", "one"]] }), direct),
  ]);
  assert.equal(skippedDispatches, 2);
});

test("a subscriber abort does not cancel the shared request for another subscriber", async () => {
  const interceptor = new DeduplicationInterceptor();
  const firstController = new AbortController();
  const cancellations: unknown[] = [];
  let dispatches = 0;
  const transport: FetchTransport = {
    dispatch(): Promise<TransportResponse> {
      dispatches++;
      return Promise.resolve({
        status: 200,
        statusText: "",
        headers: [],
        body: body(["still", "-available"], (reason?: unknown) => cancellations.push(reason)),
      });
    },
  };
  const [first, second] = await Promise.all([
    interceptor.dispatch(request("/abort", { signal: firstController.signal }), transport),
    interceptor.dispatch(request("/abort"), transport),
  ]);
  const reason = new Error("first subscriber stopped");
  firstController.abort(reason);
  await assert.rejects(
    must(first.body, "the response carries a body").getReader().read(),
    (error: unknown) => error === reason,
  );
  assert.equal(await consume(second.body), "still-available");
  assert.equal(dispatches, 1);
  assert.deepEqual(cancellations, []);
});

test("a subscriber may abort before headers without aborting another subscriber", async () => {
  const interceptor = new DeduplicationInterceptor();
  const firstController = new AbortController();
  const deferred = Promise.withResolvers<TransportResponse>();
  let dispatches = 0;
  const transport: FetchTransport = {
    dispatch(): Promise<TransportResponse> {
      dispatches++;
      return deferred.promise;
    },
  };
  const first = interceptor.dispatch(
    request("/headers", { signal: firstController.signal }),
    transport,
  );
  const second = interceptor.dispatch(request("/headers"), transport);
  const reason = new Error("stop before headers");
  firstController.abort(reason);
  deferred.resolve({ status: 200, statusText: "", headers: [], body: body(["second"]) });
  await assert.rejects(first, (error: unknown) => error === reason);
  assert.equal(await consume((await second).body), "second");
  assert.equal(dispatches, 1);
});

test("the last subscriber cancellation cancels upstream with exact identity", async () => {
  const interceptor = new DeduplicationInterceptor();
  const cancellations: unknown[] = [];
  const response = await interceptor.dispatch(request("/last"), {
    dispatch() {
      return Promise.resolve({
        status: 200,
        statusText: "",
        headers: [],
        body: body(["unused"], (reason?: unknown) => cancellations.push(reason)),
      });
    },
  });
  const reason = new Error("no subscribers remain");
  await must(response.body, "the response carries a body").cancel(reason);
  assert.deepEqual(cancellations, [reason]);
});

test("slow subscribers fail at their own bound without stopping fast subscribers", async () => {
  const interceptor = new DeduplicationInterceptor({
    maximumBufferedBytesPerSubscriber: 2,
    maximumTotalBufferedBytes: 4,
  });
  let dispatches = 0;
  const transport: FetchTransport = {
    dispatch(): Promise<TransportResponse> {
      dispatches++;
      return Promise.resolve({
        status: 200,
        statusText: "",
        headers: [],
        body: body(["aa", "bb", "cc"]),
      });
    },
  };
  const [fast, slow] = await Promise.all([
    interceptor.dispatch(request("/bounded"), transport),
    interceptor.dispatch(request("/bounded"), transport),
  ]);
  assert.equal(await consume(fast.body), "aabbcc");
  await assert.rejects(must(slow.body, "the response carries a body").getReader().read(), DeduplicationBufferError);
  assert.equal(dispatches, 1);
});

test("the shared buffer budget retires only the subscriber that cannot reserve", async () => {
  const interceptor = new DeduplicationInterceptor({
    maximumBufferedBytesPerSubscriber: 8,
    maximumTotalBufferedBytes: 2,
  });
  const transport: FetchTransport = {
    dispatch(): Promise<TransportResponse> {
      return Promise.resolve({
        status: 200,
        statusText: "",
        headers: [],
        body: body(["aa"]),
      });
    },
  };
  const [fast, firstSlow, secondSlow] = await Promise.all([
    interceptor.dispatch(request("/budget"), transport),
    interceptor.dispatch(request("/budget"), transport),
    interceptor.dispatch(request("/budget"), transport),
  ]);
  assert.equal(await consume(fast.body), "aa");
  assert.equal(await consume(firstSlow.body), "aa");
  await assert.rejects(
    must(secondSlow.body, "the response carries a body").getReader().read(),
    (error: unknown) =>
      error instanceof DeduplicationBufferError &&
      error.scope === "total" &&
      error.maximumBytes === 2,
  );
});

test("subscriber and pending-request bounds fall back to independent dispatch", async () => {
  const bySubscriber = new DeduplicationInterceptor({ maximumSubscribersPerRequest: 2 });
  const subscriberPending: PromiseWithResolvers<TransportResponse>[] = [];
  let subscriberDispatches = 0;
  const subscriberTransport = {
    dispatch() {
      subscriberDispatches++;
      const result = Promise.withResolvers<TransportResponse>();
      subscriberPending.push(result);
      return result.promise;
    },
  };
  const subscriberResults = [
    bySubscriber.dispatch(request("/subscribers"), subscriberTransport),
    bySubscriber.dispatch(request("/subscribers"), subscriberTransport),
    bySubscriber.dispatch(request("/subscribers"), subscriberTransport),
  ];
  while (subscriberPending.length < 2) await Promise.resolve();
  for (const result of subscriberPending) {
    result.resolve({ status: 204, statusText: "", headers: [], body: null });
  }
  await Promise.all(subscriberResults);
  assert.equal(subscriberDispatches, 2);

  const byPending = new DeduplicationInterceptor({ maximumPendingRequests: 1 });
  const requestPending: PromiseWithResolvers<TransportResponse>[] = [];
  let pendingDispatches = 0;
  const pendingTransport = {
    dispatch() {
      pendingDispatches++;
      const result = Promise.withResolvers<TransportResponse>();
      requestPending.push(result);
      return result.promise;
    },
  };
  const pendingResults = [
    byPending.dispatch(request("/first"), pendingTransport),
    byPending.dispatch(request("/second"), pendingTransport),
  ];
  while (requestPending.length < 2) await Promise.resolve();
  for (const result of requestPending) {
    result.resolve({ status: 204, statusText: "", headers: [], body: null });
  }
  await Promise.all(pendingResults);
  assert.equal(pendingDispatches, 2);
});

test("requests arriving after response data starts dispatch independently", async () => {
  const interceptor = new DeduplicationInterceptor();
  let dispatches = 0;
  const transport: FetchTransport = {
    dispatch(): Promise<TransportResponse> {
      dispatches++;
      return Promise.resolve({
        status: 200,
        statusText: "",
        headers: [],
        body: body(["response-" + String(dispatches)]),
      });
    },
  };
  const first = await interceptor.dispatch(request("/late"), transport);
  const reader = must(first.body, "the response carries a body").getReader();
  const firstChunk = await reader.read();
  assert.equal(new TextDecoder().decode(firstChunk.value), "response-1");
  const second = await interceptor.dispatch(request("/late"), transport);
  assert.equal(dispatches, 2);
  assert.equal(await consume(second.body), "response-2");
  await reader.cancel();
});

test("an upstream failure rejects every subscriber with the same identity", async () => {
  const interceptor = new DeduplicationInterceptor();
  const deferred = Promise.withResolvers<TransportResponse>();
  const transport = { dispatch: () => deferred.promise };
  const first = interceptor.dispatch(request("/failure"), transport);
  const second = interceptor.dispatch(request("/failure"), transport);
  const failure = new Error("origin failed");
  deferred.reject(failure);
  const settled = await Promise.allSettled([first, second]);
  assert.equal(settled[0].status, "rejected");
  assert.equal(settled[1].status, "rejected");
  assert.equal(settled[0].reason, failure);
  assert.equal(settled[1].reason, failure);
});
