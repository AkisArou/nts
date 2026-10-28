// Focused checks of the Node WPT peer, not executions of the WPT test files.
// Every API client below comes from this package. Handwritten wire checks are
// independent of the server codec and exercise intentionally malformed replies.
import assert from "node:assert/strict";
import { once } from "node:events";
import { connect } from "node:net";
import type { Socket } from "node:net";
import test from "node:test";
import type { TestContext } from "node:test";
import { CloseEvent, WebSocket, WebSocketError, WebSocketStream } from "../src/index.ts";
import type { WebSocketData } from "../src/websocket/websocket.ts";
import { startWptServer } from "./wpt/server/server.ts";
import type { WptServer } from "./wpt/server/server.ts";
import { createWptRuntime } from "./wpt/server/runtime.ts";

const suite = (name: string, body: (t: TestContext) => Promise<void>): void => {
  test(name, body);
};

async function hosted(t: TestContext): Promise<WptServer> {
  const server = await startWptServer();
  const runtime = createWptRuntime(server, {
    websocket: { connectTimeoutMs: 60000, handshakeTimeoutMs: 60000, closeTimeoutMs: 60000 },
  });
  t.after(async () => {
    runtime.close();
    await server.close();
    assert.deepEqual(server.errors, [], "the test peer reported an unexpected handler error");
  });
  return server;
}

/** Register listeners before the connection can deliver a message or close. */
class SocketProbe {
  readonly socket: WebSocket;
  readonly opened: Promise<void>;
  readonly closed: Promise<CloseEvent>;
  readonly received: WebSocketData[] = [];
  private readonly queue: WebSocketData[] = [];
  private pending: PromiseWithResolvers<WebSocketData> | null = null;
  private ended: boolean = false;

  constructor(url: string, protocols?: readonly string[]) {
    this.socket = new WebSocket(url, protocols);
    const opened = Promise.withResolvers<void>();
    const closed = Promise.withResolvers<CloseEvent>();
    this.opened = opened.promise;
    this.closed = closed.promise;
    void this.opened.catch(() => {});
    this.socket.onopen = () => opened.resolve();
    this.socket.onerror = () => opened.reject(new Error("WebSocket handshake failed"));
    this.socket.onmessage = (event) => {
      const data = event.data;
      assert.ok(data !== null, "a WebSocket message carries text or binary data");
      this.received.push(data);
      const pending = this.pending;
      if (pending === null) this.queue.push(data);
      else {
        this.pending = null;
        pending.resolve(data);
      }
    };
    this.socket.onclose = (event) => {
      this.ended = true;
      this.pending?.reject(new Error("WebSocket closed before the requested message"));
      this.pending = null;
      closed.resolve(event);
    };
  }

  next(): Promise<WebSocketData> {
    const value = this.queue.shift();
    if (value !== undefined) return Promise.resolve(value);
    if (this.ended) return Promise.reject(new Error("No more WebSocket messages"));
    assert.equal(this.pending, null, "only one message read may be pending");
    this.pending = Promise.withResolvers<WebSocketData>();
    return this.pending.promise;
  }

  async close(code?: number, reason?: string): Promise<CloseEvent> {
    this.socket.close(code, reason);
    return this.closed;
  }
}

function text(value: WebSocketData): string {
  assert.equal(typeof value, "string", "expected a text message");
  return value as string;
}

interface WireFrame {
  readonly opcode: number;
  readonly data: Buffer;
}

interface WireHead {
  readonly status: number;
  readonly headers: ReadonlyMap<string, readonly string[]>;
}

/** Small independent wire client: no production or server framing helpers. */
class WireClient {
  readonly socket: Socket;
  private input: Buffer = Buffer.alloc(0);
  private ended: boolean = false;
  private wake: (() => void) | null = null;

