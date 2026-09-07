import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import {
  AbortController,
  DnsCache,
  DnsConnectionError,
  DnsConnector,
  DnsLookupLimitError,
  DnsNoAddressError,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import { HostNodeSocketConnector } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-primitives.js";

function v4(address, ttlMilliseconds = 1000) {
  return { address, family: 4, ttlMilliseconds };
}

function v6(address, ttlMilliseconds = 1000) {
  return { address, family: 6, ttlMilliseconds };
}

class ManualScheduler {
  constructor() {
    this.pending = [];
  }

  enqueue(task) {
    task();
  }

  delay(milliseconds, task) {
    const record = { milliseconds, task, canceled: false };
    this.pending.push(record);
    return {
      cancel() {
        record.canceled = true;
      },
    };
  }

  reportError(error) {
    throw error;
  }

  runNext() {
    while (this.pending.length !== 0) {
      const record = this.pending.shift();
      if (record.canceled) continue;
      record.task();
      return record.milliseconds;
    }
    throw new Error("No scheduled task");
  }
}

class FakeConnection {
  constructor(name) {
    this.name = name;
    this.closed = false;
  }

  read() {
    return Promise.resolve(null);
  }

  write(data) {
    return Promise.resolve(data.length);
  }

  close() {
    this.closed = true;
  }
}

function address(hostname = "service.test") {
  return { hostname, port: 443, secure: true, connectTimeoutMs: 5000 };
}

async function flushMicrotasks() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}

test("DnsCache caps TTLs, expires records independently, deduplicates and rotates", async () => {
  let now = 10;
  let calls = 0;
  const source = [v4("192.0.2.1", 50), v4("192.0.2.2", 200), v4("192.0.2.1", 50)];
  const cache = new DnsCache({
    resolver: {
      resolve() {
        calls++;
        return Promise.resolve(source);
      },
    },
    nowMilliseconds: () => now,
    maximumTTLMilliseconds: 100,
  });
  const signal = new AbortController().signal;
  const first = await cache.lookup("EXAMPLE.test", [4], signal);
  assert.deepEqual(
    first.map((entry) => entry.address),
    ["192.0.2.1", "192.0.2.2"],
  );
  source[0].address = "203.0.113.99";
  const second = await cache.lookup("example.TEST", [4], signal);
  assert.deepEqual(
    second.map((entry) => entry.address),
    ["192.0.2.1", "192.0.2.2"],
  );
  const third = await cache.lookup("example.test", [4], signal);
  assert.deepEqual(
    third.map((entry) => entry.address),
    ["192.0.2.2", "192.0.2.1"],
  );
  now = 61;
  assert.deepEqual(
    (await cache.lookup("example.test", [4], signal)).map((entry) => entry.address),
    ["192.0.2.2"],
  );
  now = 111;
  await cache.lookup("example.test", [4], signal);
  assert.equal(calls, 2);
  assert.deepEqual(cache.stats, {
    entries: 1,
    pending: 0,
    cacheHits: 3,
    resolverCalls: 2,
    evictions: 0,
  });
});

test("DnsCache coalesces misses without letting one consumer cancel another", async () => {
  const resolution = Promise.withResolvers();
  let resolverSignal;
  const cache = new DnsCache({
    resolver: {
      resolve(_hostname, _options, signal) {
        resolverSignal = signal;
        return resolution.promise;
      },
    },
    nowMilliseconds: () => 0,
  });
  const firstController = new AbortController();
  const secondController = new AbortController();
  const first = cache.lookup("shared.test", [4, 6], firstController.signal);
  const second = cache.lookup("shared.test", [6, 4], secondController.signal);
  assert.equal(cache.stats.resolverCalls, 1);
  const reason = new Error("first left");
  firstController.abort(reason);
  await assert.rejects(first, (error) => error === reason);
  assert.equal(resolverSignal.aborted, false);
  resolution.resolve([v6("2001:db8::1")]);
  assert.deepEqual(await second, [v6("2001:db8::1")]);
});

