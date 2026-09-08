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
  MemorySnapshotStore,
  ReadableStream,
  SnapshotAgent,
  SnapshotNotFoundError,
  TextDecoder,
  TextEncoder,
} from "../src/index.ts";
import { createHostNodePrimitives } from "../host/node-primitives.ts";

function stream(...chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk));
      controller.close();
    },
  });
}

function textStream(value) {
  return stream([...new TextEncoder().encode(value)]);
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

async function text(body) {
  return new TextDecoder().decode(await consume(body));
}

function matchingOptions() {
  return {
    matchHeaders: ["x-stable"],
    ignoreHeaders: ["x-volatile"],
    excludeHeaders: ["authorization", "set-cookie"],
    normalizeQuery(query) {
      return query.replace(/nonce=[^&]*/g, "nonce=<redacted>");
    },
    normalizeBody(body) {
      if (body === null) return null;
      const normalized = new TextDecoder().decode(body).replace(/[0-9]+/g, "<number>");
      return new TextEncoder().encode(normalized);
    },
    nowMilliseconds: () => 42,
  };
}

class ManualScheduler {
  timers = [];
  reported = [];

  enqueue(task) {
    queueMicrotask(task);
  }

  delay(milliseconds, task) {
    const timer = { milliseconds, task, active: true };
    this.timers.push(timer);
    return {
      cancel() {
        timer.active = false;
      },
    };
  }

  reportError(error) {
    this.reported.push(error);
  }

  runTimers() {
    for (const timer of this.timers.splice(0)) {
      if (!timer.active) continue;
      timer.active = false;
      timer.task();
    }
  }
}

test("SnapshotAgent records, redacts and replays sequential responses deterministically", async () => {
  const primitives = createHostNodePrimitives();
  const store = new MemorySnapshotStore();
  const seen = [];
  let sequence = 0;
  const fallback = {
    async dispatch(value) {
      sequence++;
      seen.push({
        url: value.url.href,
        headers: value.headers,
        body: await text(value.body),
      });
      return {
        status: 200 + sequence,
        statusText: "Recorded " + sequence,
        headers: [
          ["x-sequence", String(sequence)],
          ["set-cookie", "secret=response"],
        ],
        body: textStream("response-" + sequence),
        trailers: Promise.resolve([
          ["x-trailer", String(sequence)],
          ["set-cookie", "secret=trailer"],
        ]),
      };
    },
  };
  const record = new SnapshotAgent(primitives.scheduler, {
    ...matchingOptions(),
    mode: "record",
    store,
    fallback,
  });

  for (const nonce of ["one", "two"]) {
    const response = await record.dispatch(
      request(primitives, `https://snapshot.test/item?nonce=${nonce}`, {
        method: "POST",
        headers: [
          ["x-stable", "yes"],
          ["x-volatile", nonce],
          ["authorization", "Bearer " + nonce],
        ],
        body: textStream("event=" + (nonce === "one" ? "123" : "456")),
        bodyLength: 9,
      }),
    );
    assert.equal(await text(response.body), "response-" + sequence);
    assert.equal(new Headers(response.headers).get("set-cookie"), "secret=response");
  }
  assert.equal(seen.length, 2);
  assert.equal(seen[0].body, "event=123");
  assert.equal(new Headers(seen[0].headers).get("authorization"), "Bearer one");
  await record.close();

  const stored = await store.loadAll();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].responses.length, 2);
  assert.equal(stored[0].recordedAtMilliseconds, 42);
  assert.equal(stored[0].request.url, "https://snapshot.test/item?nonce=<redacted>");
  assert.equal(new TextDecoder().decode(stored[0].request.body), "event=<number>");
  assert.equal(new Headers(stored[0].request.headers).has("authorization"), false);
  assert.equal(new Headers(stored[0].responses[0].headers).has("set-cookie"), false);
  assert.equal(new Headers(stored[0].responses[0].trailers).has("set-cookie"), false);

  const playback = new SnapshotAgent(primitives.scheduler, {
    ...matchingOptions(),
    mode: "playback",
    store,
  });
  for (const expected of ["response-1", "response-2", "response-2"]) {
    const response = await playback.dispatch(
      request(primitives, "https://snapshot.test/item?nonce=new", {
        method: "POST",
        headers: [
          ["x-stable", "yes"],
          ["x-volatile", "different"],
          ["authorization", "Bearer replacement"],
        ],
        body: textStream("event=999"),
        bodyLength: 9,
      }),
    );
    assert.equal(await text(response.body), expected);
    assert.equal(new Headers(response.headers).has("set-cookie"), false);
  }
  assert.equal(playback.getRecorder().getSnapshots()[0].callCount, 3);
  playback.resetCallCounts();
  assert.equal(playback.getRecorder().getSnapshots()[0].callCount, 0);
  await assert.rejects(
    playback.dispatch(
      request(primitives, "https://snapshot.test/item?nonce=new", {
        method: "POST",
        headers: [["x-stable", "no"]],
        body: textStream("event=999"),
        bodyLength: 9,
      }),
    ),
    (error) =>
      error instanceof SnapshotNotFoundError &&
      error.code === "UND_SNAPSHOT_NOT_FOUND" &&
      error.message === "No snapshot found for POST https://snapshot.test/item?nonce=<redacted>",
  );
  await playback.close();
  assert.equal((await store.loadAll())[0].callCount, 0);
});