  constructor(socket: Socket) {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => {
      this.input = Buffer.concat([this.input, chunk]);
      this.wake?.();
    });
    socket.on("end", () => { this.ended = true; this.wake?.(); });
    socket.on("close", () => { this.ended = true; this.wake?.(); });
    socket.on("error", () => { this.ended = true; this.wake?.(); });
  }

  private async wait(): Promise<void> {
    if (this.ended) throw new Error("Wire peer ended before the expected bytes");
    await new Promise<void>((resolve) => { this.wake = resolve; });
    this.wake = null;
  }

  async bytes(length: number): Promise<Buffer> {
    while (this.input.length < length) await this.wait();
    const value = this.input.subarray(0, length);
    this.input = this.input.subarray(length);
    return value;
  }

  async headerBytes(): Promise<string> {
    let end = this.input.indexOf("\r\n\r\n");
    while (end < 0) {
      await this.wait();
      end = this.input.indexOf("\r\n\r\n");
    }
    return (await this.bytes(end + 4)).toString("latin1");
  }

  async head(): Promise<WireHead> {
    const lines = (await this.headerBytes()).split("\r\n");
    const first = lines.shift() ?? "";
    const match = /^HTTP\/1\.1 ([0-9]{3}) /.exec(first);
    assert.ok(match !== null, "expected an HTTP status line");
    const headers = new Map<string, string[]>();
    for (const line of lines) {
      const colon = line.indexOf(":");
      if (colon < 0) continue;
      const name = line.slice(0, colon).toLowerCase();
      const values = headers.get(name) ?? [];
      values.push(line.slice(colon + 1).trim());
      headers.set(name, values);
    }
    return { status: Number(match[1]), headers };
  }

  write(bytes: Uint8Array | string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.socket.write(bytes, (error?: Error | null) => { if (error) reject(error); else resolve(); });
    });
  }

  async frame(): Promise<WireFrame> {
    const base = await this.bytes(2);
    const first = base[0] ?? 0;
    const second = base[1] ?? 0;
    assert.equal(first & 128, 128, "these peer messages use complete frames");
    assert.equal(second & 128, 0, "server frames are not masked");
    let length = second & 127;
    if (length === 126) length = (await this.bytes(2)).readUInt16BE();
    else if (length === 127) length = Number((await this.bytes(8)).readBigUInt64BE());
    return { opcode: first & 15, data: await this.bytes(length) };
  }

  send(opcode: number, bytes: Uint8Array = new Uint8Array(0)): Promise<void> {
    assert.ok(bytes.length < 126, "wire fixture payloads use the short length form");
    const result = Buffer.alloc(6 + bytes.length);
    result[0] = 128 | opcode;
    result[1] = 128 | bytes.length;
    result.set([17, 34, 51, 68], 2);
    for (let index = 0; index < bytes.length; index++) result[6 + index] = (bytes[index] ?? 0) ^ (result[2 + (index & 3)] ?? 0);
    return this.write(result);
  }

  async replyToClose(expectedCode = 1000, expectedReason = ""): Promise<void> {
    const frame = await this.frame();
    assert.equal(frame.opcode, 8);
    assert.equal(frame.data.readUInt16BE(), expectedCode);
    assert.equal(frame.data.subarray(2).toString("utf8"), expectedReason);
    await this.send(8, frame.data);
    this.socket.end();
  }
}

async function wire(
  t: TestContext,
  server: WptServer,
  path: string,
  headers: readonly (readonly [string, string])[] = [],
): Promise<WireClient> {
  const port = server.ports.http[0];
  assert.ok(port !== undefined);
  const socket = connect({ host: "127.0.0.1", port });
  const client = new WireClient(socket);
  t.after(() => socket.destroy());
  await once(socket, "connect");
  await client.write(
    `GET ${path} HTTP/1.1\r\nHost: web-platform.test:${port}\r\n` +
    "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
    "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n" +
    headers.map(([name, value]) => `${name}: ${value}\r\n`).join("") + "\r\n",
  );
  return client;
}

