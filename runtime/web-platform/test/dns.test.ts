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
} from "../src/index.ts";
import { HostNodeSocketConnector } from "../host/node-primitives.ts";
// Symbol-keyed internals: not on the interface prototype and not on the public barrel,
// so a test reaches them the same way the runtime does.
import {
  abortSignalSubscribe,
} from "../src/core/abort-brand.ts";
import { must, portOf } from "./harness.ts";
import type {
  ByteConnection,
  ConnectAddress,
  DnsAddress,
  DnsResolveOptions,
  Scheduler,
} from "../src/provider/primitives.ts";
import type { AbortSignal } from "../src/index.ts";

function v4(address: string, ttlMilliseconds = 1000): DnsAddress {
  return { address, family: 4, ttlMilliseconds };
}

function v6(address: string, ttlMilliseconds = 1000): DnsAddress {
  return { address, family: 6, ttlMilliseconds };
}

/** A delay this scheduler was asked for, and whether it was cancelled before firing. */
interface PendingDelay {
  readonly milliseconds: number;
  readonly task: () => void;
  canceled: boolean;
}

class ManualScheduler implements Scheduler {
  readonly pending: PendingDelay[] = [];

  enqueue(task: () => void): void {
    task();
  }

  delay(milliseconds: number, task: () => void): { cancel(): void } {
    const record: PendingDelay = { milliseconds, task, canceled: false };
    this.pending.push(record);
    return {
      cancel() {
        record.canceled = true;
      },
    };
  }

  reportError(error: unknown): void {
    throw error;
  }

  runNext() {
    while (this.pending.length !== 0) {
      const record = this.pending.shift();
      // `shift` on a non-empty array always yields one; the loop condition is the proof.
      if (record === undefined || record.canceled) continue;
      record.task();
      return record.milliseconds;
    }
    throw new Error("No scheduled task");
  }
}

class FakeConnection implements ByteConnection {
  readonly name: string;
  closed = false;

  constructor(name: string) {
    this.name = name;
  }

  read(): Promise<Uint8Array | null> {
    return Promise.resolve(null);
  }

  write(data: Uint8Array): Promise<number> {
    return Promise.resolve(data.length);
  }

  close(): void {
    this.closed = true;
  }
}

