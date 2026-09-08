// @ts-nocheck -- converted from `.mjs` and not yet typed.
//
// This file was JavaScript until the suite moved to running TypeScript source directly,
// and it was never type-checked. The pragma says so out loud rather than leaving the
// `.ts` extension to imply a guarantee that does not hold. Removing it is a per-file
// job: `grep -lc "@ts-nocheck" test/*.ts` is the remaining list.
import assert from "node:assert/strict";
import test from "node:test";

import { createHostNodeWebPlatform } from "../node-runtime.ts";
import {
  Event,
  EventSource,
  MessageEvent,
  ReadableStream,
  TextEncoder,
} from "../../../../runtime/web-platform/src/index.ts";
import {
  EventStreamParser,
  readEventSourcePolicy,
} from "../../../../runtime/web-platform/src/eventsource/event-source.ts";

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

function response(body, contentType = "text/event-stream; charset=utf-8", status = 200) {
  return {
    status,
    statusText: status === 200 ? "OK" : "No Content",
    headers: [["content-type", contentType]],
    body,
  };
}

test("event-stream parser handles every line ending, fields, retry and incomplete EOF", async () => {
  const events = [];
  const ids = [];
  const retries = [];
  const parser = new EventStreamParser(
    {
      async dispatchParsedEvent(event) {
        events.push(event);
      },
      setLastEventId(value) {
        ids.push(value);
      },
      setReconnectDelay(value) {
        retries.push(value);
      },
    },
    readEventSourcePolicy(undefined),
  );

  await parser.push(": comment\rdata:first\r");
  await parser.push("\ndata: second\nevent:custom\nid:7\r\nretry:25\r\n\r");
  await parser.push("\ndata\n\nid:\nid:bad\0value\n\ndata:discarded-at-eof");
  parser.finish();

  assert.deepEqual(events, [
    { type: "custom", data: "first\nsecond", lastEventId: "7" },
    { type: "message", data: "", lastEventId: "7" },
  ]);
  assert.deepEqual(ids, ["7", "7", ""]);
  assert.deepEqual(retries, [25]);
});

test("event-stream parser enforces independent line and event limits", async () => {
  const target = {
    async dispatchParsedEvent() {},
    setLastEventId() {},
    setReconnectDelay() {},
  };
  const lineLimited = new EventStreamParser(target, {
    initialReconnectDelayMs: 0,
    maxEventBufferCharacters: 100,
    maxLineBufferCharacters: 4,
  });
  await assert.rejects(lineLimited.push("data:too-long"), /line exceeded/);

  const eventLimited = new EventStreamParser(target, {
    initialReconnectDelayMs: 0,
    maxEventBufferCharacters: 4,
    maxLineBufferCharacters: 100,
  });
  await assert.rejects(eventLimited.push("data:abcd\n"), /event exceeded/);
});

test("EventSource streams messages, reconnects with Last-Event-ID and fails on 204", async (t) => {
  const requests = [];
  const secondRequest = Promise.withResolvers();
  const transport = {
    async dispatch(request) {
      requests.push(request);
      if (requests.length === 1) {
        return response(
          streamOf("\ufeffdata:first\r", "\ndata:second\nid: 7\nevent: custom\nretry: 0\n\n"),
        );
      }
      secondRequest.resolve();
      return response(null, "text/event-stream", 204);
    },
  };
  const runtime = createHostNodeWebPlatform({
    baseURL: "https://events.example/base/",
    eventSource: { initialReconnectDelayMs: 1000 },
    fetchTransport: transport,
  });
  t.after(() => runtime.close());

  const source = new EventSource("feed", { withCredentials: 1 });
  assert.equal(source.url, "https://events.example/base/feed");
  assert.equal(source.withCredentials, true);
  assert.equal(source.readyState, EventSource.CONNECTING);
  assert.deepEqual(
    [source.CONNECTING, source.OPEN, source.CLOSED],
    [EventSource.CONNECTING, EventSource.OPEN, EventSource.CLOSED],
  );

  const log = [];
  const message = Promise.withResolvers();
  source.onopen = function (event) {
    assert.equal(this, source);
    assert.ok(event instanceof Event);
    assert.equal(event.isTrusted, true);
    log.push("open");
  };
  source.addEventListener("custom", (event) => {
    assert.ok(event instanceof MessageEvent);
    assert.equal(event.data, "first\nsecond");
    assert.equal(event.lastEventId, "7");
    assert.equal(event.origin, "https://events.example");
    assert.equal(event.isTrusted, true);
    log.push("custom");
    message.resolve();
  });
  source.onerror = function () {
    assert.equal(this, source);
    log.push(source.readyState === EventSource.CLOSED ? "fatal" : "retry");
  };

  await message.promise;
  await secondRequest.promise;
  while (source.readyState !== EventSource.CLOSED) await tick();

  assert.deepEqual(log, ["open", "custom", "retry", "fatal"]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers.find(([name]) => name === "accept")?.[1], "text/event-stream");
  assert.equal(
    requests[0].headers.find(([name]) => name === "last-event-id"),
    undefined,
  );
  assert.equal(requests[1].headers.find(([name]) => name === "last-event-id")?.[1], "7");
});

test("EventSource close aborts transport and cancels a pending reconnect", async (t) => {
  let attempts = 0;
  const firstError = Promise.withResolvers();
  const transport = {
    async dispatch() {
      attempts++;
      throw new Error("offline");
    },
  };
  const runtime = createHostNodeWebPlatform({
    eventSource: { initialReconnectDelayMs: 60_000 },
    fetchTransport: transport,
  });
  t.after(() => runtime.close());
  const source = new EventSource("https://events.example/feed");
  source.onerror = () => firstError.resolve();
  await firstError.promise;
  assert.equal(source.readyState, EventSource.CONNECTING);
  source.close();
  source.close();
  assert.equal(source.readyState, EventSource.CLOSED);
  await tick();
  assert.equal(attempts, 1);

  const pendingRuntime = createHostNodeWebPlatform({
    fetchTransport: {
      dispatch() {
        return new Promise(() => {});
      },
    },
  });
  t.after(() => pendingRuntime.close());
  const pending = new EventSource("https://events.example/pending");
  await tick();
  pendingRuntime.close();
  await tick();
  assert.equal(pending.readyState, EventSource.CLOSED);
});

test("EventSource conversion and fatal response behavior are deterministic", async (t) => {
  const runtime = createHostNodeWebPlatform({
    baseURL: "https://events.example/",
    fetchTransport: {
      async dispatch() {
        return response(streamOf("data:nope\n\n"), "text/plain");
      },
    },
  });
  t.after(() => runtime.close());
  assert.throws(() => new EventSource(), TypeError);
  assert.throws(
    () => new EventSource("http://[invalid"),
    (error) => error.name === "SyntaxError",
  );
  assert.throws(() => new EventSource("feed", 1), TypeError);

  const source = new EventSource("feed");
  const failed = Promise.withResolvers();
  source.onerror = (event) => failed.resolve(event);
  const event = await failed.promise;
  assert.ok(event instanceof Event);
  assert.equal(source.readyState, EventSource.CLOSED);
});