test("SnapshotAgent update replays hits and records misses", async () => {
  const primitives = createHostNodePrimitives();
  const store = new MemorySnapshotStore();
  let liveCalls = 0;
  const fallback = {
    dispatch(value) {
      liveCalls++;
      return Promise.resolve({
        status: 200,
        statusText: "",
        headers: [["x-live-path", value.url.pathname]],
        body: textStream(value.url.pathname),
      });
    },
  };
  const record = new SnapshotAgent(primitives.scheduler, {
    mode: "record",
    fallback,
    store,
  });
  await record.dispatch(request(primitives, "https://update.test/existing"));
  await record.close();
  assert.equal(liveCalls, 1);

  const update = new SnapshotAgent(primitives.scheduler, {
    mode: "update",
    fallback,
    store,
  });
  assert.equal(
    await text((await update.dispatch(request(primitives, "https://update.test/existing"))).body),
    "/existing",
  );
  assert.equal(liveCalls, 1);
  assert.equal(
    await text((await update.dispatch(request(primitives, "https://update.test/new"))).body),
    "/new",
  );
  assert.equal(liveCalls, 2);
  await update.close();
  assert.equal((await store.loadAll()).length, 2);
});

test("excluded URLs pass through without loading, capturing or recording", async () => {
  const primitives = createHostNodePrimitives();
  const loadFailure = new Error("store must not load");
  const store = {
    loadAll() {
      return Promise.reject(loadFailure);
    },
    replaceAll() {
      return Promise.reject(new Error("store must not save"));
    },
  };
  let received;
  const agent = new SnapshotAgent(primitives.scheduler, {
    mode: "playback",
    store,
    excludeURLs: ["passthrough.test"],
    fallback: {
      async dispatch(value) {
        received = await text(value.body);
        return { status: 204, statusText: "", headers: [], body: null };
      },
    },
  });
  const response = await agent.dispatch(
    request(primitives, "https://passthrough.test/", {
      method: "POST",
      body: textStream("original"),
      bodyLength: 8,
    }),
  );
  assert.equal(response.status, 204);
  assert.equal(received, "original");
  await agent.close();
});

test("response capture has an exact byte boundary and cancels an oversized body", async () => {
  const primitives = createHostNodePrimitives();
  const store = new MemorySnapshotStore();
  let cancelledWith;
  const agent = new SnapshotAgent(primitives.scheduler, {
    mode: "record",
    store,
    maxResponseBodyBytes: 3,
    fallback: {
      dispatch(value) {
        if (value.url.pathname === "/exact") {
          return Promise.resolve({
            status: 200,
            statusText: "",
            headers: [],
            body: stream([1], [2, 3]),
          });
        }
        return Promise.resolve({
          status: 200,
          statusText: "",
          headers: [],
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(Uint8Array.of(1, 2));
              controller.enqueue(Uint8Array.of(3, 4));
            },
            cancel(reason) {
              cancelledWith = reason;
            },
          }),
        });
      },
    },
  });
  assert.deepEqual(
    [
      ...(await consume(
        (await agent.dispatch(request(primitives, "https://limit.test/exact"))).body,
      )),
    ],
    [1, 2, 3],
  );
  await assert.rejects(
    agent.dispatch(request(primitives, "https://limit.test/large")),
    (error) => error?.name === "LimitError",
  );
  assert.equal(cancelledWith?.name, "LimitError");
  assert.equal(agent.getRecorder().size(), 1);
  await agent.close();
});

