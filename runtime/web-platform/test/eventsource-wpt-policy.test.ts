// Supplemental HTML 9.2 policy controls for the unchanged EventSource WPT corpus.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
// Install the host environment slot; each control installs its own virtual runtime.
import "../host/node-runtime.ts";
import { createHostNodePrimitives } from "../host/node-primitives.ts";
import { Blob, DOMException, EventSource, ReadableStream, TextEncoder } from "../src/index.ts";
import type { ReadableStreamDefaultController } from "../src/index.ts";
import { LimitError } from "../src/core/errors.ts";
import { installWebPlatformRuntime, VirtualScheduler, WebPlatformRuntime } from "../src/provider.ts";
import type { WebPlatformOptions } from "../src/provider.ts";
import type { FetchTransport, TransportRequest, TransportResponse } from "../src/fetch/transport.ts";
import type { BlobExternalSource } from "../src/file/blob.ts";

const encoder = new TextEncoder();
const checkpoint = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, fn);
};

async function until(clock: VirtualScheduler, condition: () => boolean, description: string): Promise<void> {
  for (let turn = 0; turn < 100; turn++) {
    clock.runPending();
    await checkpoint();
    if (condition()) return;
  }
  assert.fail("the controlled operation did not complete: " + description);
}

function virtualRuntime(t: TestContext, transport: FetchTransport, options: WebPlatformOptions = {}) {
  const clock = new VirtualScheduler();
  const runtime = new WebPlatformRuntime({
    ...createHostNodePrimitives({}, (error) => clock.reportError(error)),
    scheduler: clock,
  }, {
    ...options,
    fetchTransport: transport,
    eventSource: { initialReconnectDelayMs: 37, ...options.eventSource },
  });
  installWebPlatformRuntime(runtime);
  t.after(async () => {
    runtime.close();
    await checkpoint();
    clock.runPending();
    await checkpoint();
    assert.deepEqual(clock.errors, []);
  });
  return { runtime, clock };
}

function response(body: ReadableStream<Uint8Array> | null): TransportResponse {
  return { status: 200, statusText: "OK", headers: [["content-type", "text/event-stream"]], body };
}

class ControlledBody {
  readonly stream: ReadableStream<Uint8Array>;
  readonly cancellations: unknown[] = [];
  cancelGate: PromiseWithResolvers<void> | null = null;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  private ended = false;

  constructor() {
    const owner = this;
    this.stream = new ReadableStream({
      start(controller) {
        owner.controller = controller;
      },
      cancel(reason) {
        owner.ended = true;
        owner.cancellations.push(reason);
        return owner.cancelGate?.promise;
      },
    }, { highWaterMark: 0 });
  }

  push(text: string): void {
    assert.ok(this.controller);
    this.controller.enqueue(encoder.encode(text));
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.controller?.close();
  }
}

// HTML 9.2.2 constructor step 15.2: a known-futile network failure is terminal.
for (const url of [
  "ftp://events.example/feed",
  "about:blank",
  "mailto:events@example.test",
  "javascript:undefined",
]) {
  suite(`EventSource asynchronously fails the unsupported ${url.slice(0, url.indexOf(":"))} scheme`, async (t) => {
    let requests = 0;
    const { clock } = virtualRuntime(t, {
      async dispatch() {
        requests++;
        return assert.fail("Fetch must reject this scheme before network dispatch");
      },
    });
    const source = new EventSource(url);
    const states: number[] = [];
    source.onerror = (event) => {
      assert.equal(event.isTrusted, true);
      states.push(source.readyState);
    };
    assert.equal(source.readyState, EventSource.CONNECTING);
    assert.deepEqual(states, [], "construction cannot synchronously report a network failure");
    await until(clock, () => states.length !== 0, "unsupported-scheme error");
    assert.deepEqual(states, [EventSource.CLOSED]);
    assert.equal(requests, 0);
    assert.equal(clock.nextDeadline, null, "a futile request must not schedule reconnect");
    assert.equal(clock.advanceToNextDeadline(), false);
    source.close();
    await checkpoint();
    clock.runPending();
    assert.deepEqual(states, [EventSource.CLOSED]);
  });
}

function memoryFile(bytes: Uint8Array<ArrayBuffer>): BlobExternalSource {
  return {
    size: bytes.byteLength,
    open(start, length) {
      let position = start;
      const end = start + length;
      return {
        async read(maximumBytes) {
          if (position === end) return undefined;
          const next = Math.min(position + maximumBytes, end);
          const result = bytes.slice(position, next);
          position = next;
          return result;
        },
        async close() {},
      };
    },
  };
}

for (const scheme of ["data", "blob", "file"] as const) {
  suite(`EventSource preserves supported ${scheme} Fetch responses`, async (t) => {
    const payload = "data: supported\n\n";
    const file = memoryFile(encoder.encode(payload));
    let fileOpens = 0;
    const { runtime, clock } = virtualRuntime(t, {
      async dispatch() {
        return assert.fail("this supported local resource does not use network dispatch");
      },
    }, {
      fileURLs: {
        async open(url) {
          assert.equal(url.href, "file:///events.txt");
          fileOpens++;
          return { source: file, type: "text/event-stream" };
        },
      },
    });
    const url = scheme === "data"
      ? "data:text/event-stream," + encodeURIComponent(payload)
      : scheme === "blob"
        ? runtime.createObjectURL(new Blob([payload], { type: "text/event-stream" }))
        : "file:///events.txt";
    const source = new EventSource(url);
    const events: string[] = [];
    source.onopen = () => events.push("open");
    source.onerror = () => events.push("error");
    source.onmessage = (event) => {
      assert.ok(typeof event.data === "string");
      events.push(event.data);
      source.close();
    };
    await until(clock, () => source.readyState === EventSource.CLOSED, "supported resource message");
    assert.deepEqual(events, ["open", "supported"]);
    assert.equal(fileOpens, scheme === "file" ? 1 : 0);
    assert.equal(clock.nextDeadline, null);
  });
}