suite("WPT echo speaks TCP and trusted TLS with text, binary, compression, and close data", async (t) => {
  const server = await hosted(t);
  for (const origin of [server.wsOrigin, server.wssOrigin]) {
    const probe = new SocketProbe(origin + "/echo", ["other", "echo"]);
    probe.socket.binaryType = "arraybuffer";
    await probe.opened;
    assert.equal(probe.socket.constructor, WebSocket);
    assert.equal(probe.socket.protocol, "echo");
    assert.equal(probe.socket.extensions, "permessage-deflate");
    const payload = "compressed text ".repeat(4096);
    probe.socket.send(payload);
    assert.equal(await probe.next(), payload);
    probe.socket.send(Uint8Array.of(0, 17, 128, 255));
    const binary = await probe.next();
    assert.ok(binary instanceof ArrayBuffer);
    assert.deepEqual(new Uint8Array(binary), Uint8Array.of(0, 17, 128, 255));
    const closed = await probe.close(3456, "reason ☃");
    assert.equal(closed.code, 3456);
    assert.equal(closed.reason, "reason ☃");
    assert.equal(closed.wasClean, true);
  }
  const stream = new WebSocketStream(server.wssOrigin + "/echo");
  const { readable, writable } = await stream.opened;
  const writer = writable.getWriter();
  const reader = readable.getReader();
  await writer.write("stream peer");
  assert.deepEqual(await reader.read(), { value: "stream peer", done: false });
  await writer.close();
  assert.equal((await stream.closed).closeCode, 1005);
});

suite("WPT metadata and query handlers return their request values", async (t) => {
  const server = await hosted(t);
  for (const [path, expected] of [
    ["/origin", server.httpOrigin],
    ["/referrer", "MISSING AS PER FETCH"],
    ["/echo-cookie", "(none)"],
    ["/echo-query?first?second&third=%E2%98%83", "first?second&third=%E2%98%83"],
    ["/echo-query_v13?first?second", "first"],
  ] as const) {
    const probe = new SocketProbe(server.wsOrigin + path);
    assert.equal(await probe.next(), expected, path);
    assert.equal((await probe.closed).wasClean, true, path);
  }
  for (const [path, header, value] of [
    ["/echo-cookie", "Cookie", "a=one; b=two"],
    ["/referrer", "Referer", server.httpOrigin + "/source"],
  ] as const) {
    const client = await wire(t, server, path, [[header, value]]);
    assert.equal((await client.head()).status, 101);
    const message = await client.frame();
    assert.equal(message.opcode, 1);
    assert.equal(message.data.toString(), value);
    await client.replyToClose();
  }
});

suite("WPT protocol handlers distinguish selection from deliberate omission", async (t) => {
  const server = await hosted(t);
  for (const [path, offered, selected] of [
    ["/protocol", "one", "one"],
    ["/protocol_array", "one, two", "one"],
  ] as const) {
    const probe = new SocketProbe(server.wsOrigin + path, offered.split(", "));
    await probe.opened;
    assert.equal(probe.socket.protocol, selected);
    assert.equal(await probe.next(), selected);
    assert.equal((await probe.closed).code, 1000);
  }
  const forced = await wire(t, server, "/handshake_protocol", [["Sec-WebSocket-Protocol", "client"]]);
  const selected = await forced.head();
  assert.equal(selected.status, 101);
  assert.deepEqual(selected.headers.get("sec-websocket-protocol"), ["foobar"]);
  await forced.replyToClose();
  const missing = await wire(t, server, "/handshake_no_protocol", [["Sec-WebSocket-Protocol", "client"]]);
  const omitted = await missing.head();
  assert.equal(omitted.status, 101);
  assert.equal(omitted.headers.has("sec-websocket-protocol"), false);
  await missing.replyToClose();
  const refused = await wire(t, server, "/echo", [["Sec-WebSocket-Protocol", "unsupported"]]);
  assert.equal((await refused.head()).status, 400);
});

