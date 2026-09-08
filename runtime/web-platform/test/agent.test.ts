import test from "node:test";
import assert from "node:assert/strict";
import {
  AbortController,
  Agent,
  AgentOriginLimitError,
  AgentPendingLimitError,
  Client,
} from "../src/index.ts";
import { createHostNodePrimitives } from "../host/node-primitives.ts";
import type { OriginDispatcher } from "../src/dispatch/agent.ts";
import type {
  FetchTransport,
  TransportRequest,
  TransportResponse,
} from "../src/fetch/transport.ts";
import type { AbortSignal } from "../src/index.ts";
import { must } from "./harness.ts";

function request(
  origin: string,
  path = "/",
  signal: AbortSignal = new AbortController().signal,
): TransportRequest {
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

class FakeDispatcher implements OriginDispatcher {
  readonly origin: string;
  idle = true;
  readonly requests: TransportRequest[] = [];
  closeCalls = 0;
  readonly destroyReasons: unknown[] = [];
  /** Set by a test that wants `close()` to stay pending until it decides otherwise. */
  closeGate: PromiseWithResolvers<void> | null = null;
  stats = { connections: 1, pending: 0, running: 0 };

  constructor(origin: string) {
    this.origin = origin;
  }

  dispatch(value: TransportRequest): Promise<TransportResponse> {
    this.requests.push(value);
    return Promise.resolve({
      status: 200,
      statusText: this.origin,
      headers: [],
      body: null,
    });
  }

  close(): Promise<void> {
    this.closeCalls++;
    return this.closeGate?.promise ?? Promise.resolve();
  }

  destroy(reason?: unknown): Promise<void> {
    this.destroyReasons.push(reason);
    return Promise.resolve();
  }
}

/**
 * The dispatcher the agent created at `index`, asserted present.
 *
 * The tests index this list right after asserting how long it is, so the element is there --
 * saying so once beats a non-null assertion at each of the eight sites, and a run where the
 * agent created fewer than expected now fails with that sentence.
 */
function createdAt(state: { created: FakeDispatcher[] }, index: number): FakeDispatcher {
  const dispatcher = state.created[index];
  assert.ok(dispatcher !== undefined, `the agent did not create a dispatcher at ${index}`);
  return dispatcher;
}

function agent(options = {}) {
  const created: FakeDispatcher[] = [];
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
  assert.equal(createdAt(state, 0).requests.length, 2);
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
  const recent = createdAt(state, 1);
  recent.closeGate = Promise.withResolvers<void>();
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
  createdAt(state, 0).closeGate = Promise.withResolvers<void>();
  const pending = state.agent.dispatch(request("https://new.test"));
  await Promise.resolve();
  must(createdAt(state, 0).closeGate, "the gate was just installed").reject(failure);
  await assert.rejects(pending, (error: unknown) => error === failure);
  assert.equal(state.created.length, 1);
  assert.equal(state.agent.stats.origins, 1);
  assert.equal(must(state.agent.stats.entries[0], "the agent kept one entry").origin, "https://old.test");
  assert.equal(state.agent.stats.evicted, 0);
});

test("origin pressure never evicts a dispatcher with live work", async () => {
  const state = agent({ maximumOrigins: 1 });
  await state.agent.dispatch(request("https://busy.test"));
  createdAt(state, 0).idle = false;
  await assert.rejects(
    state.agent.dispatch(request("https://blocked.test")),
    (error: unknown) =>
      error instanceof AgentOriginLimitError &&
      error.code === "UND_ERR_MAX_ORIGINS_REACHED" &&
      error.maximumOrigins === 1,
  );
  assert.equal(state.created.length, 1);
  assert.equal(createdAt(state, 0).closeCalls, 0);
});

test("an abort during serialized eviction does not create the replacement", async () => {
  const state = agent({ maximumOrigins: 1 });
  await state.agent.dispatch(request("https://old.test"));
  const closeGate = Promise.withResolvers<void>();
  createdAt(state, 0).closeGate = closeGate;
  const controller = new AbortController();
  const failure = new Error("stop waiting");
  const pending = state.agent.dispatch(request("https://new.test", "/", controller.signal));
  await Promise.resolve();
  controller.abort(failure);
  closeGate.resolve();
  await assert.rejects(pending, (error: unknown) => error === failure);
  assert.equal(state.created.length, 1);
  assert.equal(state.agent.stats.origins, 0);
});

test("the origin-creation queue has explicit bounded backpressure", async () => {
  const state = agent({ maximumOrigins: 1, maximumPendingOrigins: 1 });
  await state.agent.dispatch(request("https://old.test"));
  const closeGate = Promise.withResolvers<void>();
  createdAt(state, 0).closeGate = closeGate;
  const first = state.agent.dispatch(request("https://one.test"));
  await Promise.resolve();
  await assert.rejects(
    state.agent.dispatch(request("https://two.test")),
    (error: unknown) =>
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
  assert.equal(createdAt(state, 0).requests.length, 3);
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
  await assert.rejects(broken.dispatch(request("https://factory.test")), (error: unknown) => {
    return error === factoryFailure;
  });

  const dispatchFailure = new Error("dispatch failed");
  const dispatcher = new FakeDispatcher("https://client.test");
  dispatcher.dispatch = () => {
    throw dispatchFailure;
  };
  const client = new Client("https://client.test", dispatcher);
  await assert.rejects(client.dispatch(request("https://client.test")), (error: unknown) => {
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