test("DnsCache cancels a miss when its final consumer leaves", async () => {
  let resolverSignal;
  const cache = new DnsCache({
    resolver: {
      resolve(_hostname, _options, signal) {
        resolverSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.subscribe(() => reject(signal.reason));
        });
      },
    },
    nowMilliseconds: () => 0,
  });
  const one = new AbortController();
  const two = new AbortController();
  const first = cache.lookup("cancel.test", [4], one.signal);
  const second = cache.lookup("cancel.test", [4], two.signal);
  one.abort(new Error("one"));
  assert.equal(resolverSignal.aborted, false);
  const finalReason = new Error("two");
  two.abort(finalReason);
  await assert.rejects(first);
  await assert.rejects(second, (error) => error === finalReason);
  assert.equal(resolverSignal.aborted, true);
  await Promise.resolve();
  assert.equal(cache.stats.pending, 0);
});

test("DnsCache bounds pending lookups and settled LRU entries", async () => {
  const pending = Promise.withResolvers();
  const cache = new DnsCache({
    resolver: {
      resolve(hostname) {
        if (hostname === "pending.test") return pending.promise;
        return Promise.resolve([v4(hostname === "one.test" ? "192.0.2.1" : "192.0.2.2")]);
      },
    },
    nowMilliseconds: () => 0,
    maximumItems: 1,
    maximumPendingLookups: 1,
  });
  const signal = new AbortController().signal;
  const first = cache.lookup("pending.test", [4], signal);
  await assert.rejects(cache.lookup("blocked.test", [4], signal), DnsLookupLimitError);
  pending.resolve([v4("192.0.2.9")]);
  await first;
  await cache.lookup("one.test", [4], signal);
  await cache.lookup("two.test", [4], signal);
  assert.equal(cache.stats.entries, 1);
  assert.equal(cache.stats.evictions, 2);
});

test("DnsCache rejects empty and malformed provider answers", async () => {
  const signal = new AbortController().signal;
  const empty = new DnsCache({
    resolver: { resolve: () => Promise.resolve([]) },
    nowMilliseconds: () => 0,
  });
  await assert.rejects(empty.lookup("empty.test", [4], signal), DnsNoAddressError);
  const malformed = new DnsCache({
    resolver: { resolve: () => Promise.resolve([v4("999.1.1.1")]) },
    nowMilliseconds: () => 0,
  });
  await assert.rejects(malformed.lookup("bad.test", [4], signal), TypeError);
  assert.equal(malformed.stats.pending, 0);
  const malformedV6 = new DnsCache({
    resolver: { resolve: () => Promise.resolve([v6("2001:::1")]) },
    nowMilliseconds: () => 0,
  });
  await assert.rejects(malformedV6.lookup("bad-v6.test", [6], signal), TypeError);
  const oversized = new DnsCache({
    resolver: { resolve: () => Promise.resolve([v4("192.0.2.1"), v4("192.0.2.2")]) },
    nowMilliseconds: () => 0,
    maximumAddressesPerHostname: 1,
  });
  await assert.rejects(oversized.lookup("oversized.test", [4], signal), TypeError);
  assert.throws(() => empty.lookup("bad-family.test", [4, 4], signal), TypeError);
});