suite("WPT compression negotiation accepts supported offers and declines invalid parameters", async (t) => {
  const server = await hosted(t);
  for (const offer of [
    "unknown-extension",
    "permessage-deflate; unknown-parameter",
    "permessage-deflate; server_no_context_takeover; server_no_context_takeover",
    "permessage-deflate; server_no_context_takeover=true",
    "permessage-deflate; server_max_window_bits",
    "permessage-deflate; server_max_window_bits=09",
    "permessage-deflate; server_max_window_bits=16",
    "permessage-deflate; server_max_window_bits=invalid",
    "permessage-deflate; client_max_window_bits=15",
    "permessage-deflate; client_no_context_takeover",
  ]) {
    const client = await wire(t, server, "/echo", [["Sec-WebSocket-Extensions", offer]]);
    const response = await client.head();
    assert.equal(response.status, 101, offer + " still permits an uncompressed connection");
    assert.equal(response.headers.has("sec-websocket-extensions"), false, offer);
    await client.send(8, Uint8Array.of(3, 232));
    await client.replyToClose();
  }
  for (const [offer, expected] of [
    ["permessage-deflate", "permessage-deflate"],
    ["permessage-deflate; client_max_window_bits", "permessage-deflate"],
    ["permessage-deflate; server_no_context_takeover", "permessage-deflate; server_no_context_takeover"],
    [
      "permessage-deflate; server_no_context_takeover; server_max_window_bits=9",
      "permessage-deflate; server_max_window_bits=9; server_no_context_takeover",
    ],
    [
      'permessage-deflate; server_max_window_bits="15"; server_no_context_takeover',
      "permessage-deflate; server_max_window_bits=15; server_no_context_takeover",
    ],
  ] as const) {
    const client = await wire(t, server, "/echo", [["Sec-WebSocket-Extensions", offer]]);
    const response = await client.head();
    assert.equal(response.status, 101);
    assert.deepEqual(response.headers.get("sec-websocket-extensions"), [expected], offer);
    await client.send(8, Uint8Array.of(3, 232));
    await client.replyToClose();
  }
});

suite("WPT empty-message and exit handlers preserve their distinct message policy", async (t) => {
  const server = await hosted(t);
  for (const [payload, expected] of [["", "pass"], [new Uint8Array(0), "fail"]] as const) {
    const probe = new SocketProbe(server.wsOrigin + "/empty-message");
    await probe.opened;
    probe.socket.send(payload);
    assert.equal(await probe.next(), expected);
    assert.equal((await probe.closed).code, 1000);
  }
  for (const path of ["/echo_exit", "/echo_close_data"]) {
    const probe = new SocketProbe(server.wsOrigin + path);
    await probe.opened;
    probe.socket.send("ignored");
    probe.socket.send("Goodbye");
    assert.equal((await probe.closed).code, 1000);
    assert.deepEqual(probe.received, [], path + " does not echo messages");
  }
});

suite("WPT raw echo and malformed opening handlers preserve their exact wire bytes", async (t) => {
  const server = await hosted(t);
  const raw = await wire(t, server, "/echo_raw");
  assert.equal((await raw.head()).status, 101);
  await raw.send(2, Uint8Array.of(129, 4, 119, 105, 114, 101));
  assert.deepEqual(await raw.frame(), { opcode: 1, data: Buffer.from("wire") });
  await raw.send(2, Buffer.from("exit"));
  await raw.replyToClose();

  const invalid = await wire(t, server, "/invalid");
  assert.equal(await invalid.headerBytes(), "FOO BAR BAZ\r\n\r\n");
  assert.equal((await invalid.head()).status, 101, "upstream subsequently writes its normal handshake");
  await invalid.replyToClose();

  const wrong = await wire(t, server, "/wrong_accept_key", [["Origin", server.httpOrigin]]);
  const bad = await wrong.head();
  assert.equal(bad.status, 101);
  assert.deepEqual(bad.headers.get("sec-websocket-accept"), ["thisisawrongacceptkey"]);
  const good = await wrong.head();
  assert.deepEqual(good.headers.get("sec-websocket-accept"), ["s3pPLMBiTxaQ9kYGzzhZRbK+xOo="]);
  assert.equal((await wrong.frame()).data.toString(), "test");
  await wrong.replyToClose();
});

