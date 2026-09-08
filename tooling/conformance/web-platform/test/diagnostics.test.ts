import test from "node:test";
import assert from "node:assert/strict";
import {
  AbortController,
  DiagnosticsInterceptor,
  ReadableStream,
} from "../../../../runtime/web-platform/src/index.ts";
import { WebPlatformRuntime } from "../../../../runtime/web-platform/src/provider.ts";
import { createHostNodePrimitives } from "../node-primitives.ts";
import type {
  DiagnosticsInterceptorOptions,
  DispatchDiagnosticEvent,
} from "../../../../runtime/web-platform/src/dispatch/diagnostics.ts";
import type { TransportResponse } from "../../../../runtime/web-platform/src/fetch/transport.ts";
import type { HeaderEntry } from "../../../../runtime/web-platform/src/fetch/headers.ts";

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

/**
 * The event at `index`, asserted present and asserted to be of `type`.
 *
 * The assertions used to be `assert.equal(event.type, "request:create")` followed by reads of
 * fields only that variant has. That checks the type at run time and tells the compiler
 * nothing, so every read after it was unchecked -- and a variant that stopped carrying a field
 * would have failed as `undefined !== expected` rather than as the shape change it is. This
 * narrows and asserts in one step.
 */
function eventAt<T extends DispatchDiagnosticEvent["type"]>(
  events: readonly DispatchDiagnosticEvent[],
  index: number,
  type: T,
): Extract<DispatchDiagnosticEvent, { type: T }> {
  const event = events[index];
  if (event === undefined || event.type !== type) {
    return assert.fail(`expected a ${type} event at index ${index}, got ${event?.type ?? "nothing"}`);
  }
  return event as Extract<DispatchDiagnosticEvent, { type: T }>;
}

function diagnostics(options: Partial<DiagnosticsInterceptorOptions> = {}): {
  interceptor: DiagnosticsInterceptor;
  events: DispatchDiagnosticEvent[];
  reported: unknown[];
} {
  const events: DispatchDiagnosticEvent[] = [];
  const reported: unknown[] = [];
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
  const created = eventAt(state.events, 0, "request:create");
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
    eventAt(included.events, 0, "request:create").context.request.url,
    "https://diagnostics.test/path?token=secret",
  );
  assert.equal(eventAt(included.events, 0, "request:create").context.request.queryRedacted, false);

  const hidden = diagnostics({ includeQueryString: true });
  await hidden.interceptor.dispatch(request("data:text/plain,top-secret"), {
    dispatch() {
      return Promise.resolve({ status: 200, statusText: "", headers: [], body: null });
    },
  });
  assert.equal(eventAt(hidden.events, 0, "request:create").context.request.url, "data:<redacted>");
});

test("response and trailer events are copied and redact response credentials", async () => {
  const state = diagnostics();
  const trailers = Promise.withResolvers<readonly HeaderEntry[]>();
  const response: TransportResponse = {
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
  assert.deepEqual(eventAt(state.events, 1, "response:headers").headers, [
    ["set-cookie", "[REDACTED]"],
    ["x-visible", "yes"],
  ]);
  trailers.resolve([
    ["set-cookie", "later-hidden"],
    ["x-end", "yes"],
  ]);
  await trailers.promise;
  await Promise.resolve();
  assert.deepEqual(eventAt(state.events, 2, "response:trailers").headers, [
    ["set-cookie", "[REDACTED]"],
    ["x-end", "yes"],
  ]);
  assert.notEqual(eventAt(state.events, 1, "response:headers").headers, response.headers);
});

test("observer mutation cannot change transport request or response headers", async () => {
  const originalRequestHeaders: HeaderEntry[] = [["x-request", "original"]];
  const originalResponseHeaders: HeaderEntry[] = [["x-response", "original"]];
  const interceptor = new DiagnosticsInterceptor({
    observer: {
      publish(event) {
        // A tamper attempt, and the attempt is the test: an observer must not be able to change
        // what it observes, and the assertions below check that neither array moved. A
        // `HeaderEntry` is a readonly tuple, so the write is a type error as well as a
        // violation -- widened here by name so it reads as deliberate rather than silenced.
        const tamper = (entry: HeaderEntry): string[] => entry as unknown as string[];
        if (event.type === "request:create") tamper(event.context.request.headers[0]!)[1] = "changed";
        if (event.type === "response:headers") tamper(event.headers[0]!)[1] = "changed";
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
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  const trailers: Promise<readonly HeaderEntry[]> = Promise.resolve([["x-end", "yes"]]);
  const response: TransportResponse = { status: 200, statusText: "OK", headers: [], body, trailers };
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
  const reported: unknown[] = [];
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
  const asyncError = eventAt(asyncState.events, 1, "request:error");
  assert.equal(asyncError.phase, "dispatch");
  assert.equal(asyncError.error, asyncFailure);

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
  assert.equal(eventAt(syncState.events, 1, "request:error").error, syncFailure);
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
  const trailerError = eventAt(state.events, 2, "request:error");
  assert.equal(trailerError.phase, "trailers");
  assert.equal(trailerError.error, failure);
});

test("request contexts are unique and display sequences are environment-local", async () => {
  const first = diagnostics();
  const second = diagnostics();
  const response = { status: 204, statusText: "", headers: [], body: null };
  const transport = { dispatch: () => Promise.resolve(response) };
  await first.interceptor.dispatch(request(), transport);
  await first.interceptor.dispatch(request(), transport);
  await second.interceptor.dispatch(request(), transport);
  assert.equal(eventAt(first.events, 0, "request:create").context.sequence, 1);
  assert.equal(eventAt(first.events, 2, "request:create").context.sequence, 2);
  assert.equal(eventAt(second.events, 0, "request:create").context.sequence, 1);
  assert.notEqual(
    eventAt(first.events, 0, "request:create").context,
    eventAt(second.events, 0, "request:create").context,
  );
});

test("WebPlatformRuntime owns and applies its diagnostic observer", async () => {
  const primitives = createHostNodePrimitives();
  const events: DispatchDiagnosticEvent[] = [];
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
    assert.equal(
      eventAt(events, 0, "request:create").context.request.url,
      "https://environment.test/path?<redacted>",
    );
  } finally {
    runtime.close();
  }
});
