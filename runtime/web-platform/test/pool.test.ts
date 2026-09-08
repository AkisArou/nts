import test from "node:test";
import assert from "node:assert/strict";
import {
  AbortController,
  BalancedPool,
  BalancedPoolLimitError,
  BalancedPoolMissingUpstreamError,
  Pool,
  RoundRobinPool,
  TransportError,
} from "../src/index.ts";
import { createHostNodePrimitives } from "../host/node-primitives.ts";
import { must } from "./harness.ts";
import type { OriginDispatcher } from "../src/dispatch/agent.ts";
import type {
  TransportRequest,
  TransportResponse,
} from "../src/fetch/transport.ts";

const primitives = createHostNodePrimitives();
const publicOrigin = primitives.urls.parse("https://public.test");

function request(path = "/resource?value=1"): TransportRequest {
  return {
    url: primitives.urls.parse("https://public.test" + path),
    method: "GET",
    headers: [],
    body: null,
    bodyLength: null,
    signal: new AbortController().signal,
  };
}

class FakeDispatcher implements OriginDispatcher {
  readonly name: string;
  idle = true;
  readonly requests: TransportRequest[] = [];
  closeCalls = 0;
  readonly destroyReasons: unknown[] = [];
  /** Set by a test that wants the next dispatch to fail with this value. */
  failNext: unknown = null;
  stats = { connections: 1, pending: 0, running: 0 };

  constructor(name: string) {
    this.name = name;
  }

  dispatch(value: TransportRequest): Promise<TransportResponse> {
    this.requests.push(value);
    if (this.failNext !== null) {
      const failure = this.failNext;
      this.failNext = null;
      return Promise.reject(failure);
    }
    return Promise.resolve({ status: 200, statusText: this.name, headers: [], body: null });
  }

  close(): Promise<void> {
    this.closeCalls++;
    return Promise.resolve();
  }

  destroy(reason?: unknown): Promise<void> {
    this.destroyReasons.push(reason);
    return Promise.resolve();
  }
}

function upstream(origin: string, dispatcher: OriginDispatcher, weight?: number) {
  return { url: primitives.urls.parse(origin), dispatcher, weight };
}

test("RoundRobinPool rotates fixed members and aggregates live stats", async () => {
  const one = new FakeDispatcher("one");
  const two = new FakeDispatcher("two");
  two.stats = { connections: 2, pending: 3, running: 4 };
  two.idle = false;
  const pool = new RoundRobinPool(publicOrigin, [one, two]);
  const answers: string[] = [];
  for (let index = 0; index < 5; index++) {
    answers.push((await pool.dispatch(request())).statusText);
  }
  assert.deepEqual(answers, ["one", "two", "one", "two", "one"]);
  assert.deepEqual(pool.stats, {
    dispatchers: 2,
    idleDispatchers: 1,
    connections: 3,
    pending: 3,
    running: 4,
    dispatched: 5,
  });
  assert.equal(pool.idle, false);
  assert.throws(() => new Pool(publicOrigin, []), RangeError);
  // Built with the other origin rather than mutated into it: `TransportRequest.url` is
  // readonly, and the point is only that the pool refuses a request it does not own.
  const wrongOrigin: TransportRequest = {
    ...request(),
    url: primitives.urls.parse("https://other.test/path"),
  };
  await assert.rejects(pool.dispatch(wrongOrigin), TypeError);
});

test("Pool close is idempotent and destroy forwards exact reasons", async () => {
  const one = new FakeDispatcher("one");
  const two = new FakeDispatcher("two");
  const pool = new Pool(publicOrigin, [one, two]);
  const closing = pool.close();
  assert.equal(closing, pool.close());
  await closing;
  assert.equal(pool.closed, true);
  assert.equal(pool.destroyed, true);
  assert.deepEqual([one.closeCalls, two.closeCalls], [1, 1]);
  await assert.rejects(pool.dispatch(request()), TypeError);

  const three = new FakeDispatcher("three");
  const four = new FakeDispatcher("four");
  const destroyed = new Pool(publicOrigin, [three, four]);
  const reason = new Error("stop");
  await destroyed.destroy(reason);
  assert.deepEqual(three.destroyReasons, [reason]);
  assert.deepEqual(four.destroyReasons, [reason]);
});

