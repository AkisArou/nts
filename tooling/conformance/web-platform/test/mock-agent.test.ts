// @ts-nocheck -- converted from `.mjs` and not yet typed.
//
// This file was JavaScript until the suite moved to running TypeScript source directly,
// and it was never type-checked. The pragma says so out loud rather than leaving the
// `.ts` extension to imply a guarantee that does not hold. Removing it is a per-file
// job: `grep -lc "@ts-nocheck" test/*.ts` is the remaining list.
import test from "node:test";
import assert from "node:assert/strict";
import {
  AbortController,
  Headers,
  MockAgent,
  MockNotMatchedError,
  ReadableStream,
} from "../../../../runtime/web-platform/src/index.ts";
import { createHostNodePrimitives } from "../node-primitives.ts";

function stream(...chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });
}

function request(primitives, url, overrides = {}) {
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

async function consume(body) {
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const bytes = [];
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      bytes.push(...item.value);
    }
  } finally {
    reader.releaseLock();
  }
  return Uint8Array.from(bytes);
}

test("MockAgent matches typed request fields and exposes body, headers, trailers and history", async () => {
  const primitives = createHostNodePrimitives();
  const agent = new MockAgent(primitives.scheduler, { enableCallHistory: true });
  agent.disableNetConnect();
  const path = /^\/items/g;
  agent
    .get("https://example.test/")
    .intercept({
      path,
      method: "POST",
      query: "x=1",
      headers: [["x-match", "yes"]],
      body: (bytes, text) => bytes.length === 5 && text === "hello",
    })
    .defaultReplyHeaders([
      ["x-default", "one"],
      ["x-reply", "default"],
    ])
    .defaultReplyTrailers([["x-trailer", "done"]])
    .replyContentLength()
    .replyUsing((seen) => ({
      status: 201,
      statusText: "Created",
      body: seen.body,
      headers: [["x-reply", "two"]],
    }));

  assert.equal(agent.pendingInterceptors().length, 1);
  const response = await agent.dispatch(
    request(primitives, "https://example.test/items?x=1", {
      method: "POST",
      headers: [["x-match", "yes"]],
      body: stream([104, 101], [108, 108, 111]),
      bodyLength: 5,
    }),
  );
  assert.equal(response.status, 201);
  assert.equal(response.statusText, "Created");
  assert.equal(new TextDecoder().decode(await consume(response.body)), "hello");
  const headers = new Headers(response.headers);
  assert.equal(headers.get("x-default"), "one");
  assert.equal(headers.get("x-reply"), "two");
  assert.equal(headers.get("content-length"), "5");
  assert.deepEqual(await response.trailers, [["x-trailer", "done"]]);
  assert.equal(path.lastIndex, 0);
  agent.assertNoPendingInterceptors();

  const history = agent.getCallHistory();
  assert.equal(history.calls().length, 1);
  assert.equal(history.firstCall().method, "POST");
  assert.equal(history.lastCall().bodyText, "hello");
  assert.equal(history.nthCall(1).fullURL, "https://example.test/items?x=1");
  assert.equal(history.filterCalls((entry) => entry.path === "/items").length, 1);
  assert.equal([...history].length, 1);
  history.firstCall().body[0] = 0;
  assert.equal(history.firstCall().bodyText, "hello");
  assert.equal(history.firstCall().body[0], 104);
  const exposedHeaders = history.firstCall().headers;
  exposedHeaders.length = 0;
  assert.equal(history.firstCall().headers.length, 1);
  history.clear();
  assert.equal(history.calls().length, 0);
  await agent.close();
});

