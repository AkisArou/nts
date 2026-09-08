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
  Agent,
  AgentOriginLimitError,
  AgentPendingLimitError,
  Client,
} from "../../../../runtime/web-platform/src/index.ts";
import { createHostNodePrimitives } from "../node-primitives.ts";

function request(origin, path = "/", signal = new AbortController().signal) {
  const primitives = createHostNodePrimitives();
  return {
    url: primitives.urls.parse(origin + path),
    method: "GET",
    headers: [],
    body: null,
    bodyLength: null,
    signal,
  };
}

class FakeDispatcher {
  constructor(origin) {
    this.origin = origin;
    this.idle = true;
    this.requests = [];
    this.closeCalls = 0;
    this.destroyReasons = [];
    this.closeGate = null;
    this.stats = { connections: 1, pending: 0, running: 0 };
  }

  dispatch(value) {
    this.requests.push(value);
    return Promise.resolve({
      status: 200,
      statusText: this.origin,
      headers: [],
      body: null,
    });
  }

  close() {
    this.closeCalls++;
    return this.closeGate?.promise ?? Promise.resolve();
  }

  destroy(reason) {
    this.destroyReasons.push(reason);
    return Promise.resolve();
  }
}

function agent(options = {}) {
  const created = [];
  const value = new Agent({
    factory: {
      create(origin) {
        const dispatcher = new FakeDispatcher(origin);
        created.push(dispatcher);
        return dispatcher;
      },
    },
    ...options,
  });
  return { agent: value, created };
}

test("Agent lazily creates and reuses one dispatcher per canonical origin", async () => {
  const state = agent();
  const one = await state.agent.dispatch(request("https://one.test", "/a"));
  const two = await state.agent.dispatch(request("https://one.test", "/b"));
  const three = await state.agent.dispatch(request("http://two.test"));
  assert.equal(one.statusText, "https://one.test");
  assert.equal(two.statusText, "https://one.test");
  assert.equal(three.statusText, "http://two.test");
  assert.equal(state.created.length, 2);
  assert.equal(state.created[0].requests.length, 2);
  assert.deepEqual(state.agent.stats, {
    origins: 2,
    idleOrigins: 2,
    connections: 2,
    pending: 0,
    running: 0,
    dispatched: 3,
    evicted: 0,
    pendingOriginAcquisitions: 0,
    entries: [
      {
        origin: "https://one.test",
        idle: true,
        connections: 1,
        pending: 0,
        running: 0,
      },
      {
        origin: "http://two.test",
        idle: true,
        connections: 1,
        pending: 0,
        running: 0,
      },
    ],
  });
});

test("bounded Agent evicts the least-recently-used idle origin and awaits close", async () => {
  const state = agent({ maximumOrigins: 2 });
  await state.agent.dispatch(request("https://old.test"));
  await state.agent.dispatch(request("https://recent.test"));
  await state.agent.dispatch(request("https://old.test"));
  const recent = state.created[1];
  recent.closeGate = Promise.withResolvers();
  const pending = state.agent.dispatch(request("https://new.test"));
  await Promise.resolve();
  assert.equal(recent.closeCalls, 1);
  assert.equal(state.created.length, 2);
  recent.closeGate.resolve();
  await pending;
  assert.equal(state.created.length, 3);
  assert.deepEqual(
    state.agent.stats.entries.map((entry) => entry.origin),
    ["https://old.test", "https://new.test"],
  );
  assert.equal(state.agent.stats.evicted, 1);
});

test("a failed eviction close restores the old origin and preserves the bound", async () => {
  const state = agent({ maximumOrigins: 1 });
  await state.agent.dispatch(request("https://old.test"));
  const failure = new Error("close failed");
  state.created[0].closeGate = Promise.withResolvers();
  const pending = state.agent.dispatch(request("https://new.test"));
  await Promise.resolve();
  state.created[0].closeGate.reject(failure);
  await assert.rejects(pending, (error) => error === failure);
  assert.equal(state.created.length, 1);
  assert.equal(state.agent.stats.origins, 1);
  assert.equal(state.agent.stats.entries[0].origin, "https://old.test");
  assert.equal(state.agent.stats.evicted, 0);
});

test("origin pressure never evicts a dispatcher with live work", async () => {
  const state = agent({ maximumOrigins: 1 });
  await state.agent.dispatch(request("https://busy.test"));
  state.created[0].idle = false;
  await assert.rejects(
    state.agent.dispatch(request("https://blocked.test")),
    (error) =>
      error instanceof AgentOriginLimitError &&
      error.code === "UND_ERR_MAX_ORIGINS_REACHED" &&
      error.maximumOrigins === 1,
  );
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0].closeCalls, 0);
});

