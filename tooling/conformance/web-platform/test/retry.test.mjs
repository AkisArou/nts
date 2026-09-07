import test from "node:test";
import assert from "node:assert/strict";
import {
  AbortController,
  composeFetchTransport,
  Headers,
  ReadableStream,
  RetryAgent,
  RetryExhaustedError,
  TextDecoder,
  TextEncoder,
  TransportError,
  UnreplayableRequestError,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import { createHostNodePrimitives } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-primitives.js";
import { WebPlatformRuntime } from "../node_modules/.tsbuild/host/runtime/web-platform/src/provider.js";

function stream(value, cancel) {
  const bytes = new TextEncoder().encode(value);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
    cancel,
  });
}

function cancelableStream(value, cancel) {
  const bytes = new TextEncoder().encode(value);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
    },
    cancel,
  });
}

async function consume(body) {
  if (body === null) return "";
  const reader = body.getReader();
  const chunks = [];
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      chunks.push(...item.value);
    }
  } finally {
    reader.releaseLock();
  }
  return new TextDecoder().decode(Uint8Array.from(chunks));
}

function request(primitives, overrides = {}) {
  return {
    url: primitives.urls.parse("https://retry.test/resource"),
    method: "GET",
    headers: [],
    body: null,
    bodyLength: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

class ImmediateScheduler {
  delays = [];
  errors = [];

  enqueue(task) {
    queueMicrotask(task);
  }

  delay(milliseconds, task) {
    const timer = { active: true };
    this.delays.push(milliseconds);
    queueMicrotask(() => {
      if (!timer.active) return;
      timer.active = false;
      task();
    });
    return {
      cancel() {
        timer.active = false;
      },
    };
  }

  reportError(error) {
    this.errors.push(error);
  }
}

class HeldScheduler extends ImmediateScheduler {
  timers = [];

  delay(milliseconds, task) {
    const timer = { milliseconds, task, active: true };
    this.delays.push(milliseconds);
    this.timers.push(timer);
    return {
      cancel() {
        timer.active = false;
      },
    };
  }
}

test("composeFetchTransport has explicit outer-to-inner request ordering", async () => {
  const primitives = createHostNodePrimitives();
  const events = [];
  function interceptor(name) {
    return {
      async dispatch(value, next) {
        events.push(name + ":request");
        const response = await next.dispatch(value);
        events.push(name + ":response");
        return response;
      },
    };
  }
  const transport = composeFetchTransport(
    {
      dispatch() {
        events.push("base");
        return Promise.resolve({ status: 204, statusText: "", headers: [], body: null });
      },
    },
    [interceptor("outer"), interceptor("inner")],
  );
  await transport.dispatch(request(primitives));
  assert.deepEqual(events, [
    "outer:request",
    "inner:request",
    "base",
    "inner:response",
    "outer:response",
  ]);
});

test("RetryAgent retries typed network failures with fresh replayable bodies", async () => {
  const primitives = createHostNodePrimitives();
  const scheduler = new ImmediateScheduler();
  const attempts = [];
  let opened = 0;
  const source = {
    length: 7,
    open() {
      opened++;
      return stream("payload");
    },
  };
  const agent = new RetryAgent(
    {
      async dispatch(value) {
        attempts.push(await consume(value.body));
        if (attempts.length < 3) throw new TransportError("ECONNRESET", "reset");
        return { status: 200, statusText: "", headers: [], body: stream("done") };
      },
    },
    {
      scheduler,
      minTimeoutMilliseconds: 10,
      maxTimeoutMilliseconds: 50,
      timeoutFactor: 3,
    },
  );
  const response = await agent.dispatch(
    request(primitives, {
      method: "PUT",
      body: stream("payload"),
      bodyLength: 7,
      replayBody: source,
    }),
  );
  assert.equal(await consume(response.body), "done");
  assert.deepEqual(attempts, ["payload", "payload", "payload"]);
  assert.equal(opened, 2);
  assert.deepEqual(scheduler.delays, [10, 30]);
});

test("Fetch carries Blob-backed body replayability to the retry transport", async () => {
  const primitives = createHostNodePrimitives();
  const bodies = [];
  const retry = new RetryAgent(
    {
      async dispatch(value) {
        bodies.push(await consume(value.body));
        if (bodies.length === 1) throw new TransportError("ECONNRESET", "reset");
        return { status: 200, statusText: "OK", headers: [], body: stream("accepted") };
      },
    },
    { scheduler: new ImmediateScheduler(), minTimeoutMilliseconds: 0 },
  );
  const runtime = new WebPlatformRuntime(primitives, { fetchTransport: retry });
  const response = await runtime.fetch("https://retry.test/upload", {
    method: "PUT",
    body: "payload",
  });
  assert.equal(await response.text(), "accepted");
  assert.deepEqual(bodies, ["payload", "payload"]);
  runtime.close();
});

test("Retry-After controls status retries and canceled attempts return their body", async () => {
  const primitives = createHostNodePrimitives();
  const scheduler = new ImmediateScheduler();
  const cancellations = [];
  let attempts = 0;
  const agent = new RetryAgent(
    {
      dispatch() {
        attempts++;
        if (attempts === 1) {
          return Promise.resolve({
            status: 503,
            statusText: "Unavailable",
            headers: [["retry-after", "2"]],
            body: cancelableStream("retry", (reason) => cancellations.push(reason)),
          });
        }
        return Promise.resolve({ status: 200, statusText: "", headers: [], body: stream("ok") });
      },
    },
    { scheduler, maxTimeoutMilliseconds: 1000 },
  );
  const response = await agent.dispatch(request(primitives));
  assert.equal(await consume(response.body), "ok");
  assert.equal(attempts, 2);
  assert.deepEqual(scheduler.delays, [1000]);
  assert.equal(cancellations.length, 1);
  assert.equal(cancellations[0].name, "RetryCancellation");
});

test("status exhaustion either throws a stable error or returns the final response", async () => {
  const primitives = createHostNodePrimitives();
  const throwingScheduler = new ImmediateScheduler();
  const cancellations = [];
  const transport = {
    dispatch() {
      return Promise.resolve({
        status: 429,
        statusText: "Slow down",
        headers: [["x-attempt", "last"]],
        body: cancelableStream("later", (reason) => cancellations.push(reason)),
      });
    },
  };
  const throwing = new RetryAgent(transport, {
    scheduler: throwingScheduler,
    maxRetries: 1,
    minTimeoutMilliseconds: 0,
  });
  await assert.rejects(
    throwing.dispatch(request(primitives)),
    (error) =>
      error instanceof RetryExhaustedError &&
      error.code === "UND_ERR_REQ_RETRY" &&
      error.statusCode === 429 &&
      error.retryCount === 1 &&
      error.headers.get("x-attempt") === "last",
  );
  assert.equal(cancellations.length, 2);

  let returnedCancellation = null;
  const returning = new RetryAgent(
    {
      dispatch() {
        return Promise.resolve({
          status: 503,
          statusText: "",
          headers: [],
          body: stream("kept", (reason) => {
            returnedCancellation = reason;
          }),
        });
      },
    },
    {
      scheduler: new ImmediateScheduler(),
      maxRetries: 0,
      throwOnStatusExhaustion: false,
    },
  );
  const response = await returning.dispatch(request(primitives));
  assert.equal(await consume(response.body), "kept");
  assert.equal(returnedCancellation, null);
});

test("one-shot and inconsistent request bodies are never guessed replayable", async () => {
  const primitives = createHostNodePrimitives();
  const scheduler = new ImmediateScheduler();
  let attempts = 0;
  const transport = {
    async dispatch(value) {
      attempts++;
      await consume(value.body);
      throw new TransportError("EPIPE", "broken pipe");
    },
  };
  const agent = new RetryAgent(transport, { scheduler });
  await assert.rejects(
    agent.dispatch(request(primitives, { method: "PUT", body: stream("once"), bodyLength: 4 })),
    UnreplayableRequestError,
  );
  assert.equal(attempts, 1);
  assert.deepEqual(scheduler.delays, []);

  await assert.rejects(
    agent.dispatch(
      request(primitives, {
        method: "PUT",
        body: stream("four"),
        bodyLength: 4,
        replayBody: { length: 5, open: () => stream("wrong") },
      }),
    ),
    /length does not match/,
  );
  assert.equal(attempts, 2);
});

test("custom retry decisions run once and observer failures do not alter dispatch", async () => {
  const primitives = createHostNodePrimitives();
  const scheduler = new ImmediateScheduler();
  const observerFailure = new Error("observer");
  let decisions = 0;
  let attempts = 0;
  const agent = new RetryAgent(
    {
      dispatch() {
        attempts++;
        if (attempts === 1) throw new TransportError("ECONNREFUSED", "refused");
        return Promise.resolve({ status: 204, statusText: "", headers: [], body: null });
      },
    },
    {
      scheduler,
      decide(context) {
        decisions++;
        assert.equal(context.retryCount, 1);
        return { retry: true, delayMilliseconds: 7 };
      },
      onRetry() {
        throw observerFailure;
      },
    },
  );
  assert.equal((await agent.dispatch(request(primitives))).status, 204);
  assert.equal(decisions, 1);
  assert.deepEqual(scheduler.delays, [7]);
  assert.deepEqual(scheduler.errors, [observerFailure]);
});

test("abort during backoff rejects with the exact abort reason", async () => {
  const primitives = createHostNodePrimitives();
  const scheduler = new HeldScheduler();
  const controller = new AbortController();
  let attempts = 0;
  const agent = new RetryAgent(
    {
      dispatch() {
        attempts++;
        throw new TransportError("ENETUNREACH", "offline");
      },
    },
    { scheduler, minTimeoutMilliseconds: 100 },
  );
  const pending = agent.dispatch(request(primitives, { signal: controller.signal }));
  while (scheduler.timers.length === 0) await Promise.resolve();
  const reason = new Error("stop retrying");
  controller.abort(reason);
  await assert.rejects(pending, (error) => error === reason);
  assert.equal(attempts, 1);
  assert.equal(scheduler.timers[0].active, false);
});

test("abort while deciding a response retry cancels that response with the exact reason", async () => {
  const primitives = createHostNodePrimitives();
  const scheduler = new ImmediateScheduler();
  const controller = new AbortController();
  const decision = Promise.withResolvers();
  const cancellations = [];
  const agent = new RetryAgent(
    {
      dispatch() {
        return Promise.resolve({
          status: 503,
          statusText: "Unavailable",
          headers: [],
          body: cancelableStream("pending", (reason) => cancellations.push(reason)),
        });
      },
    },
    {
      scheduler,
      decide: () => decision.promise,
    },
  );
  const pending = agent.dispatch(request(primitives, { signal: controller.signal }));
  await Promise.resolve();
  const reason = new Error("stop during policy");
  controller.abort(reason);
  decision.resolve({ retry: false });
  await assert.rejects(pending, (error) => error === reason);
  assert.deepEqual(cancellations, [reason]);
});

test("huge Retry-After values clamp instead of disabling retry", async () => {
  const primitives = createHostNodePrimitives();
  const scheduler = new ImmediateScheduler();
  let attempts = 0;
  const agent = new RetryAgent(
    {
      dispatch() {
        attempts++;
        if (attempts === 1) {
          return Promise.resolve({
            status: 503,
            statusText: "Unavailable",
            headers: [["retry-after", "999999999999999999999999999999999999999"]],
            body: null,
          });
        }
        return Promise.resolve({ status: 204, statusText: "", headers: [], body: null });
      },
    },
    { scheduler, maxTimeoutMilliseconds: 1234 },
  );
  assert.equal((await agent.dispatch(request(primitives))).status, 204);
  assert.deepEqual(scheduler.delays, [1234]);
});

test("ineligible methods and untyped failures are not retried by default", async () => {
  const primitives = createHostNodePrimitives();
  const scheduler = new ImmediateScheduler();
  const raw = new Error("raw provider error");
  let attempts = 0;
  const agent = new RetryAgent(
    {
      dispatch() {
        attempts++;
        throw attempts === 1 ? new TransportError("ECONNRESET", "reset") : raw;
      },
    },
    { scheduler },
  );
  await assert.rejects(agent.dispatch(request(primitives, { method: "POST" })), /reset/);
  await assert.rejects(agent.dispatch(request(primitives)), (error) => error === raw);
  assert.equal(attempts, 2);
  assert.deepEqual(scheduler.delays, []);
});
