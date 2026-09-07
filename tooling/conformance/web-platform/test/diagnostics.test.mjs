import test from "node:test";
import assert from "node:assert/strict";
import {
  AbortController,
  DiagnosticsInterceptor,
  ReadableStream,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import { WebPlatformRuntime } from "../node_modules/.tsbuild/host/runtime/web-platform/src/provider.js";
import { createHostNodePrimitives } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-primitives.js";

function request(url = "https://user:password@diagnostics.test/path?token=secret", overrides = {}) {
  const primitives = createHostNodePrimitives();
  return {
    url: primitives.urls.parse(url),
    method: "GET",
    headers: [],
    body: null,
    bodyLength: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

function diagnostics(options = {}) {
  const events = [];
  const reported = [];
  const interceptor = new DiagnosticsInterceptor({
    observer: { publish: (event) => events.push(event) },
    scheduler: {
      enqueue() {},
      delay() {
        return { cancel() {} };
      },
      reportError: (error) => reported.push(error),
    },
    ...options,
  });
  return { interceptor, events, reported };
}

test("request diagnostics redact credentials, queries and configured headers", async () => {
  const state = diagnostics({ additionalRedactedHeaderNames: ["X-API-Key"] });
  await state.interceptor.dispatch(
    request(undefined, {
      method: "POST",
      bodyLength: 12,
      headers: [
        ["Authorization", "Bearer hidden"],
        ["Cookie", "session=hidden"],
        ["X-API-Key", "also-hidden"],
        ["X-Visible", "shown"],
      ],
    }),
    {
      dispatch() {
        return Promise.resolve({ status: 204, statusText: "", headers: [], body: null });
      },
    },
  );
  const created = state.events[0];
  assert.equal(created.type, "request:create");
  assert.equal(created.context.request.url, "https://diagnostics.test/path?<redacted>");
  assert.equal(created.context.request.queryRedacted, true);
  assert.equal(created.context.request.method, "POST");
  assert.equal(created.context.request.bodyLength, 12);
  assert.deepEqual(created.context.request.headers, [
    ["Authorization", "[REDACTED]"],
    ["Cookie", "[REDACTED]"],
    ["X-API-Key", "[REDACTED]"],
    ["X-Visible", "shown"],
  ]);
});

test("query disclosure is explicit and non-network scheme payloads stay hidden", async () => {
  const included = diagnostics({ includeQueryString: true });
  await included.interceptor.dispatch(request(), {
    dispatch() {
      return Promise.resolve({ status: 204, statusText: "", headers: [], body: null });
    },
  });
  assert.equal(
    included.events[0].context.request.url,
    "https://diagnostics.test/path?token=secret",
  );
  assert.equal(included.events[0].context.request.queryRedacted, false);

  const hidden = diagnostics({ includeQueryString: true });
  await hidden.interceptor.dispatch(request("data:text/plain,top-secret"), {
    dispatch() {
      return Promise.resolve({ status: 200, statusText: "", headers: [], body: null });
    },
  });
  assert.equal(hidden.events[0].context.request.url, "data:<redacted>");
});

test("response and trailer events are copied and redact response credentials", async () => {
  const state = diagnostics();
  const trailers = Promise.withResolvers();
  const response = {
    status: 200,
    statusText: "OK",
    headers: [
      ["set-cookie", "token=hidden"],
      ["x-visible", "yes"],
    ],
    body: null,
    trailers: trailers.promise,
  };
  const returned = await state.interceptor.dispatch(request(), {
    dispatch() {
      return Promise.resolve(response);
    },
  });
  assert.equal(returned, response);
  assert.deepEqual(state.events[1].headers, [
    ["set-cookie", "[REDACTED]"],
    ["x-visible", "yes"],
  ]);
  trailers.resolve([
    ["set-cookie", "later-hidden"],
    ["x-end", "yes"],
  ]);
  await trailers.promise;
  await Promise.resolve();
  assert.equal(state.events[2].type, "response:trailers");
  assert.deepEqual(state.events[2].headers, [
    ["set-cookie", "[REDACTED]"],
    ["x-end", "yes"],
  ]);
  assert.notEqual(state.events[1].headers, response.headers);
});

test("observer mutation cannot change transport request or response headers", async () => {
  const originalRequestHeaders = [["x-request", "original"]];
  const originalResponseHeaders = [["x-response", "original"]];
  const interceptor = new DiagnosticsInterceptor({
    observer: {
      publish(event) {
        if (event.type === "request:create") event.context.request.headers[0][1] = "changed";
        if (event.type === "response:headers") event.headers[0][1] = "changed";
      },
    },
    scheduler: {
      enqueue() {},
      delay() {
        return { cancel() {} };
      },
      reportError(error) {
        throw error;
      },
    },
  });
  const response = await interceptor.dispatch(
    request(undefined, { headers: originalRequestHeaders }),
    {
      dispatch(received) {
        assert.deepEqual(received.headers, [["x-request", "original"]]);
        return Promise.resolve({
          status: 200,
          statusText: "OK",
          headers: originalResponseHeaders,
          body: null,
        });
      },
    },
  );
  assert.deepEqual(originalRequestHeaders, [["x-request", "original"]]);
  assert.deepEqual(originalResponseHeaders, [["x-response", "original"]]);
  assert.equal(response.headers, originalResponseHeaders);
});

test("diagnostics preserve body and trailers identity instead of proxying streams", async () => {
  const state = diagnostics();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  const trailers = Promise.resolve([["x-end", "yes"]]);
  const response = { status: 200, statusText: "OK", headers: [], body, trailers };
  const returned = await state.interceptor.dispatch(request(), {
    dispatch() {
      return Promise.resolve(response);
    },
  });
  assert.equal(returned.body, body);
  assert.equal(returned.trailers, trailers);
  assert.equal(body.locked, false);
});

test("observer failures are reported without changing transport settlement", async () => {
  const observerFailure = new Error("observer failed");
  const reported = [];
  const interceptor = new DiagnosticsInterceptor({
    observer: {
      publish() {
        throw observerFailure;
      },
    },
    scheduler: {
      enqueue() {},
      delay() {
        return { cancel() {} };
      },
      reportError(error) {
        reported.push(error);
      },
    },
  });
  const response = { status: 204, statusText: "", headers: [], body: null };
  assert.equal(
    await interceptor.dispatch(request(), { dispatch: () => Promise.resolve(response) }),
    response,
  );
  assert.deepEqual(reported, [observerFailure, observerFailure]);
});

test("a broken observer and broken reporter still cannot change the response", async () => {
  const interceptor = new DiagnosticsInterceptor({
    observer: {
      publish() {
        throw new Error("observer failed");
      },
    },
    scheduler: {
      enqueue() {},
      delay() {
        return { cancel() {} };
      },
      reportError() {
        throw new Error("reporter failed");
      },
    },
  });
  const response = { status: 204, statusText: "", headers: [], body: null };
  assert.equal(
    await interceptor.dispatch(request(), { dispatch: () => Promise.resolve(response) }),
    response,
  );
});

test("dispatch failures preserve exact identity for async and synchronous transports", async () => {
  const asyncState = diagnostics();
  const asyncFailure = new Error("async failure");
  await assert.rejects(
    asyncState.interceptor.dispatch(request(), {
      dispatch() {
        return Promise.reject(asyncFailure);
      },
    }),
    (error) => error === asyncFailure,
  );
  assert.equal(asyncState.events[1].type, "request:error");
  assert.equal(asyncState.events[1].phase, "dispatch");
  assert.equal(asyncState.events[1].error, asyncFailure);

  const syncState = diagnostics();
  const syncFailure = new Error("sync failure");
  assert.throws(
    () =>
      syncState.interceptor.dispatch(request(), {
        dispatch() {
          throw syncFailure;
        },
      }),
    (error) => error === syncFailure,
  );
  assert.equal(syncState.events[1].error, syncFailure);
});

test("trailer rejection is observed without replacing the public promise", async () => {
  const state = diagnostics();
  const failure = new Error("trailers failed");
  const trailers = Promise.reject(failure);
  const response = { status: 200, statusText: "OK", headers: [], body: null, trailers };
  const returned = await state.interceptor.dispatch(request(), {
    dispatch() {
      return Promise.resolve(response);
    },
  });
  assert.equal(returned.trailers, trailers);
  await assert.rejects(returned.trailers, (error) => error === failure);
  await Promise.resolve();
  assert.equal(state.events[2].type, "request:error");
  assert.equal(state.events[2].phase, "trailers");
  assert.equal(state.events[2].error, failure);
});

test("request contexts are unique and display sequences are environment-local", async () => {
  const first = diagnostics();
  const second = diagnostics();
  const response = { status: 204, statusText: "", headers: [], body: null };
  const transport = { dispatch: () => Promise.resolve(response) };
  await first.interceptor.dispatch(request(), transport);
  await first.interceptor.dispatch(request(), transport);
  await second.interceptor.dispatch(request(), transport);
  assert.equal(first.events[0].context.sequence, 1);
  assert.equal(first.events[2].context.sequence, 2);
  assert.equal(second.events[0].context.sequence, 1);
  assert.notEqual(first.events[0].context, second.events[0].context);
});

test("WebPlatformRuntime owns and applies its diagnostic observer", async () => {
  const primitives = createHostNodePrimitives();
  const events = [];
  const runtime = new WebPlatformRuntime(primitives, {
    diagnostics: { publish: (event) => events.push(event) },
    fetchTransport: {
      dispatch() {
        return Promise.resolve({ status: 204, statusText: "", headers: [], body: null });
      },
    },
  });
  try {
    const response = await runtime.fetch("https://environment.test/path?secret=yes");
    assert.equal(response.status, 204);
    assert.deepEqual(
      events.map((event) => event.type),
      ["request:create", "response:headers"],
    );
    assert.equal(events[0].context.request.url, "https://environment.test/path?<redacted>");
  } finally {
    runtime.close();
  }
});