suite("WPT simple handshake writes the response and PASS close together", async (t) => {
  const server = await hosted(t);
  const client = await wire(t, server, "/simple_handshake", [["Origin", server.httpOrigin]]);
  const response = await client.head();
  assert.equal(response.status, 101);
  assert.deepEqual(response.headers.get("set-cookie"), ["ws_test=test"]);
  assert.deepEqual(response.headers.get("sec-websocket-origin"), [server.httpOrigin]);
  await client.replyToClose(1001, "PASS");
  const probe = new SocketProbe(server.wsOrigin + "/simple_handshake");
  await probe.opened;
  const closed = await probe.closed;
  assert.equal(closed.code, 1001);
  assert.equal(closed.reason, "PASS");
  assert.equal(closed.wasClean, true);
});

suite("WPT basic authentication challenges and accepts the exact credentials", async (t) => {
  const server = await hosted(t);
  const refused = await wire(t, server, "/basic_auth");
  const response = await refused.head();
  assert.equal(response.status, 401);
  assert.deepEqual(response.headers.get("www-authenticate"), ['Basic realm="camelot"']);
  const accepted = await wire(t, server, "/basic_auth", [["Authorization", "Basic Zm9vOmJhcg=="]]);
  assert.equal((await accepted.head()).status, 101);
  await accepted.replyToClose();
});

suite("WPT delayed handshakes and extension opt-out retain their upstream responses", async (t) => {
  const server = await hosted(t);
  const delayed = new SocketProbe(server.wsOrigin + "/handshake_sleep_2");
  await delayed.opened;
  assert.equal((await delayed.closed).code, 1000);
  const asleep = new SocketProbe(server.wsOrigin + "/sleep_10_v13");
  await asleep.opened;
  asleep.socket.send("awake");
  assert.equal(await asleep.next(), "awake");
  asleep.socket.send("Goodbye");
  assert.equal((await asleep.closed).wasClean, true);
  const plain = new SocketProbe(server.wsOrigin + "/handshake_no_extensions");
  await plain.opened;
  assert.equal(plain.socket.extensions, "");
  assert.equal((await plain.closed).wasClean, true);
});

suite("WPT passive-close routes either echo after the delay or omit the response", async (t) => {
  const server = await hosted(t);
  const delayed = new SocketProbe(server.wsOrigin + "/delayed-passive-close");
  await delayed.opened;
  const reply = await delayed.close(4567, "delayed reply");
  assert.equal(reply.code, 4567);
  assert.equal(reply.reason, "delayed reply");
  assert.equal(reply.wasClean, true);
  const abrupt = new SocketProbe(server.wsOrigin + "/passive-close-abort");
  await abrupt.opened;
  const missing = await abrupt.close(4000, "no reply");
  assert.equal(missing.code, 1006);
  assert.equal(missing.wasClean, false);
});

suite("WPT remote-close uses the requested code and reason and supports abrupt EOF", async (t) => {
  const server = await hosted(t);
  for (const [query, code, reason] of [
    ["", 1005, ""],
    ["?code=4000&reason=%E2%98%83", 4000, "☃"],
  ] as const) {
    const stream = new WebSocketStream(server.wsOrigin + "/remote-close" + query);
    assert.deepEqual(await stream.closed, { closeCode: code, reason });
  }
  const abrupt = new WebSocketStream(server.wsOrigin + "/remote-close?abrupt=1");
  await abrupt.opened;
  await assert.rejects(abrupt.closed, (error: unknown) => {
    assert.ok(error instanceof WebSocketError);
    assert.equal(error.closeCode, 1006);
    return true;
  });
});