test("BalancedPool uses smooth configured weights and rewrites only the URL origin", async () => {
  const one = new FakeDispatcher("one");
  const two = new FakeDispatcher("two");
  const pool = new BalancedPool([
    upstream("https://one.internal/base?ignored=1", one, 2),
    upstream("http://two.internal/ignored", two, 1),
  ]);
  const original = request("/path?q=visible#fragment");
  const answers: string[] = [];
  for (let index = 0; index < 6; index++) {
    answers.push((await pool.dispatch(original)).statusText);
  }
  assert.deepEqual(answers, ["one", "two", "one", "one", "two", "one"]);
  assert.equal(original.url.origin, "https://public.test");
  assert.equal(must(one.requests[0], "that dispatcher saw the request").url.href, "https://one.internal/path?q=visible#fragment");
  assert.equal(must(two.requests[0], "that dispatcher saw the request").url.href, "http://two.internal/path?q=visible#fragment");
  assert.equal(must(one.requests[0], "that dispatcher saw the request").body, original.body);
  assert.equal(must(one.requests[0], "that dispatcher saw the request").signal, original.signal);
  assert.deepEqual(pool.upstreams, ["https://one.internal", "http://two.internal"]);
});

test("only typed transport failures reduce upstream health and success restores it", async () => {
  const one = new FakeDispatcher("one");
  const two = new FakeDispatcher("two");
  const pool = new BalancedPool(
    [upstream("https://one.test", one), upstream("https://two.test", two)],
    { errorPenalty: 99 },
  );
  const networkFailure = new TransportError("ECONNRESET", "reset");
  one.failNext = networkFailure;
  await assert.rejects(pool.dispatch(request()), (error: unknown) => error === networkFailure);
  assert.equal(must(pool.stats.entries[0], "the pool tracks that upstream").healthWeight, 1);
  assert.equal(must(pool.stats.entries[0], "the pool tracks that upstream").failures, 1);
  assert.equal((await pool.dispatch(request())).statusText, "two");

  const policyFailure = new TypeError("bad request");
  two.failNext = policyFailure;
  await assert.rejects(pool.dispatch(request()), (error: unknown) => error === policyFailure);
  assert.equal(must(pool.stats.entries[1], "the pool tracks that upstream").healthWeight, 100);
});

test("BalancedPool mutation is bounded, duplicate-safe, and closes removals", async () => {
  const one = new FakeDispatcher("one");
  const duplicate = new FakeDispatcher("duplicate");
  const pool = new BalancedPool([], { maximumUpstreams: 1 });
  assert.equal(pool.addUpstream(upstream("https://one.test", one)), true);
  assert.equal(pool.addUpstream(upstream("https://one.test/other", duplicate)), false);
  assert.equal(duplicate.closeCalls, 0);
  assert.throws(
    () => pool.addUpstream(upstream("https://two.test", new FakeDispatcher("two"))),
    (error: unknown) => error instanceof BalancedPoolLimitError && error.maximumUpstreams === 1,
  );
  assert.equal(await pool.removeUpstream("https://missing.test"), false);
  assert.equal(await pool.removeUpstream("https://one.test"), true);
  assert.equal(one.closeCalls, 1);
  await assert.rejects(pool.dispatch(request()), BalancedPoolMissingUpstreamError);
});

test("a failed removal remains selectable and owned", async () => {
  const one = new FakeDispatcher("one");
  const failure = new Error("close failed");
  one.close = () => Promise.reject(failure);
  const pool = new BalancedPool([upstream("https://one.test", one)]);
  await assert.rejects(pool.removeUpstream("https://one.test"), (error: unknown) => error === failure);
  assert.deepEqual(pool.upstreams, ["https://one.test"]);
  assert.equal((await pool.dispatch(request())).statusText, "one");
});