test("snapshot store keys and bounds are validated before playback", async () => {
  const primitives = createHostNodePrimitives();
  const store = new MemorySnapshotStore([
    {
      key: "forged",
      request: { method: "GET", url: "https://invalid.test/", headers: [], body: null },
      responses: [{ status: 200, statusText: "", headers: [], body: null, trailers: [] }],
      callCount: 0,
      recordedAtMilliseconds: 0,
    },
  ]);
  const agent = new SnapshotAgent(primitives.scheduler, { mode: "playback", store });
  await assert.rejects(
    agent.dispatch(request(primitives, "https://invalid.test/")),
    /key does not match/,
  );
  await agent.close();
});

test("snapshot saves are serialized so an older write cannot replace a newer one", async () => {
  const primitives = createHostNodePrimitives();
  const firstStarted = Promise.withResolvers();
  const releaseFirst = Promise.withResolvers();
  const lengths = [];
  let stored = [];
  const store = {
    loadAll() {
      return Promise.resolve(stored);
    },
    async replaceAll(snapshots) {
      lengths.push(snapshots.length);
      if (lengths.length === 1) {
        firstStarted.resolve();
        await releaseFirst.promise;
      }
      stored = snapshots;
    },
  };
  const agent = new SnapshotAgent(primitives.scheduler, {
    mode: "record",
    store,
    fallback: {
      dispatch() {
        return Promise.resolve({ status: 204, statusText: "", headers: [], body: null });
      },
    },
  });
  await agent.dispatch(request(primitives, "https://serialized.test/one"));
  const firstSave = agent.saveSnapshots();
  await firstStarted.promise;
  await agent.dispatch(request(primitives, "https://serialized.test/two"));
  const secondSave = agent.saveSnapshots();
  await Promise.resolve();
  assert.deepEqual(lengths, [1]);
  releaseFirst.resolve();
  await Promise.all([firstSave, secondSave]);
  assert.deepEqual(lengths, [1, 2]);
  assert.equal(stored.length, 2);
  await agent.close();
});

test("auto flush uses the injected scheduler and persistent store", async () => {
  const primitives = createHostNodePrimitives();
  const scheduler = new ManualScheduler();
  const store = new MemorySnapshotStore();
  const saved = Promise.withResolvers();
  const observedStore = {
    loadAll() {
      return store.loadAll();
    },
    async replaceAll(snapshots) {
      await store.replaceAll(snapshots);
      saved.resolve();
    },
  };
  const agent = new SnapshotAgent(scheduler, {
    mode: "record",
    store: observedStore,
    autoFlush: true,
    flushIntervalMilliseconds: 25,
    fallback: {
      dispatch() {
        return Promise.resolve({ status: 204, statusText: "", headers: [], body: null });
      },
    },
  });
  await agent.dispatch(request(primitives, "https://flush.test/"));
  assert.equal((await store.loadAll()).length, 0);
  assert.equal(scheduler.timers.length, 1);
  assert.equal(scheduler.timers[0].milliseconds, 25);
  scheduler.runTimers();
  await saved.promise;
  await Promise.resolve();
  assert.equal((await store.loadAll()).length, 1);
  assert.deepEqual(scheduler.reported, []);
  await agent.close();
});

test("snapshot count eviction is bounded and deterministic", async () => {
  const primitives = createHostNodePrimitives();
  const store = new MemorySnapshotStore();
  const record = new SnapshotAgent(primitives.scheduler, {
    mode: "record",
    store,
    maxSnapshots: 2,
    fallback: {
      dispatch(value) {
        return Promise.resolve({
          status: 200,
          statusText: "",
          headers: [],
          body: textStream(value.url.pathname),
        });
      },
    },
  });
  for (const path of ["one", "two", "three"]) {
    await record.dispatch(request(primitives, `https://eviction.test/${path}`));
  }
  await record.close();
  const snapshots = await store.loadAll();
  assert.deepEqual(
    snapshots.map((snapshot) => snapshot.request.url),
    ["https://eviction.test/two", "https://eviction.test/three"],
  );
});
