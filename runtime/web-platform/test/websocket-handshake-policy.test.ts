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
import { ReadableStream } from "../src/streams/readable.ts";
import { DispatchedWebSocketTransport } from "../src/websocket/dispatched-transport.ts";
import { websocketAccept } from "../src/websocket/handshake.ts";
import { RawWebSocketTransport } from "../src/websocket/raw-transport.ts";
import { normalizeWebSocketURL } from "../src/websocket/semantics.ts";
import type { WebSocketDeflateProvider, WebSocketSession } from "../src/websocket/transport.ts";
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

  async reply(
    status: number,
    headers: readonly HeaderEntry[] = [],
    body: ReadableStream<Uint8Array> | null = null,
  ): Promise<void> {
    await this.head();
    if (this.request !== undefined) {
      this.dispatched.resolve({
        status,
        statusText: "Test response",
        headers,
        body,
        ...(status === 101 ? { connection: this.connection } : {}),
      });
    } else {
      this.connection.reply(
        "HTTP/1.1 " + status + " Test response\r\n" +
        headers.map(([name, value]) => name + ": " + value + "\r\n").join("") + "\r\n",
      );
    }
  }

  async accept(protocol?: string): Promise<void> {
    const head = await this.head();
    await this.reply(101, [
      ["upgrade", "websocket"],
      ["connection", "Upgrade"],
      ["sec-websocket-accept", websocketAccept(must(head.headers.get("sec-websocket-key"), "nonce"))],
      ...(protocol === undefined ? [] : [["sec-websocket-protocol", protocol] as const]),
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

  constructor(t: TestContext, kind: TransportKind, deflate?: WebSocketDeflateProvider) {
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
        }, random, scheduler, {}, deflate)
      : new DispatchedWebSocketTransport({
          dispatch: (request) => {
            const attempt = new HandshakeAttempt(request.signal, request);
            this.record(attempt);
            return attempt.dispatch();
          },
        }, random, scheduler, {}, deflate);
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

  connect(
    url: string,
    signal = new AbortController().signal,
    protocols: readonly string[] = [],
  ): Promise<WebSocketSession> {
    const result = this.transport.connect({
      url: hostNodeURLs.parse(url),
      protocols,
      origin: "https://client.test",
    }, signal);
    // A failing assertion still lets test cleanup abort every outstanding attempt.
    result.catch(() => {});
    return result;
  }
}

for (const kind of ["raw", "dispatched"] as const) {
  test(kind + " serializes the normalized destination until its handshake is validated", async (t) => {
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

  test(kind + " connects different hosts and effective ports concurrently", async (t) => {
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

  test(kind + " aborts a middle waiter without letting its successors overtake the active attempt", async (t) => {
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

  test(kind + " releases the next attempt after a provider connection failure", async (t) => {
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

  test(kind + " releases the next attempt after rejecting the handshake and closes the refused connection", async (t) => {
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

  test(kind + " transport shutdown aborts its active and queued attempts", async (t) => {
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

// WHATWG WebSockets §§2.2 and 3.1, RFC 6455 §4.1 response step 1, and
// RFC 7617 §2: URL credentials can answer an HTTP Basic challenge.
test("WebSocket URL normalization preserves userinfo for the opening handshake", () => {
  const url = normalizeWebSocketURL("https://us%C3%A9r+:%2Bpass@host.test/socket", { urls: hostNodeURLs });
  assert.equal(url.protocol, "wss:");
  assert.equal(url.username, "us%C3%A9r+");
  assert.equal(url.password, "%2Bpass");
  assert.equal(url.href, "wss://us%C3%A9r+:%2Bpass@host.test/socket");
});

const credentials = [
  { name: "ASCII", userinfo: "foo:bar", decoded: "foo:bar" },
  { name: "percent-encoded UTF-8 and literal plus", userinfo: "us%C3%A9r+p%252B:p%C3%A4ss+%2B%25", decoded: "usér+p%2B:päss++%" },
];
const basicChallenge: readonly HeaderEntry[] = [["www-authenticate", 'Basic realm="WebSocket"']];

for (const kind of ["raw", "dispatched"] as const) {
  for (const credential of credentials) {
    test(kind + " answers a Basic challenge with " + credential.name + " credentials and preserves the upgrade", async (t) => {
      const deflate: WebSocketDeflateProvider = {
        createDeflater: () => assert.fail("the server did not negotiate compression"),
        createInflater: () => assert.fail("the server did not negotiate compression"),
      };
      const controlled = new ControlledTransport(t, kind, deflate);
      const url = "wss://" + credential.userinfo + "@auth.test/socket?query=kept";
      const result = controlled.connect(url, new AbortController().signal, ["chat", "other"]);
      const queuedResult = controlled.connect("wss://auth.test/queued");
      const first = await controlled.next();
      const firstHead = await first.head();
      assert.equal(firstHead.headers.has("authorization"), false, "credentials wait for a challenge");
      let canceled = 0;
      const body = new ReadableStream<Uint8Array>({ cancel() { canceled++; } });
      await first.reply(401, [
        ["www-authenticate", 'Bearer realm="not Basic"'],
        ["WWW-Authenticate", 'Digest realm="a,b", nonce="x", bAsIc realm="WebSocket"'],
      ], body);
      const retry = await controlled.next();
      const retryHead = await retry.head();
      assert.equal(retryHead.target, "/socket?query=kept", "the auth attempt retains its queue slot");
      assert.equal(retryHead.headers.get("authorization"), "Basic " + Buffer.from(credential.decoded, "utf8").toString("base64"));
      assert.notEqual(retryHead.headers.get("sec-websocket-key"), firstHead.headers.get("sec-websocket-key"));
      assert.equal(retryHead.headers.get("sec-websocket-version"), "13");
      assert.equal(retryHead.headers.get("sec-websocket-protocol"), "chat, other");
      assert.equal(retryHead.headers.get("origin"), "https://client.test");
      assert.equal(retryHead.headers.get("sec-websocket-extensions"), firstHead.headers.get("sec-websocket-extensions"));
      assert.ok(retryHead.headers.get("sec-websocket-extensions")?.startsWith("permessage-deflate"));
      if (kind === "raw") {
        assert.equal(first.connection.closed, true, "close the first TCP connection before retrying");
        assert.equal(retryHead.headers.get("upgrade"), "websocket");
        assert.equal(retryHead.headers.get("connection"), "Upgrade");
      } else {
        assert.equal(canceled, 1, "cancel the refused HTTP body before retrying");
        const request = must(retry.request, "dispatched retry metadata");
        assert.equal(request.url.href, url);
        assert.equal(request.signal, first.signal);
        assert.equal(request.method, "GET");
        assert.equal(request.body, null);
        assert.equal(request.bodyLength, null);
        assert.equal(request.acceptTunnel, true);
        assert.equal(request.upgradeProtocol, "websocket");
      }
      await nextTurn();
      assert.equal(controlled.attempts.length, 2, "a later WebSocket still waits during authentication");
      await retry.accept("chat");
      assert.equal((await result).protocol, "chat");
      const queued = await controlled.next();
      assert.equal((await queued.head()).target, "/queued");
      await queued.accept();
      await queuedResult;
    });
  }

  test(kind + " answers a repeated Basic challenge only once", async (t) => {
    const controlled = new ControlledTransport(t, kind);
    const result = controlled.connect("ws://foo:wrong@auth.test/");
    const first = await controlled.next();
    let canceled = 0;
    await first.reply(401, basicChallenge, new ReadableStream<Uint8Array>({ cancel() { canceled++; } }));
    const retry = await controlled.next();
    assert.equal((await retry.head()).headers.get("authorization"), "Basic Zm9vOndyb25n");
    await retry.reply(401, basicChallenge, new ReadableStream<Uint8Array>({ cancel() { canceled++; } }));
    await assert.rejects(result);
    await nextTurn();
    assert.equal(controlled.attempts.length, 2);
    if (kind === "raw") {
      assert.equal(first.connection.closed, true);
      assert.equal(retry.connection.closed, true);
    } else assert.equal(canceled, 2);
  });

  const refusals: readonly { name: string; status: number; headers: readonly HeaderEntry[]; userinfo: string }[] = [
    { name: "a Digest challenge mentioning Basic", status: 401, headers: [["www-authenticate", 'Digest realm="Basic", nonce="x"']], userinfo: "foo:bar@" },
    { name: "a response without an authentication challenge", status: 401, headers: [], userinfo: "foo:bar@" },
    { name: "a proxy authentication response", status: 407, headers: [...basicChallenge, ["proxy-authenticate", 'Basic realm="Proxy"']], userinfo: "foo:bar@" },
    { name: "a redirection", status: 302, headers: [...basicChallenge, ["location", "ws://other.test/"]], userinfo: "foo:bar@" },
    { name: "a Basic challenge without URL credentials", status: 401, headers: basicChallenge, userinfo: "" },
  ];
  for (const refusal of refusals) {
    test(kind + " does not retry " + refusal.name, async (t) => {
      const controlled = new ControlledTransport(t, kind);
      const result = controlled.connect("ws://" + refusal.userinfo + "auth.test/");
      const first = await controlled.next();
      let canceled = false;
      await first.reply(refusal.status, refusal.headers, new ReadableStream<Uint8Array>({ cancel() { canceled = true; } }));
      await assert.rejects(result);
      await nextTurn();
      assert.equal(controlled.attempts.length, 1);
      if (kind === "raw") assert.equal(first.connection.closed, true);
      else assert.equal(canceled, true);
    });
  }

  test(kind + " rejects invalid UTF-8 credentials without changing or sending them", async (t) => {
    const controlled = new ControlledTransport(t, kind);
    const result = controlled.connect("ws://%FF:password@auth.test/");
    const first = await controlled.next();
    let canceled = false;
    await first.reply(401, basicChallenge, new ReadableStream<Uint8Array>({ cancel() { canceled = true; } }));
    await assert.rejects(result, TypeError);
    assert.equal(controlled.attempts.length, 1);
    if (kind === "raw") assert.equal(first.connection.closed, true);
    else assert.equal(canceled, true);
  });

  test(kind + " cancellation interrupts the authentication retry and releases the queued connection", async (t) => {
    const controlled = new ControlledTransport(t, kind);
    const controller = new AbortController();
    const result = controlled.connect("ws://foo:bar@auth.test/auth", controller.signal);
    const queuedResult = controlled.connect("ws://auth.test/queued");
    const first = await controlled.next();
    await first.reply(401, basicChallenge);
    const retry = await controlled.next();
    await retry.head();
    const reason = new Error("cancel the authentication retry");
    controller.abort(reason);
    await assert.rejects(result, (error) => error === reason);
    assert.equal(retry.signal.aborted, true);
    if (kind === "raw") assert.equal(retry.connection.closed, true);
    const queued = await controlled.next();
    assert.equal((await queued.head()).target, "/queued");
    await queued.accept();
    await queuedResult;
  });
}

test("dispatched authentication waits for body cancellation and remains abortable", async (t) => {
  const controlled = new ControlledTransport(t, "dispatched");
  const controller = new AbortController();
  const result = controlled.connect("ws://foo:bar@auth.test/auth", controller.signal);
  const cancelStarted = Promise.withResolvers<void>();
  const cancelFinished = Promise.withResolvers<void>();
  t.after(() => cancelFinished.resolve());
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      cancelStarted.resolve();
      return cancelFinished.promise;
    },
  });
  const first = await controlled.next();
  await first.reply(401, basicChallenge, body);
  await cancelStarted.promise;
  await nextTurn();
  assert.equal(controlled.attempts.length, 1, "the retry waits for disposal of the first response");
  const reason = new Error("cancel while disposing the challenge body");
  controller.abort(reason);
  await assert.rejects(result, (error) => error === reason);
  cancelFinished.resolve();
  await nextTurn();
  assert.equal(controlled.attempts.length, 1, "settling disposal cannot restart an aborted handshake");
});

test("a dispatched challenge-body cancellation error does not mask a valid Basic retry", async (t) => {
  const controlled = new ControlledTransport(t, "dispatched");
  const result = controlled.connect("ws://foo:bar@auth.test/");
  const first = await controlled.next();
  const body = new ReadableStream<Uint8Array>({ cancel() { throw new Error("body disposal failed"); } });
  await first.reply(401, basicChallenge, body);
  const retry = await controlled.next();
  await retry.accept();
  await result;
});
