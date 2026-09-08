// The Undici-shaped dispatcher operations: request, stream, pipeline.
//
// Not a parity claim. No Undici revision is pinned in this repository, so an API ledger
// with evidence per export cannot be written honestly, and the plan separates the
// architecture and behaviour — which are required — from package-level compatibility,
// which is a facade decision. What is asserted below is what these do.
//
// `connect` and `upgrade` are absent for a reason worth stating in the tests as well as
// the source: both must hand the caller a connection, and `FetchTransport` answers with
// a response and no way to reach the socket under it.
import assert from "node:assert/strict";
import test from "node:test";

import {
  AbortController,
  DispatcherOperations,
  ReadableStream,
  TextDecoder,
  TextEncoder,
  WritableStream,
} from "../../../../runtime/web-platform/src/index.ts";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function request(overrides = {}) {
  return {
    url: { href: "https://ops.test/resource" },
    method: "GET",
    headers: [],
    body: null,
    bodyLength: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

/** A transport whose response body is `chunks`, recording how it was cancelled. */
function transportOf(chunks, options = {}) {
  const state = { cancelled: undefined, cancelCount: 0, reads: 0 };
  const transport = {
    state,
    async dispatch() {
      if (options.failWith !== undefined) throw options.failWith;
      let index = 0;
      const body =
        chunks === null
          ? null
          : new ReadableStream({
              pull(controller) {
                if (index >= chunks.length) {
                  controller.close();
                  return;
                }
                state.reads++;
                controller.enqueue(encoder.encode(chunks[index++]));
              },
              cancel(reason) {
                state.cancelCount++;
                state.cancelled = reason;
              },
            });
      return {
        status: options.status ?? 200,
        statusText: options.statusText ?? "OK",
        headers: options.headers ?? [["content-type", "text/plain"]],
        body,
        ...(options.trailers === undefined ? {} : { trailers: options.trailers }),
      };
    },
  };
  return transport;
}

function collecting() {
  const written = [];
  return {
    written,
    stream: new WritableStream({
      write(chunk) {
        written.push(decoder.decode(chunk));
      },
    }),
  };
}

async function readAll(stream) {
  const reader = stream.getReader();
  const parts = [];
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      parts.push(decoder.decode(item.value));
    }
  } finally {
    reader.releaseLock();
  }
  return parts.join("");
}

suite("request buffers the body and reports the head and trailers", async () => {
  const transport = transportOf(["hello ", "buffered ", "world"], {
    status: 203,
    statusText: "Non-Authoritative Information",
    headers: [["x-a", "1"]],
    trailers: Promise.resolve([["x-checksum", "abc"]]),
  });
  const operations = new DispatcherOperations(transport);

  const result = await operations.request(request(), { maxBytes: 1024 });
  assert.equal(result.status, 203);
  assert.equal(result.statusText, "Non-Authoritative Information");
  assert.deepEqual(result.headers, [["x-a", "1"]]);
  assert.equal(decoder.decode(result.body), "hello buffered world");
  assert.deepEqual(result.trailers, [["x-checksum", "abc"]]);
});

suite("a transport that cannot expose trailers reports undefined, not none", async () => {
  const operations = new DispatcherOperations(transportOf(["body"]));
  const result = await operations.request(request(), { maxBytes: 1024 });
  assert.equal(result.trailers, undefined);
});

suite("a status the caller would call a failure is still a result", async () => {
  const operations = new DispatcherOperations(
    transportOf(["not found"], { status: 404, statusText: "Not Found" }),
  );
  const result = await operations.request(request(), { maxBytes: 1024 });
  assert.equal(result.status, 404);
  assert.equal(decoder.decode(result.body), "not found");
});

suite("a body past maxBytes is refused and the response is cancelled", async () => {
  // Long enough that the body is still producing when the limit trips. A short body is
  // buffered and closed before the limit is reached, and cancelling a closed stream is
  // a no-op -- so a two-chunk case asserts nothing about cancellation.
  const transport = transportOf(Array.from({ length: 20 }, () => "12345"));
  const operations = new DispatcherOperations(transport);
  await assert.rejects(() => operations.request(request(), { maxBytes: 6 }), {
    name: "ResponseExceededMaxSizeError",
  });
  assert.equal(transport.state.cancelCount, 1, "the producer is told to stop");
  assert.equal(transport.state.cancelled?.name, "ResponseExceededMaxSizeError");
});

suite("an abort while buffering rejects with the exact reason", async () => {
  const controller = new AbortController();
  const reason = new Error("the caller gave up");
  const transport = {
    async dispatch() {
      return {
        status: 200,
        statusText: "OK",
        headers: [],
        body: new ReadableStream({
          pull(streamController) {
            controller.abort(reason);
            streamController.enqueue(encoder.encode("a chunk"));
          },
        }),
      };
    },
  };
  const operations = new DispatcherOperations(transport);
  await assert.rejects(
    () => operations.request(request({ signal: controller.signal }), { maxBytes: 1024 }),
    (thrown) => thrown === reason,
  );
});

suite("stream writes the body into the factory's destination in order", async () => {
  const transport = transportOf(["one ", "two ", "three"], {
    trailers: Promise.resolve([["x-end", "yes"]]),
  });
  const operations = new DispatcherOperations(transport);
  const sink = collecting();
  const seen = [];

  const result = await operations.stream(request(), (info) => {
    seen.push(info);
    return sink.stream;
  });

  assert.equal(seen.length, 1, "the factory is called exactly once");
  assert.equal(seen[0].status, 200);
  assert.deepEqual(sink.written, ["one ", "two ", "three"]);
  assert.deepEqual(result.trailers, [["x-end", "yes"]]);
});

