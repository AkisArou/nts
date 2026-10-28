// RFC 6455 §4.1 step 2: serialize attempts until the opening handshake settles.
// Deferred provider operations make ordering observable without elapsed-time checks.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import "../host/environment-shim.ts";
import { AbortController, abortSignalSubscribe } from "../src/core/abort.ts";
import type { AbortSignal } from "../src/core/abort.ts";
import type { HeaderEntry } from "../src/fetch/headers.ts";
import type { TransportRequest, TransportResponse } from "../src/fetch/transport.ts";
import type { ByteConnection } from "../src/provider/primitives.ts";
import { DispatchedWebSocketTransport } from "../src/websocket/dispatched-transport.ts";
import { websocketAccept } from "../src/websocket/handshake.ts";
import { RawWebSocketTransport } from "../src/websocket/raw-transport.ts";
import type { WebSocketSession } from "../src/websocket/transport.ts";
import { HostNodeScheduler, hostNodeURLs } from "../host/node-primitives.ts";
import { must } from "./harness.ts";

type TransportKind = "raw" | "dispatched";

interface RequestHead {
  readonly target: string;
  readonly headers: ReadonlyMap<string, string>;
}

class ControlledConnection implements ByteConnection {
  closed = false;
  readonly written = Promise.withResolvers<string>();
  private readonly response = Promise.withResolvers<Uint8Array | null>();
  private readonly ended = Promise.withResolvers<Uint8Array | null>();
  private reads = 0;

  async read(maxBytes: number): Promise<Uint8Array | null> {
    const bytes = await (this.reads++ === 0 ? this.response.promise : this.ended.promise);
    assert.ok(bytes === null || bytes.length <= maxBytes, "the test head fits in one read");
    return bytes;
  }

  async write(bytes: Uint8Array): Promise<number> {
    this.written.resolve(new TextDecoder().decode(bytes));
    return bytes.length;
  }

  reply(head: string): void {
    this.response.resolve(new TextEncoder().encode(head));
  }

  close(): void {
    this.closed = true;
    this.response.resolve(null);
    this.ended.resolve(null);
  }
}

class HandshakeAttempt {
  readonly connection = new ControlledConnection();
  readonly signal: AbortSignal;
  readonly request: TransportRequest | undefined;
  private readonly connected = Promise.withResolvers<ByteConnection>();
  private readonly dispatched = Promise.withResolvers<TransportResponse>();

  constructor(signal: AbortSignal, request?: TransportRequest) {
    this.signal = signal;
    this.request = request;
  }

  async connect(): Promise<ByteConnection> {
    const detach = this.signal[abortSignalSubscribe](() => this.connected.reject(this.signal.reason));
    try {
      return await this.connected.promise;
    } finally {
      detach();
    }
  }

  async dispatch(): Promise<TransportResponse> {
    const detach = this.signal[abortSignalSubscribe](() => this.dispatched.reject(this.signal.reason));
    try {
      return await this.dispatched.promise;
    } finally {
      detach();
    }
  }

  async head(): Promise<RequestHead> {
    if (this.request !== undefined) {
      return {
        target: this.request.url.pathname + this.request.url.search,
        headers: new Map(this.request.headers),
      };
    }
    this.connected.resolve(this.connection);
    const lines = (await this.connection.written.promise).split("\r\n");
    const headers = new Map<string, string>();
    for (const line of lines.slice(1)) {
      const colon = line.indexOf(":");
      if (colon !== -1) headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
    }
    return { target: must(lines[0], "request line").split(" ")[1] ?? "", headers };
  }

  async reply(status: number, headers: readonly HeaderEntry[] = []): Promise<void> {
    await this.head();
    if (this.request !== undefined) {
      this.dispatched.resolve({
        status,
        statusText: "Test response",
        headers,
        body: null,
        ...(status === 101 ? { connection: this.connection } : {}),
      });
    } else {
      this.connection.reply(
        "HTTP/1.1 " + status + " Test response\r\n" +
        headers.map(([name, value]) => name + ": " + value + "\r\n").join("") + "\r\n",
      );
    }
  }

  async accept(): Promise<void> {
    const head = await this.head();
    await this.reply(101, [
      ["upgrade", "websocket"],
      ["connection", "Upgrade"],
      ["sec-websocket-accept", websocketAccept(must(head.headers.get("sec-websocket-key"), "nonce"))],
    ]);
  }

  fail(error: unknown): void {
    if (this.request === undefined) this.connected.reject(error);
    else this.dispatched.reject(error);
  }
}

class ControlledTransport {
  readonly transport: RawWebSocketTransport | DispatchedWebSocketTransport;
  readonly attempts: HandshakeAttempt[] = [];
  private cursor = 0;
  private changed = Promise.withResolvers<void>();

  constructor(t: TestContext, kind: TransportKind) {
    let nonce = 0;
    const random = { fill(bytes: Uint8Array): void { bytes.fill(++nonce); } };
    const scheduler = new HostNodeScheduler((error) => assert.fail(String(error)));
    this.transport = kind === "raw"
      ? new RawWebSocketTransport({
          connect: (_address, signal) => {
            const attempt = new HandshakeAttempt(signal);
            this.record(attempt);
            return attempt.connect();
          },
        }, random, scheduler)
      : new DispatchedWebSocketTransport({
          dispatch: (request) => {
            const attempt = new HandshakeAttempt(request.signal, request);
            this.record(attempt);
            return attempt.dispatch();
          },
        }, random, scheduler);
    t.after(() => this.transport.close());
  }