test("late provider failures use the same typed health rule", () => {
  const one = new FakeDispatcher("one");
  const pool = new BalancedPool([upstream("https://one.test", one)], { errorPenalty: 25 });
  assert.equal(pool.reportFailure("https://one.test", new TypeError("policy")), false);
  assert.equal(pool.reportFailure("https://one.test", new TransportError("EPIPE", "late")), true);
  assert.equal(must(pool.stats.entries[0], "the pool tracks that upstream").healthWeight, 75);
  assert.equal(pool.reportSuccess("https://one.test"), true);
  assert.equal(must(pool.stats.entries[0], "the pool tracks that upstream").healthWeight, 100);
  assert.equal(
    pool.reportFailure("https://missing.test", new TransportError("EPIPE", "late")),
    false,
  );
});

test("BalancedPool rejects missing upstreams and validates URL/weight bounds", async () => {
  const empty = new BalancedPool();
  await assert.rejects(empty.dispatch(request()), (error: unknown) => {
    return (
      error instanceof BalancedPoolMissingUpstreamError &&
      error.code === "UND_ERR_BPL_MISSING_UPSTREAM"
    );
  });
  assert.throws(() => new BalancedPool([], { maximumUpstreams: 0 }), RangeError);
  assert.throws(() => new BalancedPool([], { errorPenalty: 0 }), RangeError);
  assert.throws(
    () => empty.addUpstream(upstream("data:text/plain,hello", new FakeDispatcher("bad"))),
    TypeError,
  );
  assert.throws(
    () => empty.addUpstream(upstream("https://one.test", new FakeDispatcher("bad"), 0)),
    RangeError,
  );
  assert.throws(
    () =>
      empty.addUpstream(
        upstream("https://user:secret@one.test", new FakeDispatcher("credentialed")),
      ),
    TypeError,
  );
});

test("BalancedPool close and destroy own every remaining upstream exactly once", async () => {
  const one = new FakeDispatcher("one");
  const two = new FakeDispatcher("two");
  const pool = new BalancedPool([
    upstream("https://one.test", one),
    upstream("https://two.test", two),
  ]);
  const closing = pool.close();
  assert.equal(closing, pool.close());
  await closing;
  assert.deepEqual([one.closeCalls, two.closeCalls], [1, 1]);
  assert.equal(pool.destroyed, true);
  assert.deepEqual(pool.upstreams, []);

  const three = new FakeDispatcher("three");
  const four = new FakeDispatcher("four");
  const destroyed = new BalancedPool([
    upstream("https://three.test", three),
    upstream("https://four.test", four),
  ]);
  const reason = new Error("destroy");
  await destroyed.destroy(reason);
  assert.deepEqual(three.destroyReasons, [reason]);
  assert.deepEqual(four.destroyReasons, [reason]);
});

test("BalancedPool exposes aggregate and per-upstream typed statistics", async () => {
  const one = new FakeDispatcher("one");
  const two = new FakeDispatcher("two");
  two.stats = { connections: 2, pending: 1, running: 3 };
  two.idle = false;
  const pool = new BalancedPool([
    upstream("https://one.test", one),
    upstream("https://two.test", two),
  ]);
  await pool.dispatch(request());
  assert.deepEqual(pool.stats, {
    upstreams: 2,
    idleUpstreams: 1,
    dispatched: 1,
    connections: 3,
    pending: 1,
    running: 3,
    entries: [
      {
        origin: "https://one.test",
        configuredWeight: 100,
        healthWeight: 100,
        idle: true,
        dispatched: 1,
        failures: 0,
        connections: 1,
        pending: 0,
        running: 0,
      },
      {
        origin: "https://two.test",
        configuredWeight: 100,
        healthWeight: 100,
        idle: false,
        dispatched: 0,
        failures: 0,
        connections: 2,
        pending: 1,
        running: 3,
      },
    ],
  });
});