test("an abort during serialized eviction does not create the replacement", async () => {
  const state = agent({ maximumOrigins: 1 });
  await state.agent.dispatch(request("https://old.test"));
  const closeGate = Promise.withResolvers();
  state.created[0].closeGate = closeGate;
  const controller = new AbortController();
  const failure = new Error("stop waiting");
  const pending = state.agent.dispatch(request("https://new.test", "/", controller.signal));
  await Promise.resolve();
  controller.abort(failure);
  closeGate.resolve();
  await assert.rejects(pending, (error) => error === failure);
  assert.equal(state.created.length, 1);
  assert.equal(state.agent.stats.origins, 0);
});

test("the origin-creation queue has explicit bounded backpressure", async () => {
  const state = agent({ maximumOrigins: 1, maximumPendingOrigins: 1 });
  await state.agent.dispatch(request("https://old.test"));
  const closeGate = Promise.withResolvers();
  state.created[0].closeGate = closeGate;
  const first = state.agent.dispatch(request("https://one.test"));
  await Promise.resolve();
  await assert.rejects(
    state.agent.dispatch(request("https://two.test")),
    (error) =>
      error instanceof AgentPendingLimitError &&
      error.code === "UND_ERR_AGENT_QUEUE_FULL" &&
      error.maximumPendingOrigins === 1,
  );
  assert.equal(state.agent.stats.pendingOriginAcquisitions, 1);
  closeGate.resolve();
  await first;
  assert.equal(state.agent.stats.pendingOriginAcquisitions, 0);
});

test("concurrent first requests serialize origin creation without duplicates", async () => {
  const state = agent();
  await Promise.all([
    state.agent.dispatch(request("https://same.test", "/one")),
    state.agent.dispatch(request("https://same.test", "/two")),
    state.agent.dispatch(request("https://same.test", "/three")),
  ]);
  assert.equal(state.created.length, 1);
  assert.equal(state.created[0].requests.length, 3);
});

test("Agent close is graceful, idempotent, and rejects new dispatch", async () => {
  const state = agent();
  await Promise.all([
    state.agent.dispatch(request("https://one.test")),
    state.agent.dispatch(request("https://two.test")),
  ]);
  const first = state.agent.close();
  const second = state.agent.close();
  assert.equal(first, second);
  assert.equal(state.agent.closed, true);
  await assert.rejects(state.agent.dispatch(request("https://three.test")), TypeError);
  await first;
  assert.equal(state.agent.destroyed, true);
  assert.deepEqual(
    state.created.map((dispatcher) => dispatcher.closeCalls),
    [1, 1],
  );
  assert.equal(state.agent.stats.origins, 0);
});

test("Agent destroy forwards the exact reason to every owned dispatcher", async () => {
  const state = agent();
  await Promise.all([
    state.agent.dispatch(request("https://one.test")),
    state.agent.dispatch(request("https://two.test")),
  ]);
  const reason = new Error("destroy now");
  const first = state.agent.destroy(reason);
  const second = state.agent.destroy(new Error("ignored"));
  assert.equal(first, second);
  await first;
  assert.equal(state.agent.closed, true);
  assert.equal(state.agent.destroyed, true);
  for (const dispatcher of state.created) {
    assert.deepEqual(dispatcher.destroyReasons, [reason]);
  }
});

test("Client enforces its canonical origin and owns lifecycle", async () => {
  const dispatcher = new FakeDispatcher("https://client.test");
  const client = new Client("https://client.test", dispatcher);
  assert.equal((await client.dispatch(request("https://client.test"))).status, 200);
  await assert.rejects(client.dispatch(request("https://other.test")), TypeError);
  assert.equal(client.stats, dispatcher.stats);
  const closing = client.close();
  assert.equal(closing, client.close());
  await closing;
  assert.equal(client.closed, true);
  assert.equal(client.destroyed, true);
  await assert.rejects(client.dispatch(request("https://client.test")), TypeError);
});

test("factory and synchronous dispatcher errors retain exact identity", async () => {
  const factoryFailure = new Error("factory failed");
  const broken = new Agent({
    factory: {
      create() {
        throw factoryFailure;
      },
    },
  });
  await assert.rejects(broken.dispatch(request("https://factory.test")), (error) => {
    return error === factoryFailure;
  });

  const dispatchFailure = new Error("dispatch failed");
  const dispatcher = new FakeDispatcher("https://client.test");
  dispatcher.dispatch = () => {
    throw dispatchFailure;
  };
  const client = new Client("https://client.test", dispatcher);
  await assert.rejects(client.dispatch(request("https://client.test")), (error) => {
    return error === dispatchFailure;
  });
});

test("Agent validates bounds and refuses non-network origins", async () => {
  assert.throws(() => agent({ maximumOrigins: 0 }), RangeError);
  assert.throws(() => agent({ maximumOrigins: 1.5 }), RangeError);
  assert.throws(() => agent({ maximumPendingOrigins: 0 }), RangeError);
  const state = agent();
  await assert.rejects(state.agent.dispatch(request("data:text/plain,hello")), TypeError);
  assert.equal(state.created.length, 0);
});