test("DnsConnector alternates families, preserves logical identity and closes a late loser", async () => {
  const scheduler = new ManualScheduler();
  const attempts = [];
  const cache = new DnsCache({
    resolver: {
      resolve: () => Promise.resolve([v6("2001:db8::1"), v6("2001:db8::2"), v4("192.0.2.1")]),
    },
    nowMilliseconds: () => 0,
  });
  const connector = new DnsConnector({
    cache,
    scheduler,
    preferredFamily: 6,
    attemptDelayMilliseconds: 25,
    connector: {
      connect(target, signal) {
        const result = Promise.withResolvers();
        attempts.push({ target, signal, result });
        return result.promise;
      },
    },
  });
  const connecting = connector.connect(address(), new AbortController().signal);
  await flushMicrotasks();
  assert.equal(attempts.length, 1);
  assert.deepEqual(attempts[0].target, {
    hostname: "service.test",
    port: 443,
    secure: true,
    connectTimeoutMs: 5000,
    resolvedAddress: "2001:db8::1",
    resolvedFamily: 6,
  });
  assert.equal(scheduler.runNext(), 25);
  assert.equal(attempts[1].target.resolvedAddress, "192.0.2.1");
  const winner = new FakeConnection("winner");
  attempts[1].result.resolve(winner);
  assert.equal(await connecting, winner);
  assert.equal(attempts[0].signal.aborted, true);
  const late = new FakeConnection("late");
  attempts[0].result.resolve(late);
  await Promise.resolve();
  assert.equal(late.closed, true);
});

test("a failed address accelerates the next attempt and exhaustion invalidates DNS", async () => {
  let resolverCalls = 0;
  const cache = new DnsCache({
    resolver: {
      resolve() {
        resolverCalls++;
        return Promise.resolve([v4("192.0.2.1"), v6("2001:db8::1")]);
      },
    },
    nowMilliseconds: () => 0,
  });
  const attempts = [];
  const connector = new DnsConnector({
    cache,
    scheduler: new ManualScheduler(),
    connector: {
      connect(target) {
        attempts.push(target.resolvedAddress);
        return Promise.reject(new Error("failed " + target.resolvedAddress));
      },
    },
  });
  await assert.rejects(connector.connect(address(), new AbortController().signal), (error) => {
    return error instanceof DnsConnectionError && error.failures.length === 2;
  });
  assert.deepEqual(attempts, ["192.0.2.1", "2001:db8::1"]);
  await assert.rejects(connector.connect(address(), new AbortController().signal));
  assert.equal(resolverCalls, 2);
});

test("DnsConnector preserves exact external cancellation and bypasses literal addresses", async () => {
  let resolverCalls = 0;
  let attemptedSignal;
  const cache = new DnsCache({
    resolver: {
      resolve() {
        resolverCalls++;
        return Promise.resolve([v4("192.0.2.1")]);
      },
    },
    nowMilliseconds: () => 0,
  });
  const connector = new DnsConnector({
    cache,
    scheduler: new ManualScheduler(),
    connector: {
      connect(_target, signal) {
        attemptedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.subscribe(() => reject(signal.reason));
        });
      },
    },
  });
  const controller = new AbortController();
  const connecting = connector.connect(address(), controller.signal);
  await flushMicrotasks();
  const reason = new Error("cancel exact");
  controller.abort(reason);
  await assert.rejects(connecting, (error) => error === reason);
  assert.equal(attemptedSignal.aborted, true);

  const literalConnection = new FakeConnection("literal");
  const literal = new DnsConnector({
    cache,
    scheduler: new ManualScheduler(),
    connector: { connect: () => Promise.resolve(literalConnection) },
  });
  assert.equal(
    await literal.connect(address("127.0.0.1"), new AbortController().signal),
    literalConnection,
  );
  assert.equal(resolverCalls, 1);
});

test("HostNodeSocketConnector connects physically while retaining logical hostname", async () => {
  const server = createServer((socket) => socket.end());
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const serverAddress = server.address();
  assert.notEqual(serverAddress, null);
  assert.equal(typeof serverAddress, "object");
  const connector = new HostNodeSocketConnector();
  const connection = await connector.connect(
    {
      hostname: "does-not-resolve.invalid",
      port: serverAddress.port,
      secure: false,
      connectTimeoutMs: 1000,
      resolvedAddress: "127.0.0.1",
      resolvedFamily: 4,
    },
    new AbortController().signal,
  );
  connection.close();
  await new Promise((resolve) => server.close(resolve));
});