function address(hostname = "service.test"): ConnectAddress {
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
      resolve(): Promise<readonly DnsAddress[]> {
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
  // Mutating the resolver's own record on purpose: the assertion below is that the cache
  // returned a copy and did not hand out a view of it. `DnsAddress.address` is readonly, so the
  // write is a violation as well as a type error -- widened here to keep it deliberate.
  (must(source[0], "the fixture has a first address") as { address: string }).address =
    "203.0.113.99";
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
  const resolution = Promise.withResolvers<readonly DnsAddress[]>();
  // Captured from inside the resolver, so it says what it will hold.
  let resolverSignal: AbortSignal | undefined;
  const cache = new DnsCache({
    resolver: {
      resolve(
        _hostname: string,
        _options: DnsResolveOptions,
        signal: AbortSignal,
      ): Promise<readonly DnsAddress[]> {
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
  await assert.rejects(first, (error: unknown) => error === reason);
  assert.equal(must(resolverSignal, "the resolver was called").aborted, false);
  resolution.resolve([v6("2001:db8::1")]);
  assert.deepEqual(await second, [v6("2001:db8::1")]);
});

test("DnsCache cancels a miss when its final consumer leaves", async () => {
  // Captured from inside the resolver, so it says what it will hold.
  let resolverSignal: AbortSignal | undefined;
  const cache = new DnsCache({
    resolver: {
      resolve(_hostname, _options, signal) {
        resolverSignal = signal;
        return new Promise((_resolve, reject) => {
          signal[abortSignalSubscribe](() => reject(signal.reason));
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
  assert.equal(must(resolverSignal, "the resolver was called").aborted, false);
  const finalReason = new Error("two");
  two.abort(finalReason);
  await assert.rejects(first);
  await assert.rejects(second, (error: unknown) => error === finalReason);
  assert.equal(must(resolverSignal, "the resolver was called").aborted, true);
  await Promise.resolve();
  assert.equal(cache.stats.pending, 0);
});

test("DnsCache bounds pending lookups and settled LRU entries", async () => {
  const pending = Promise.withResolvers<readonly DnsAddress[]>();
  const cache = new DnsCache({
    resolver: {
      resolve(hostname: string): Promise<readonly DnsAddress[]> {
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
  // One recorded connect: what it was asked for, and the resolver that decides its outcome.
  const attempts: {
    target: ConnectAddress;
    signal: AbortSignal;
    result: PromiseWithResolvers<ByteConnection>;
  }[] = [];
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
      connect(target: ConnectAddress, signal: AbortSignal): Promise<ByteConnection> {
        const result = Promise.withResolvers<ByteConnection>();
        attempts.push({ target, signal, result });
        return result.promise;
      },
    },
  });
  const connecting = connector.connect(address(), new AbortController().signal);
  await flushMicrotasks();
  assert.equal(attempts.length, 1);
  assert.deepEqual(must(attempts[0], "the connector made that many attempts").target, {
    hostname: "service.test",
    port: 443,
    secure: true,
    connectTimeoutMs: 5000,
    resolvedAddress: "2001:db8::1",
    resolvedFamily: 6,
  });
  assert.equal(scheduler.runNext(), 25);
  assert.equal(must(attempts[1], "the connector made that many attempts").target.resolvedAddress, "192.0.2.1");
  const winner = new FakeConnection("winner");
  must(attempts[1], "the connector made that many attempts").result.resolve(winner);
  assert.equal(await connecting, winner);
  assert.equal(must(attempts[0], "the connector made that many attempts").signal.aborted, true);
  const late = new FakeConnection("late");
  must(attempts[0], "the connector made that many attempts").result.resolve(late);
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
  // One recorded connect: what it was asked for, and the resolver that decides its outcome.
  const attempts: (string | undefined)[] = [];
  const connector = new DnsConnector({
    cache,
    scheduler: new ManualScheduler(),
    connector: {
      connect(target: ConnectAddress): Promise<ByteConnection> {
        attempts.push(target.resolvedAddress);
        return Promise.reject(new Error("failed " + target.resolvedAddress));
      },
    },
  });
  await assert.rejects(connector.connect(address(), new AbortController().signal), (error: unknown) => {
    return error instanceof DnsConnectionError && error.failures.length === 2;
  });
  assert.deepEqual(attempts, ["192.0.2.1", "2001:db8::1"]);
  await assert.rejects(connector.connect(address(), new AbortController().signal));
  assert.equal(resolverCalls, 2);
});

test("DnsConnector preserves exact external cancellation and bypasses literal addresses", async () => {
  let resolverCalls = 0;
  // Captured from inside the connector, so it says what it will hold.
  let attemptedSignal: AbortSignal | undefined;
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
          signal[abortSignalSubscribe](() => reject(signal.reason));
        });
      },
    },
  });
  const controller = new AbortController();
  const connecting = connector.connect(address(), controller.signal);
  await flushMicrotasks();
  const reason = new Error("cancel exact");
  controller.abort(reason);
  await assert.rejects(connecting, (error: unknown) => error === reason);
  assert.equal(must(attemptedSignal, "the connector was asked to connect").aborted, true);

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
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const serverPort = portOf(server);
  const connector = new HostNodeSocketConnector();
  const connection = await connector.connect(
    {
      hostname: "does-not-resolve.invalid",
      port: serverPort,
      secure: false,
      connectTimeoutMs: 1000,
      resolvedAddress: "127.0.0.1",
      resolvedFamily: 4,
    },
    new AbortController().signal,
  );
  connection.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