test("MockAgent close is graceful and shared by concurrent callers", async () => {
  const primitives = createHostNodePrimitives();
  const agent = new MockAgent(primitives.scheduler);
  agent.disableNetConnect();
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  agent
    .get("https://close.test")
    .intercept({ path: "/" })
    .replyUsing(async () => {
      started.resolve();
      await release.promise;
      return { status: 200, body: "done" };
    });
  const response = agent.dispatch(request(primitives, "https://close.test/"));
  await started.promise;
  let closed = false;
  const firstClose = agent.close().then(() => {
    closed = true;
  });
  const secondClose = agent.close();
  await Promise.resolve();
  assert.equal(closed, false);
  await assert.rejects(agent.dispatch(request(primitives, "https://close.test/")), /closed/);
  release.resolve();
  assert.equal(new TextDecoder().decode(await consume((await response).body)), "done");
  await Promise.all([firstClose, secondClose]);
  assert.equal(closed, true);
});

test("MockScope times and persist have explicit pending semantics", async () => {
  const primitives = createHostNodePrimitives();
  const agent = new MockAgent(primitives.scheduler);
  agent.disableNetConnect();
  const pool = agent.get("https://repeat.test");
  pool.intercept({ path: "/twice" }).reply(204).times(2);
  const persistent = pool.intercept({ path: "/always" }).reply(200, "ok").persist();
  pool.intercept({ path: "/once" }).reply(204);
  assert.equal(agent.pendingInterceptors().length, 3);
  await agent.dispatch(request(primitives, "https://repeat.test/twice"));
  assert.equal(agent.pendingInterceptors().length, 3);
  await agent.dispatch(request(primitives, "https://repeat.test/twice"));
  assert.equal(agent.pendingInterceptors().length, 2);
  await agent.dispatch(request(primitives, "https://repeat.test/always"));
  assert.equal(agent.pendingInterceptors().length, 1);
  await agent.dispatch(request(primitives, "https://repeat.test/always"));
  persistent.times(1);
  await agent.dispatch(request(primitives, "https://repeat.test/always"));
  await agent.dispatch(request(primitives, "https://repeat.test/once"));
  await assert.rejects(
    agent.dispatch(request(primitives, "https://repeat.test/once")),
    MockNotMatchedError,
  );
  agent.assertNoPendingInterceptors();
  await agent.close();
});

test("MockInterceptor registers replies, not incomplete builders, and snapshots defaults", async () => {
  const primitives = createHostNodePrimitives();
  const agent = new MockAgent(primitives.scheduler);
  agent.disableNetConnect();
  const pool = agent.get("https://builder.test");
  pool.intercept({ path: "/incomplete" });
  assert.equal(agent.pendingInterceptors().length, 0);
  const builder = pool.intercept({ path: "/sequence" });
  builder.defaultReplyHeaders([["x-version", "one"]]).reply(200, "first");
  builder.defaultReplyHeaders([["x-version", "two"]]).reply(200, "second");
  assert.equal(agent.pendingInterceptors().length, 2);
  const first = await agent.dispatch(request(primitives, "https://builder.test/sequence"));
  const second = await agent.dispatch(request(primitives, "https://builder.test/sequence"));
  assert.equal(new Headers(first.headers).get("x-version"), "one");
  assert.equal(new TextDecoder().decode(await consume(first.body)), "first");
  assert.equal(new Headers(second.headers).get("x-version"), "two");
  assert.equal(new TextDecoder().decode(await consume(second.body)), "second");
  agent.assertNoPendingInterceptors();
  await agent.close();
});

test("direct MockPool dispatch does not search a different overlapping pool", async () => {
  const primitives = createHostNodePrimitives();
  const agent = new MockAgent(primitives.scheduler);
  agent.disableNetConnect();
  const first = agent.get(/^https:\/\/overlap\.test$/);
  const second = agent.get((origin) => origin === "https://overlap.test");
  first.intercept({ path: "/" }).reply(200, "first");
  second.intercept({ path: "/" }).reply(200, "second");

  const response = await second.dispatch(request(primitives, "https://overlap.test/"));
  assert.equal(new TextDecoder().decode(await consume(response.body)), "second");
  assert.equal(agent.pendingInterceptors().length, 1);
  await agent.dispatch(request(primitives, "https://overlap.test/"));
  agent.assertNoPendingInterceptors();
  await agent.close();
});

