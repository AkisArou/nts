// EventSource reconnection timing, tested deterministically.
//
// The existing EventSource suite uses `retry: 0` throughout, which is not an accident:
// with a real clock, asserting that a reconnect happens after three seconds and not
// before means either sleeping for three seconds or asserting nothing. The virtual
// scheduler removes that choice, so the timing this feature is specified in terms of
// is finally the thing under test.
import assert from "node:assert/strict";
import test from "node:test";

// Imported for its side effect: it installs the host environment slot the shared
// runtime reads. The runtime itself is built by hand here so the clock can be ours.
import { createHostNodeWebPlatform } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-runtime.js";
import { createHostNodePrimitives } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-primitives.js";
import {
  installWebPlatformRuntime,
  VirtualScheduler,
  WebPlatformRuntime,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/provider.js";
import {
  EventSource,
  ReadableStream,
  TextEncoder,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);
const encoder = new TextEncoder();
const tick = () => new Promise((resolve) => setImmediate(resolve));

function streamOf(...chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function response(body, status = 200) {
  return {
    status,
    statusText: status === 200 ? "OK" : "No Content",
    headers: [["content-type", "text/event-stream; charset=utf-8"]],
    body,
  };
}

/**
 * A runtime whose clock is ours. `createHostNodeWebPlatform` builds its own scheduler,
 * so the runtime is constructed directly and installed into the same environment slot.
 */
function virtualRuntime(t, transport, options = {}) {
  const clock = new VirtualScheduler();
  const primitives = { ...createHostNodePrimitives(), scheduler: clock };
  const runtime = new WebPlatformRuntime(primitives, { fetchTransport: transport, ...options });
  installWebPlatformRuntime(runtime);
  t.after(() => {
    runtime.close();
    // Restore an ordinary runtime so a later file in this process is not left holding
    // a stopped clock.
    createHostNodeWebPlatform();
  });
  return { clock, runtime };
}

/**
 * Lets real promise settlement finish before virtual time is asked to move.
 *
 * The stream machinery is asynchronous, so the reconnect timer does not exist the
 * instant a stream ends — it is scheduled a few microtask turns later. Advancing
 * before it is scheduled moves the clock past a deadline that has not been set yet,
 * which reads as "the reconnect never happened" and is really "the test asked too
 * early". Draining first is what makes the timing assertions mean what they say.
 */
async function drain(clock) {
  // Both halves are required. Real ticks let promise continuations run; `runPending()`
  // runs what the shared code handed to the scheduler. A clock that moves only when
  // told to must also be *drained* when told to, so a helper that only awaits real
  // ticks watches a queue that never empties — which is how the first version of this
  // file reported that no request was ever made.
  for (let turn = 0; turn < 12; turn++) {
    await tick();
    clock.runPending();
  }
}

async function settle(clock, milliseconds = 0) {
  await drain(clock);
  clock.advance(milliseconds);
  await drain(clock);
}

suite("a reconnect waits for the configured delay and not less", async (t) => {
  const requests = [];
  const transport = {
    async dispatch(request) {
      requests.push(request);
      // Every attempt ends immediately, so only the delay decides when the next starts.
      return response(streamOf("data: one\nid: 42\n\n"));
    },
  };
  const { clock } = virtualRuntime(t, transport, {
    baseURL: "https://events.example/",
    eventSource: { initialReconnectDelayMs: 3000 },
  });

  const source = new EventSource("feed");
  t.after(() => source.close());
  await settle(clock);
  assert.equal(requests.length, 1, "the first attempt does not wait");

  // The stream ended and a reconnect is scheduled. Reading the deadline asserts the
  // delay directly rather than inferring it from when a request happened to appear.
  assert.equal(clock.nextDeadline, 3000, "the reconnect is scheduled for the configured delay");

  await settle(clock, 2999);
  assert.equal(requests.length, 1, "a reconnect must not precede its delay");

  await settle(clock, 1);
  assert.equal(requests.length, 2, "and must happen once the delay elapses");
  // The identifier from the first stream is carried into the retry.
  const resent = requests[1].headers.find(([name]) => name.toLowerCase() === "last-event-id");
  assert.deepEqual(resent, ["last-event-id", "42"]);
});

suite("a retry field changes the delay for later reconnects", async (t) => {
  const requests = [];
  const transport = {
    async dispatch(request) {
      requests.push(request);
      // The first stream reduces the delay; later ones say nothing and inherit it.
      return response(requests.length === 1 ? streamOf("retry: 50\ndata: x\n\n") : streamOf(""));
    },
  };
  const { clock } = virtualRuntime(t, transport, {
    baseURL: "https://events.example/",
    eventSource: { initialReconnectDelayMs: 3000 },
  });

  const source = new EventSource("feed");
  t.after(() => source.close());
  await settle(clock);
  assert.equal(requests.length, 1);
  assert.equal(clock.nextDeadline, 50, "the stream's retry value is the scheduled delay");

  // The stream asked for 50ms, so the configured 3000 no longer applies.
  await settle(clock, 49);
  assert.equal(requests.length, 1);
  await settle(clock, 1);
  assert.equal(requests.length, 2, "the stream's retry value replaced the configured delay");

  // And it persists across a reconnect that does not mention retry.
  await settle(clock, 50);
  assert.equal(requests.length, 3);
});

suite("closing cancels a pending reconnect for good", async (t) => {
  const requests = [];
  const transport = {
    async dispatch(request) {
      requests.push(request);
      return response(streamOf("data: x\n\n"));
    },
  };
  const { clock } = virtualRuntime(t, transport, {
    baseURL: "https://events.example/",
    eventSource: { initialReconnectDelayMs: 1000 },
  });

  const source = new EventSource("feed");
  await settle(clock);
  assert.equal(requests.length, 1);
  assert.equal(source.readyState, EventSource.CONNECTING, "a closed stream reconnects");

  source.close();
  assert.equal(source.readyState, EventSource.CLOSED);

  // Advancing well past the delay must not resurrect it, now or later.
  await settle(clock, 10_000);
  assert.equal(requests.length, 1, "a closed EventSource must not reconnect");
  await settle(clock, 10_000);
  assert.equal(requests.length, 1);
});

suite("a 204 ends the stream permanently rather than after a delay", async (t) => {
  const requests = [];
  const transport = {
    async dispatch(request) {
      requests.push(request);
      return response(null, 204);
    },
  };
  const { clock } = virtualRuntime(t, transport, {
    baseURL: "https://events.example/",
    eventSource: { initialReconnectDelayMs: 10 },
  });

  const source = new EventSource("feed");
  t.after(() => source.close());
  await settle(clock);
  assert.equal(requests.length, 1);
  assert.equal(source.readyState, EventSource.CLOSED);
  await settle(clock, 10_000);
  assert.equal(requests.length, 1, "204 is fatal, not a slow retry");
});
