import test from "node:test";
import assert from "node:assert/strict";
import {
  AbortController,
  DumpInterceptor,
  ReadableStream,
  ResponseError,
  ResponseErrorInterceptor,
  ResponseExceededMaxSizeError,
  TextDecoder,
  TextEncoder,
} from "../../../../runtime/web-platform/src/index.ts";
import { createHostNodePrimitives } from "../node-primitives.ts";

function request(overrides = {}) {
  const primitives = createHostNodePrimitives();
  return {
    url: primitives.urls.parse("https://policy.test/resource"),
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
  cancel: (reason?: unknown) => void | Promise<void> = () => {},
): ReadableStream<Uint8Array> {
  const values = chunks.map((chunk) => new TextEncoder().encode(chunk));
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const value of values) controller.enqueue(value);
      controller.close();
    },
    cancel,
  });
}

async function text(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (stream === null) return "";
  const reader = stream.getReader();
  // Bytes rather than chunks: the loop below spreads each chunk into this.
  const chunks: number[] = [];
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

test("ResponseErrorInterceptor leaves successful response streams untouched", async () => {
  const source = body(["ok"]);
  const response = await new ResponseErrorInterceptor().dispatch(request(), {
    dispatch() {
      return Promise.resolve({ status: 399, statusText: "Odd", headers: [], body: source });
    },
  });
  assert.equal(response.body, source);
  assert.equal(await text(response.body), "ok");
});

test("ResponseErrorInterceptor consumes text errors and exposes stable metadata", async () => {
  const interceptor = new ResponseErrorInterceptor();
  await assert.rejects(
    interceptor.dispatch(request(), {
      dispatch() {
        return Promise.resolve({
          status: 404,
          statusText: "Missing",
          headers: [
            ["content-type", "application/problem+json; charset=utf-8"],
            ["x-reason", "gone"],
          ],
          body: body(['{"error":"gone"}']),
          trailers: Promise.resolve([["x-end", "yes"]]),
        });
      },
    }),
    (error: unknown) =>
      error instanceof ResponseError &&
      error.code === "UND_ERR_RESPONSE" &&
      error.statusCode === 404 &&
      error.statusMessage === "Missing" &&
      error.headers.get("x-reason") === "gone" &&
      error.body === '{"error":"gone"}',
  );
});

test("ResponseErrorInterceptor preserves binary error bodies as bytes", async () => {
  await assert.rejects(
    new ResponseErrorInterceptor().dispatch(request(), {
      dispatch() {
        return Promise.resolve({
          status: 500,
          statusText: "Binary",
          headers: [["content-type", "application/octet-stream"]],
          body: body(["raw"]),
        });
      },
    }),
    (error: unknown) =>
      error instanceof ResponseError &&
      error.body instanceof Uint8Array &&
      new TextDecoder().decode(error.body) === "raw",
  );
});

test("declared over-limit bodies are rejected and canceled before collection", async () => {
  const cancellations: unknown[] = [];
  const cancellation = Promise.withResolvers<void>();
  const source = new ReadableStream<Uint8Array>({
    pull() {},
    cancel(reason: unknown) {
      cancellations.push(reason);
      return cancellation.promise;
    },
  });
  const pending = new DumpInterceptor({ maximumBytes: 3 }).dispatch(request(), {
    dispatch() {
      return Promise.resolve({
        status: 200,
        statusText: "",
        headers: [["content-length", "4"]],
        body: source,
      });
    },
  });
  const checked = assert.rejects(
    pending,
    (error: unknown) =>
      error instanceof ResponseExceededMaxSizeError &&
      error.maximumBytes === 3 &&
      error.receivedBytes === 4,
  );
  while (cancellations.length === 0) await Promise.resolve();
  let settled = false;
  checked.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  cancellation.resolve();
  await checked;
  assert.equal(cancellations.length, 1);
});

test("unsafe-integer Content-Length is conservatively over the bound", async () => {
  await assert.rejects(
    new DumpInterceptor({ maximumBytes: Number.MAX_SAFE_INTEGER }).dispatch(request(), {
      dispatch() {
        return Promise.resolve({
          status: 200,
          statusText: "",
          headers: [["content-length", "9999999999999999999999999999999999"]],
          body: null,
        });
      },
    }),
    (error: unknown) =>
      error instanceof ResponseExceededMaxSizeError &&
      error.maximumBytes === Number.MAX_SAFE_INTEGER &&
      error.receivedBytes === Number.POSITIVE_INFINITY,
  );
});

test("DumpInterceptor accepts the exact byte boundary and preserves trailers", async () => {
  const response = await new DumpInterceptor({ maximumBytes: 4 }).dispatch(request(), {
    dispatch() {
      return Promise.resolve({
        status: 200,
        statusText: "OK",
        headers: [["content-length", "4"]],
        body: body(["ab", "cd"]),
        trailers: Promise.resolve([["x-checksum", "ok"]]),
      });
    },
  });
  assert.equal(response.body, null);
  assert.deepEqual(await response.trailers, [["x-checksum", "ok"]]);
});

test("streaming over-limit bodies are canceled with the limit error", async () => {
  const cancellations: unknown[] = [];
  const encoder = new TextEncoder();
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("ab"));
      controller.enqueue(encoder.encode("cd"));
    },
    cancel(reason) {
      cancellations.push(reason);
    },
  });
  await assert.rejects(
    new DumpInterceptor({ maximumBytes: 3 }).dispatch(request(), {
      dispatch() {
        return Promise.resolve({
          status: 200,
          statusText: "",
          headers: [],
          body: source,
        });
      },
    }),
    ResponseExceededMaxSizeError,
  );
  assert.equal(cancellations.length, 1);
  const [cancelled] = cancellations;
  assert.ok(cancelled instanceof ResponseExceededMaxSizeError, "the reason is the policy error");
  assert.equal(cancelled.receivedBytes, 4);
});

test("body read failures retain exact identity instead of becoming policy errors", async () => {
  const failure = new Error("read failed");
  const source = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(failure);
    },
  });
  await assert.rejects(
    new DumpInterceptor().dispatch(request(), {
      dispatch() {
        return Promise.resolve({ status: 200, statusText: "", headers: [], body: source });
      },
    }),
    (error: unknown) => error === failure,
  );
});

test("abort during body consumption cancels with the exact reason", async () => {
  const controller = new AbortController();
  const cancellations: unknown[] = [];
  const source = new ReadableStream<Uint8Array>({
    pull() {},
    cancel(reason) {
      cancellations.push(reason);
    },
  });
  const pending = new DumpInterceptor().dispatch(request({ signal: controller.signal }), {
    dispatch() {
      return Promise.resolve({ status: 200, statusText: "", headers: [], body: source });
    },
  });
  await Promise.resolve();
  const reason = new Error("stop dumping");
  controller.abort(reason);
  await assert.rejects(pending, (error: unknown) => error === reason);
  assert.deepEqual(cancellations, [reason]);
});