suite("WPT receive-backpressure resources acknowledge complete messages without compression", async (t) => {
  const server = await hosted(t);
  const stream = new WebSocketStream(server.wsOrigin + "/receive-backpressure");
  const { writable, extensions } = await stream.opened;
  assert.equal(extensions, "");
  await writable.getWriter().write(new Uint8Array(8 * 1024 * 1024));
  assert.equal((await stream.closed).closeCode, 1000);
  const many = new SocketProbe(server.wsOrigin + "/receive-many-with-backpressure");
  await many.opened;
  assert.equal(many.socket.extensions, "");
  many.socket.send("💙x");
  assert.equal(await many.next(), "2", "Python str lengths count Unicode code points");
  many.socket.send(new Uint8Array(65536));
  assert.equal(await many.next(), "65536");
  assert.equal((await many.close()).wasClean, true);
});

suite("WPT send-backpressure resource emits its empty queue filler and sixteen large messages", async (t) => {
  const server = await hosted(t);
  const stream = new WebSocketStream(server.wsOrigin + "/send-backpressure");
  const { readable, extensions } = await stream.opened;
  assert.equal(extensions, "");
  const reader = readable.getReader();
  const first = await reader.read();
  assert.equal(first.done, false);
  assert.ok(first.value instanceof Uint8Array);
  assert.equal(first.value.length, 0);
  for (let index = 0; index < 16; index++) {
    const next = await reader.read();
    assert.equal(next.done, false);
    assert.ok(next.value instanceof Uint8Array);
    assert.equal(next.value.length, 1024 * 1024);
    assert.equal(next.value.every((byte) => byte === 32), true);
  }
  const duration = await reader.read();
  assert.equal(typeof duration.value, "string");
  assert.equal(Number.isFinite(Number(duration.value)), true, "upstream reports a duration in seconds");
  assert.equal((await reader.read()).done, true);
  assert.equal((await stream.closed).closeCode, 1000);
});

suite("WPT cookie handlers emit the upstream cookie attributes and duplicate header fields", async (t) => {
  const server = await hosted(t);
  const origin: readonly [string, string] = ["Origin", server.httpOrigin];
  for (const [path, expected] of [
    ["/set-cookie?plain", ["ws_test_plain=test; Path=/"]],
    ["/set-cookie-secure?secure", ["ws_test_secure=test; Secure; Path=/"]],
    ["/set-cookie_http?http", ["ws_test_http=test; Path=/; HttpOnly"]],
    ["/set-cookies-samesite?value=chosen&clear", [
      "samesite-unspecified=chosen; Path=/; Max-Age=0",
      "samesite-lax=chosen; Path=/; SameSite=Lax; Max-Age=0",
      "samesite-strict=chosen; Path=/; SameSite=Strict; Max-Age=0",
      "samesite-none=chosen; Path=/; SameSite=None; Secure; Max-Age=0",
    ]],
  ] as const) {
    const client = await wire(t, server, path, [origin]);
    const response = await client.head();
    assert.equal(response.status, 101);
    assert.deepEqual(response.headers.get("set-cookie"), expected);
    if (path.startsWith("/set-cookie_http")) {
      assert.deepEqual(response.headers.get("sec-websocket-origin"), [server.httpOrigin]);
    }
    await client.send(8, Uint8Array.of(15, 160));
    await client.replyToClose();
  }
});

async function stashRequest(server: WptServer, query: string, secure = false): Promise<unknown> {
  const probe = new SocketProbe((secure ? server.wssOrigin : server.wsOrigin) + "/stash_responder?path=/shared&key=one&" + query);
  await probe.opened;
  probe.socket.send("echo");
  const value: unknown = JSON.parse(text(await probe.next()));
  assert.equal((await probe.closed).wasClean, true);
  return value;
}