suite("the factory chooses a destination before anything is written to it", async () => {
  const transport = transportOf(["first", "second"]);
  const operations = new DispatcherOperations(transport);
  const order = [];

  // Not "no chunk was pulled": a stream fills its queue on construction, so the body
  // has already been read from before any operation touches it. What this operation
  // controls is that the destination is chosen from the head, before it is written to.
  await operations.stream(request(), (info) => {
    order.push(`factory:${info.status}`);
    return new WritableStream({
      write(chunk) {
        order.push(`write:${decoder.decode(chunk)}`);
      },
    });
  });
  assert.deepEqual(order, ["factory:200", "write:first", "write:second"]);
});

suite("a factory that throws cancels the response body", async () => {
  const transport = transportOf(["unwanted"]);
  const operations = new DispatcherOperations(transport);
  const failure = new Error("nowhere to put it");

  await assert.rejects(
    () =>
      operations.stream(request(), () => {
        throw failure;
      }),
    (thrown) => thrown === failure,
  );
  assert.equal(transport.state.cancelled, failure);
});

suite("a destination that fails mid-write cancels the response body", async () => {
  const transport = transportOf(["a", "b", "c"]);
  const operations = new DispatcherOperations(transport);
  const failure = new Error("the sink broke");
  let written = 0;

  await assert.rejects(
    () =>
      operations.stream(
        request(),
        () =>
          new WritableStream({
            write() {
              if (++written === 2) throw failure;
            },
          }),
      ),
    (thrown) => thrown === failure,
  );
  assert.equal(transport.state.cancelled, failure);
});

suite("a response with no body still gets a destination, closed empty", async () => {
  const transport = transportOf(null, { status: 204, statusText: "No Content" });
  const operations = new DispatcherOperations(transport);
  const sink = collecting();
  let called = 0;

  const result = await operations.stream(request(), () => {
    called++;
    return sink.stream;
  });
  assert.equal(called, 1);
  assert.equal(result.status, 204);
  assert.deepEqual(sink.written, []);
});

suite("pipeline yields what the handler produces", async () => {
  const transport = transportOf(["ab", "cd"]);
  const operations = new DispatcherOperations(transport);

  const out = operations.pipeline(request(), (info, body) => {
    assert.equal(info.status, 200);
    const reader = body.getReader();
    return new ReadableStream({
      async pull(controller) {
        const item = await reader.read();
        if (item.done) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(decoder.decode(item.value).toUpperCase()));
      },
    });
  });

  assert.equal(await readAll(out), "ABCD");
});

suite("a dispatch failure surfaces on the pipeline stream", async () => {
  const failure = new Error("the connection went away");
  const operations = new DispatcherOperations(transportOf(["x"], { failWith: failure }));

  const out = operations.pipeline(request(), () => {
    throw new Error("the handler must not be reached");
  });
  await assert.rejects(() => readAll(out), (thrown) => thrown === failure);
});

suite("a handler that throws errors the stream and cancels the body", async () => {
  const transport = transportOf(["x"]);
  const operations = new DispatcherOperations(transport);
  const failure = new Error("the handler refused");

  const out = operations.pipeline(request(), () => {
    throw failure;
  });
  await assert.rejects(() => readAll(out), (thrown) => thrown === failure);
  assert.equal(transport.state.cancelled, failure);
});

suite("cancelling the pipeline cancels what the handler was reading", async () => {
  const transport = transportOf(["a", "b", "c", "d"]);
  const operations = new DispatcherOperations(transport);
  let handlerCancelled;

  const out = operations.pipeline(request(), (_info, body) => {
    const reader = body.getReader();
    return new ReadableStream({
      async pull(controller) {
        const item = await reader.read();
        if (item.done) controller.close();
        else controller.enqueue(item.value);
      },
      async cancel(reason) {
        handlerCancelled = reason;
        await reader.cancel(reason);
      },
    });
  });

  const reader = out.getReader();
  assert.equal(decoder.decode((await reader.read()).value), "a");
  const reason = new Error("enough");
  await reader.cancel(reason);
  reader.releaseLock();

  assert.equal(handlerCancelled, reason);
  assert.equal(transport.state.cancelled, reason);
});

suite("a cancel that arrives before the dispatch settles is not lost", async () => {
  const released = Promise.withResolvers();
  const transport = transportOf(["a", "b"]);
  const slow = {
    state: transport.state,
    async dispatch(value) {
      await released.promise;
      return transport.dispatch(value);
    },
  };
  const operations = new DispatcherOperations(slow);
  let handlerCancelled;

  const out = operations.pipeline(request(), (_info, body) => {
    const reader = body.getReader();
    return new ReadableStream({
      async pull(controller) {
        const item = await reader.read();
        if (item.done) controller.close();
        else controller.enqueue(item.value);
      },
      async cancel(reason) {
        handlerCancelled = reason;
        await reader.cancel(reason);
      },
    });
  });

  // Cancelled while the dispatch is still in flight: there is nothing to cancel yet,
  // so the request has to be remembered rather than dropped.
  const reason = new Error("changed my mind");
  const cancelling = out.cancel(reason);
  released.resolve();
  await cancelling;
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(handlerCancelled, reason);
  assert.equal(transport.state.cancelled, reason);
});