test("MockAgent fallback replays the consumed request and applies network policy", async () => {
  const primitives = createHostNodePrimitives();
  const seen = [];
  const fallback = {
    async dispatch(value) {
      seen.push({ url: value.url.href, body: await consume(value.body) });
      return { status: 204, statusText: "", headers: [], body: null };
    },
  };
  const agent = new MockAgent(primitives.scheduler, { fallback });
  agent.disableNetConnect();
  agent.enableNetConnect("allowed.test");
  await agent.dispatch(
    request(primitives, "https://allowed.test/fallback", {
      method: "POST",
      body: stream([1, 2], [3, 4]),
      bodyLength: 4,
    }),
  );
  assert.deepEqual([...seen[0].body], [1, 2, 3, 4]);
  await assert.rejects(
    agent.dispatch(request(primitives, "https://blocked.test/")),
    (error) => error instanceof MockNotMatchedError && /disabled/.test(error.message),
  );
  agent.deactivate();
  await agent.dispatch(request(primitives, "https://blocked.test/deactivated"));
  assert.equal(seen.length, 2);
  agent.activate();
  await agent.close();
});

test("MockAgent delay observes exact abort reason and errors preserve identity", async () => {
  const primitives = createHostNodePrimitives();
  const agent = new MockAgent(primitives.scheduler);
  agent.disableNetConnect();
  const pool = agent.get("https://errors.test");
  pool.intercept({ path: "/delay" }).reply(200, "late").delay(1000);
  const expected = new Error("stop");
  const abort = new AbortController();
  const delayed = agent.dispatch(
    request(primitives, "https://errors.test/delay", { signal: abort.signal }),
  );
  abort.abort(expected);
  await assert.rejects(delayed, (error) => error === expected);

  const failure = new Error("expected failure");
  pool.intercept({ path: "/error" }).replyWithError(failure);
  await assert.rejects(
    agent.dispatch(request(primitives, "https://errors.test/error")),
    (error) => error === failure,
  );
  await agent.close();
});

test("MockAgent bounds captured request bodies before matching or fallback", async () => {
  const primitives = createHostNodePrimitives();
  let fallbacks = 0;
  const agent = new MockAgent(primitives.scheduler, {
    maxRequestBodyBytes: 3,
    fallback: {
      dispatch() {
        fallbacks++;
        return Promise.resolve({ status: 204, statusText: "", headers: [], body: null });
      },
    },
  });
  await assert.rejects(
    agent.dispatch(
      request(primitives, "https://large.test/", {
        method: "POST",
        body: stream([1, 2], [3, 4]),
        bodyLength: 4,
      }),
    ),
    (error) => error?.name === "LimitError",
  );
  assert.equal(fallbacks, 0);
  const exact = await agent.dispatch(
    request(primitives, "https://large.test/exact", {
      method: "POST",
      body: stream([1], [2, 3]),
      bodyLength: 3,
    }),
  );
  assert.equal(exact.status, 204);
  assert.equal(fallbacks, 1);
  await agent.close();
});

test("MockAgent call history has explicit bounded drop-oldest behavior", async () => {
  const primitives = createHostNodePrimitives();
  const agent = new MockAgent(primitives.scheduler, {
    enableCallHistory: true,
    maxCallHistoryEntries: 2,
  });
  agent.get("https://history.test").intercept({ path: /^\// }).reply(204).persist();
  for (const path of ["one", "two", "three"]) {
    await agent.dispatch(request(primitives, `https://history.test/${path}`));
  }
  const history = agent.getCallHistory();
  assert.deepEqual(
    history.calls().map((entry) => entry.path),
    ["/two", "/three"],
  );
  assert.equal(history.droppedEntries, 1);
  history.clear();
  assert.equal(history.droppedEntries, 0);
  await agent.close();
});