for (const scheme of ["http", "https"]) {
  suite(`EventSource retries a transient ${scheme} network failure`, async (t) => {
    const requests: TransportRequest[] = [];
    const body = new ControlledBody();
    t.after(() => body.end());
    const { clock } = virtualRuntime(t, {
      async dispatch(request) {
        requests.push(request);
        if (requests.length === 1) throw new Error("temporarily offline");
        return response(body.stream);
      },
    });
    const source = new EventSource(`${scheme}://events.example/feed`);
    const errors: number[] = [];
    const messages: string[] = [];
    source.onerror = () => errors.push(source.readyState);
    source.onmessage = (event) => {
      assert.ok(typeof event.data === "string");
      messages.push(event.data);
    };
    await until(clock, () => clock.nextDeadline !== null, "reconnect scheduling");
    assert.deepEqual(errors, [EventSource.CONNECTING]);
    assert.equal(requests.length, 1);
    assert.equal(clock.nextDeadline, 37);
    assert.equal(clock.advanceToNextDeadline(), true);
    await until(clock, () => source.readyState === EventSource.OPEN, "successful reconnect");
    assert.equal(requests.length, 2);
    body.push("data: recovered\n\n");
    await until(clock, () => messages.length !== 0, "message after reconnect");
    assert.deepEqual(messages, ["recovered"]);
    source.close();
    await checkpoint();
    assert.equal(requests.length, 2);
    assert.equal(clock.nextDeadline, null);
  });
}

// HTML 9.2.2 close ownership and 9.2.3 terminal failure: retire the active Fetch.
for (const limit of ["line", "event"] as const) {
  for (const cancelRejects of [false, true]) {
    suite(`EventSource ${limit} limit cancels and aborts once when cancellation ${cancelRejects ? "rejects" : "fulfills"}`, async (t) => {
      const requests: TransportRequest[] = [];
      const body = new ControlledBody();
      const cancellation = Promise.withResolvers<void>();
      body.cancelGate = cancellation;
      t.after(() => {
        cancellation.resolve();
        body.end();
      });
      const { runtime, clock } = virtualRuntime(t, {
        async dispatch(request) {
          requests.push(request);
          return response(body.stream);
        },
      }, {
        eventSource: {
          maxLineBufferCharacters: limit === "line" ? 8 : 100,
          maxEventBufferCharacters: limit === "event" ? 4 : 100,
        },
      });
      const source = new EventSource("https://events.example/feed");
      const states: number[] = [];
      source.onerror = () => states.push(source.readyState);
      await until(clock, () => source.readyState === EventSource.OPEN, "stream open");
      const request = requests[0];
      assert.ok(request);
      assert.equal(body.stream.locked, true);
      body.push(limit === "line" ? "data: too-long" : "data:ab\ndata:cd\n");
      await until(clock, () => body.cancellations.length !== 0 || states.length !== 0, "parser limit cleanup");
      assert.equal(body.cancellations.length, 1, "fatal parsing must cancel its owned body reader");
      const error = body.cancellations[0];
      assert.ok(error instanceof LimitError);
      assert.match(error.message, limit === "line" ? /line exceeded/ : /event exceeded/);
      if (cancelRejects) cancellation.reject(new Error("provider cancellation failed"));
      else cancellation.resolve();
      await until(clock, () => states.length !== 0, "terminal parser error event");
      assert.deepEqual(states, [EventSource.CLOSED]);
      assert.equal(request.signal.aborted, true);
      assert.equal(request.signal.reason, error, "cancellation failure cannot replace the parser LimitError");
      assert.equal(body.stream.locked, false, "owned readers must be released after cleanup");
      assert.equal(clock.nextDeadline, null);
      source.close();
      source.close();
      runtime.close();
      await checkpoint();
      clock.runPending();
      assert.equal(requests.length, 1);
      assert.equal(body.cancellations.length, 1);
      assert.deepEqual(states, [EventSource.CLOSED]);
      assert.equal(clock.advanceToNextDeadline(), false);
    });
  }
}

for (const operation of ["public close", "runtime close"] as const) {
  suite(`EventSource ${operation} keeps ordinary AbortError cancellation`, async (t) => {
    const requests: TransportRequest[] = [];
    const body = new ControlledBody();
    t.after(() => body.end());
    const { runtime, clock } = virtualRuntime(t, {
      async dispatch(request) {
        requests.push(request);
        return response(body.stream);
      },
    });
    const source = new EventSource("https://events.example/feed");
    let errors = 0;
    source.onerror = () => errors++;
    await until(clock, () => source.readyState === EventSource.OPEN, "stream open");
    if (operation === "public close") source.close();
    else runtime.close();
    await until(clock, () => body.cancellations.length !== 0, "ordinary request cancellation");
    const request = requests[0];
    assert.ok(request);
    assert.equal(request.signal.aborted, true);
    assert.ok(request.signal.reason instanceof DOMException);
    assert.equal(request.signal.reason.name, "AbortError");
    assert.equal(body.cancellations[0], request.signal.reason);
    source.close();
    runtime.close();
    await checkpoint();
    clock.runPending();
    assert.equal(body.cancellations.length, 1);
    assert.equal(body.stream.locked, false);
    assert.equal(errors, 0);
    assert.equal(source.readyState, EventSource.CLOSED);
    assert.equal(clock.nextDeadline, null);
  });
}