  private record(attempt: HandshakeAttempt): void {
    this.attempts.push(attempt);
    this.changed.resolve();
    this.changed = Promise.withResolvers<void>();
  }

  async next(): Promise<HandshakeAttempt> {
    while (this.cursor === this.attempts.length) await this.changed.promise;
    return must(this.attempts[this.cursor++], "the provider started an attempt");
  }

  connect(url: string, signal = new AbortController().signal): Promise<WebSocketSession> {
    const result = this.transport.connect({
      url: hostNodeURLs.parse(url),
      protocols: [],
      origin: "https://client.test",
    }, signal);
    // A failing assertion still lets test cleanup abort every outstanding attempt.
    result.catch(() => {});
    return result;
  }
}

for (const kind of ["raw", "dispatched"] as const) {
  test(kind + " serializes the normalized destination until its handshake is validated", { timeout: 60_000 }, async (t) => {
    const controlled = new ControlledTransport(t, kind);
    const firstResult = controlled.connect("ws://EXAMPLE.test:80/first");
    const secondResult = controlled.connect("ws://example.test/second");
    const first = await controlled.next();
    await first.head();
    await nextTurn();
    assert.equal(controlled.attempts.length, 1, "connecting TCP is not a completed opening handshake");
    await first.accept();
    await firstResult;
    const second = await controlled.next();
    assert.equal(first.connection.closed, false, "an open session does not retain the CONNECTING slot");
    assert.equal((await second.head()).target, "/second");
    await second.accept();
    await secondResult;
  });

  test(kind + " connects different hosts and effective ports concurrently", { timeout: 60_000 }, async (t) => {
    const controlled = new ControlledTransport(t, kind);
    const pending = [
      controlled.connect("ws://a.test/"),
      controlled.connect("ws://b.test/"),
      controlled.connect("ws://a.test:81/"),
      controlled.connect("wss://a.test/"),
    ];
    for (let index = 0; index < pending.length; index++) await controlled.next();
    assert.equal(controlled.attempts.length, 4);
    await Promise.all(controlled.attempts.map((attempt) => attempt.accept()));
    await Promise.all(pending);
  });

  test(kind + " aborts a middle waiter without letting its successors overtake the active attempt", { timeout: 60_000 }, async (t) => {
    const controlled = new ControlledTransport(t, kind);
    const firstResult = controlled.connect("ws://queue.test/first");
    const middle = new AbortController();
    const middleResult = controlled.connect("ws://queue.test/middle", middle.signal);
    const thirdResult = controlled.connect("ws://queue.test/third");
    const first = await controlled.next();
    await first.head();
    const reason = new Error("cancel the queued attempt");
    middle.abort(reason);
    await assert.rejects(middleResult, (error) => error === reason);
    const fourthResult = controlled.connect("ws://queue.test/fourth");
    await nextTurn();
    assert.equal(controlled.attempts.length, 1, "an aborted waiter cannot release its predecessor");
    await first.accept();
    await firstResult;
    const third = await controlled.next();
    assert.equal((await third.head()).target, "/third");
    await nextTurn();
    assert.equal(controlled.attempts.length, 2, "a new tail must still wait for the third attempt");
    await third.accept();
    await thirdResult;
    const fourth = await controlled.next();
    assert.equal((await fourth.head()).target, "/fourth");
    await fourth.accept();
    await fourthResult;
  });

  test(kind + " releases the next attempt after a provider connection failure", { timeout: 60_000 }, async (t) => {
    const controlled = new ControlledTransport(t, kind);
    const firstResult = controlled.connect("ws://failure.test/first");
    const secondResult = controlled.connect("ws://failure.test/second");
    const first = await controlled.next();
    const reason = new Error("connection refused");
    first.fail(reason);
    await assert.rejects(firstResult, (error) => error === reason);
    const second = await controlled.next();
    await second.accept();
    await secondResult;
  });

  test(kind + " releases the next attempt after rejecting the handshake and closes the refused connection", { timeout: 60_000 }, async (t) => {
    const controlled = new ControlledTransport(t, kind);
    const firstResult = controlled.connect("ws://failure.test/first");
    const secondResult = controlled.connect("ws://failure.test/second");
    const first = await controlled.next();
    await first.reply(101, [["upgrade", "websocket"], ["connection", "Upgrade"], ["sec-websocket-accept", "wrong"]]);
    await assert.rejects(firstResult, /Invalid Sec-WebSocket-Accept/);
    assert.equal(first.connection.closed, true);
    const second = await controlled.next();
    await second.accept();
    await secondResult;
  });

  test(kind + " transport shutdown aborts its active and queued attempts", { timeout: 60_000 }, async (t) => {
    const controlled = new ControlledTransport(t, kind);
    const firstResult = controlled.connect("ws://closing.test/first");
    const secondResult = controlled.connect("ws://closing.test/second");
    const first = await controlled.next();
    await first.head();
    controlled.transport.close();
    await assert.rejects(firstResult, /WebSocket transport is closed/);
    await assert.rejects(secondResult, /WebSocket transport is closed/);
    assert.equal(first.signal.aborted, true);
    if (kind === "raw") assert.equal(first.connection.closed, true);
    assert.equal(controlled.attempts.length, 1);
    await assert.rejects(controlled.connect("ws://closing.test/new"), /WebSocket transport is closed/);
  });
}