suite("WPT stash responder namespaces, consumes, purges, and records TLS upgrades", async (t) => {
  const server = await hosted(t);
  assert.deepEqual(await stashRequest(server, "action=put&value=saved"), { status: "success", result: "one" });
  assert.deepEqual(await stashRequest(server, "action=take"), { status: "blocked", result: "saved" });
  assert.deepEqual(await stashRequest(server, "action=take"), { status: "allowed", result: null });
  await stashRequest(server, "action=put&value=purged");
  assert.deepEqual(await stashRequest(server, "action=purge"), { status: "success", result: "purged" });
  await stashRequest(server, "action=check-scheme");
  assert.deepEqual(await stashRequest(server, "action=take"), { status: "allowed", result: null });
  await stashRequest(server, "action=check-scheme", true);
  assert.deepEqual(await stashRequest(server, "action=take"), { status: "blocked", result: "upgraded" });
});

suite("WPT blocking stash serves a waiting getter and keeps server instances independent", async (t) => {
  const server = await hosted(t);
  const getter = new SocketProbe(server.wsOrigin + "/stash_responder_blocking");
  const setter = new SocketProbe(server.wsOrigin + "/stash_responder_blocking");
  await Promise.all([getter.opened, setter.opened]);
  getter.socket.send(JSON.stringify({ action: "get", key: "waiting" }));
  setter.socket.send(JSON.stringify({ action: "set", key: "waiting", value: { data: [1, 2] } }));
  assert.deepEqual(JSON.parse(text(await setter.next())), {});
  assert.deepEqual(JSON.parse(text(await getter.next())), { value: { data: [1, 2] } });
  await Promise.all([getter.closed, setter.closed]);
  assert.equal(server.state.take("/stash_responder_blocking", "waiting"), null);
  const other = await startWptServer();
  try {
    server.state.put("/stash_responder_blocking", "local", "one");
    assert.equal(other.state.take("/stash_responder_blocking", "local"), null);
  } finally {
    await other.close();
  }
});

suite("WPT message channels share a queue, disconnect a reader, and reopen without stale commands", async (t) => {
  const server = await hosted(t);
  for (let round = 0; round < 2; round++) {
    const reader = new SocketProbe(server.wsOrigin + "/msg_channel?uuid=channel&direction=read");
    const first = new SocketProbe(server.wsOrigin + "/msg_channel?uuid=channel&direction=write");
    const second = new SocketProbe(server.wsOrigin + "/msg_channel?uuid=channel&direction=write");
    await Promise.all([reader.opened, first.opened, second.opened]);
    first.socket.send(JSON.stringify(["message", { from: "first", round }]));
    assert.deepEqual(JSON.parse(text(await reader.next())), { from: "first", round });
    second.socket.send(JSON.stringify(["message", { from: "second", round }]));
    assert.deepEqual(JSON.parse(text(await reader.next())), { from: "second", round });
    first.socket.send(JSON.stringify(["disconnectReader", null]));
    assert.equal((await reader.closed).wasClean, true);
    await Promise.all([first.close(), second.close()]);
  }
});

suite("WPT server shutdown cancels delayed and waiting WebSocket handlers", async (t) => {
  const server = await hosted(t);
  const delayed = new SocketProbe(server.wsOrigin + "/sleep_10_v13");
  const waiter = new SocketProbe(server.wsOrigin + "/stash_responder_blocking");
  const reader = new SocketProbe(server.wsOrigin + "/msg_channel?uuid=waiting&direction=read");
  await Promise.all([waiter.opened, reader.opened]);
  waiter.socket.send(JSON.stringify({ action: "get", key: "never-set" }));
  const firstClose = server.close();
  assert.equal(server.close(), firstClose, "repeated shutdown joins the same operation");
  await firstClose;
  const closed = await Promise.all([delayed.closed, waiter.closed, reader.closed]);
  assert.equal(closed.every((event) => event.code === 1006), true);
});
