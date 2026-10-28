// Node reproductions of the pinned WPT pywebsocket3 handlers. Source paths are
// beside each route; provenance and the upstream licence live with the corpus.
// This is a test peer, so deliberately invalid responses stay invalid on the wire.
import type { WptWebSocketPeer } from "./peer.ts";
import type { WptServerState } from "./state.ts";

interface HandshakeOptions {
  protocol?: string;
  headers?: readonly [string, string][];
  compression?: boolean;
}

/** pywebsocket3's normal handshake requires a selection when protocols were offered. */
async function accept(peer: WptWebSocketPeer, options: HandshakeOptions = {}): Promise<boolean> {
  const offered = peer.header("sec-websocket-protocol");
  const selected = options.protocol;
  if (
    (offered !== "" && selected === undefined) ||
    (offered === "" && selected !== undefined) ||
    (selected !== undefined && !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(selected))
  ) {
    await reject(peer, 400, "Bad Request");
    return false;
  }
  await peer.accept(options);
  return true;
}

async function reject(peer: WptWebSocketPeer, status: number, reason: string): Promise<void> {
  await peer.writeRaw(`HTTP/1.1 ${status} ${reason}\r\nContent-Length: 0\r\n\r\n`);
  peer.end();
}

async function finish(peer: WptWebSocketPeer, echo = false): Promise<void> {
  if (peer.socket.destroyed) return;
  // dispatch.py's default passive handshake sends 1000 and an empty reason.
  // Only handlers with a custom passive handshake echo the client's values.
  await peer.close(echo ? peer.closeCode : 1000, echo ? peer.closeReason : "");
}

function rawQuery(peer: WptWebSocketPeer): string {
  const target = peer.request.url ?? "";
  const question = target.indexOf("?");
  return question === -1 ? "" : target.slice(question + 1);
}

function jsonObject(bytes: Uint8Array): Record<string, unknown> {
  const value: unknown = JSON.parse(Buffer.from(bytes).toString("utf8"));
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError("The WPT handler expected a JSON object");
  }
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new TypeError(`The WPT handler requires ${name}`);
  return value;
}

async function echo(peer: WptWebSocketPeer): Promise<void> {
  const protocols = peer.header("sec-websocket-protocol").split(",").map((value) => value.trim());
  if (!(await accept(peer, protocols.includes("echo") ? { protocol: "echo" } : {}))) return;
  while (!peer.socket.destroyed) {
    const message = await peer.readMessage();
    if (message === null) {
      await finish(peer, true);
      return;
    }
    await peer.send(message.data, message.binary);
    if (!message.binary && message.data.toString("utf8") === "Goodbye") {
      await finish(peer);
      return;
    }
  }
}

async function exitOnGoodbye(peer: WptWebSocketPeer, echoOtherMessages: boolean): Promise<void> {
  if (!(await accept(peer))) return;
  while (!peer.socket.destroyed) {
    const message = await peer.readMessage();
    if (message === null || (!message.binary && message.data.toString("utf8") === "Goodbye")) {
      await finish(peer);
      return;
    }
    if (echoOtherMessages) await peer.send(message.data, false);
  }
}

async function respond(peer: WptWebSocketPeer, value: string): Promise<void> {
  if (!(await accept(peer))) return;
  await peer.send(value);
  await finish(peer);
}

async function setCookies(peer: WptWebSocketPeer, cookies: readonly string[]): Promise<void> {
  const headers: [string, string][] = cookies.map((value) => ["Set-Cookie", value]);
  if (!(await accept(peer, { headers }))) return;
  // The upstream transfer handler performs one receive, ordinarily the close.
  await peer.readMessage();
  await finish(peer);
}

async function blockingStash(peer: WptWebSocketPeer, state: WptServerState): Promise<void> {
  if (!(await accept(peer))) return;
  const message = await peer.readMessage();
  if (message === null) {
    await finish(peer);
    return;
  }
  const query = jsonObject(message.data);
  const key = requiredString(query.key, "key");
  let result: object = {};
  if (query.action === "set") {
    state.put("/stash_responder_blocking", key, query.value);
  } else if (query.action === "get") {
    try {
      const value = await state.wait("/stash_responder_blocking", key, peer.signal);
      result = { value };
    } catch (error) {
      if (peer.signal.aborted) return;
      throw error;
    }
  }
  if (peer.signal.aborted) return;
  await peer.send(JSON.stringify(result));
  await finish(peer);
}

async function stashResponder(peer: WptWebSocketPeer, state: WptServerState): Promise<void> {
  if (!(await accept(peer))) return;
  while (!peer.socket.destroyed) {
    const message = await peer.readMessage();
    if (message === null) {
      await finish(peer);
      return;
    }
    if (message.binary || message.data.toString("utf8") !== "echo") continue;
    const parameters = peer.url.searchParams;
    const path = parameters.get("path") ?? peer.url.pathname;
    const key = requiredString(parameters.get("key"), "key");
    let result: object;
    switch (parameters.get("action")) {
      case "put":
        state.take(path, key);
        state.put(path, key, requiredString(parameters.get("value"), "value"));
        result = { status: "success", result: key };
        break;
      case "purge":
        result = { status: "success", result: state.take(path, key) };
        break;
      case "check-scheme":
        if (peer.secure) {
          state.take(path, key);
          state.put(path, key, "upgraded");
        }
        result = { status: "success", result: key };
        break;
      case "take": {
        const value = state.take(path, key);
        result = { status: value === null ? "allowed" : "blocked", result: value };
        break;
      }
      default:
        throw new TypeError("Unknown WPT stash action");
    }
    await peer.send(JSON.stringify(result));
    await finish(peer);
    return;
  }
}

type ChannelCommand = { readonly command: "message"; readonly data: unknown } | { readonly command: "close" };

/** The single-consumer queue behind msg_channel_wsh.py, scoped to one server. */
class MessageChannel {
  readonly queue: ChannelCommand[] = [];
  hasReader: boolean = false;
  writerCount: number = 0;
  private waiting: PromiseWithResolvers<ChannelCommand> | null = null;

  push(command: ChannelCommand): void {
    const waiting = this.waiting;
    if (waiting === null) this.queue.push(command);
    else {
      this.waiting = null;
      waiting.resolve(command);
    }
  }

  next(): Promise<ChannelCommand> {
    const command = this.queue.shift();
    if (command !== undefined) return Promise.resolve(command);
    const waiting = Promise.withResolvers<ChannelCommand>();
    this.waiting = waiting;
    return waiting.promise;
  }
}

function channelCommand(data: Uint8Array): readonly [unknown, unknown] {
  const value: unknown = JSON.parse(Buffer.from(data).toString("utf8"));
  if (!Array.isArray(value) || value.length !== 2) {
    throw new TypeError("The message channel expected a command and a value");
  }
  return [value[0], value[1]];
}

async function readChannel(peer: WptWebSocketPeer, channel: MessageChannel): Promise<void> {
  let closing = false;
  let notified = false;
  const notifyClose = (): void => {
    if (closing || notified) return;
    notified = true;
    channel.push({ command: "close" });
  };
  // Like upstream's wait_for_close thread, receive independently of queue writes.
  // There is one reader throughout, including while the close response arrives.
  const receiving = (async () => {
    try {
      while (!peer.socket.destroyed) {
        const message = await peer.readMessage();
        if (message === null) return;
        try {
          const [command] = channelCommand(message.data);
          if (command === "close") notifyClose();
        } catch {
          // Unexpected reader messages are logged and ignored by upstream.
        }
      }
    } finally {
      notifyClose();
    }
  })();
  // An expected disconnect must not become an unhandled rejection while a
  // queued send is settling. Awaiting below still observes a genuine failure.
  void receiving.catch(() => {});
  try {
    while (!peer.socket.destroyed) {
      const entry = await channel.next();
      if (entry.command === "close") break;
      await peer.send(JSON.stringify(entry.data) ?? "null");
    }
    closing = true;
    if (!peer.socket.destroyed) {
      await peer.sendFrame(8, Uint8Array.of(3, 232));
      await receiving;
      peer.end();
    }
  } catch (error) {
    peer.abort();
    await receiving.catch(() => {});
    throw error;
  }
}

async function messageChannel(peer: WptWebSocketPeer, state: WptServerState): Promise<void> {
  if (!(await accept(peer))) return;
  const uuid = requiredString(peer.url.searchParams.get("uuid"), "uuid");
  const direction = requiredString(peer.url.searchParams.get("direction"), "direction");
  if (direction !== "read" && direction !== "write") throw new TypeError("Unknown channel direction");
  const previous = state.take("msg_channel", uuid);
  const channel = previous instanceof MessageChannel ? previous : new MessageChannel();
  state.put("msg_channel", uuid, channel);
  if (direction === "read") {
    if (channel.hasReader) throw new TypeError("A WPT message channel has only one reader");
    channel.hasReader = true;
  } else channel.writerCount++;
  try {
    if (direction === "read") await readChannel(peer, channel);
    else {
      while (!peer.socket.destroyed) {
        const message = await peer.readMessage();
        if (message === null) break;
        const [command, data] = channelCommand(message.data);
        if (command === "disconnectReader") channel.push({ command: "close" });
        else if (command === "message") channel.push({ command: "message", data });
        else if (command === "delete") state.take("msg_channel", uuid);
      }
      await finish(peer);
    }
  } finally {
    if (direction === "read") channel.hasReader = false;
    else channel.writerCount--;
    // A force-deleted channel may have been replaced with a new one already.
    const current = state.take("msg_channel", uuid);
    if (current !== null && current !== channel) state.put("msg_channel", uuid, current);
    else if (current === channel && (channel.hasReader || channel.writerCount > 0 || channel.queue.length > 0)) {
      state.put("msg_channel", uuid, channel);
    }
  }
}

/** Routes use the same /name paths as pywebsocket3's handlers directory. */
export async function handleWebSocket(peer: WptWebSocketPeer, state: WptServerState): Promise<void> {
  switch (peer.url.pathname) {
    // websockets/handlers/echo_wsh.py
    case "/echo":
      await echo(peer);
      return;
    // websockets/handlers/echo_exit_wsh.py
    // websockets/handlers/echo_close_data_wsh.py (its echo is unreachable upstream).
    case "/echo_exit":
    case "/echo_close_data":
      await exitOnGoodbye(peer, false);
      return;
    // websockets/handlers/sleep_10_v13_wsh.py
    case "/sleep_10_v13":
      await peer.delay(10000);
      if (!peer.signal.aborted) await exitOnGoodbye(peer, true);
      return;
    // websockets/handlers/echo_raw_wsh.py
    case "/echo_raw":
      if (!(await accept(peer))) return;
      while (!peer.socket.destroyed) {
        const message = await peer.readMessage();
        if (message === null || (message.binary && message.data.equals(Buffer.from("exit")))) break;
        await peer.writeRaw(message.data);
      }
      await finish(peer);
      return;
    // websockets/handlers/empty-message_wsh.py
    case "/empty-message": {
      if (!(await accept(peer))) return;
      const message = await peer.readMessage();
      await peer.send(message !== null && !message.binary && message.data.length === 0 ? "pass" : "fail");
      await finish(peer);
      return;
    }
    // websockets/handlers/origin_wsh.py
    case "/origin":
      await respond(peer, peer.header("origin"));
      return;
    // websockets/handlers/referrer_wsh.py
    case "/referrer":
      await respond(peer, peer.request.headers.referer ?? "MISSING AS PER FETCH");
      return;
    // websockets/handlers/echo-cookie_wsh.py
    case "/echo-cookie":
      await respond(peer, peer.request.headers.cookie ?? "(none)");
      return;
    // websockets/handlers/echo-query_wsh.py
    case "/echo-query":
      await respond(peer, rawQuery(peer));
      return;
    // websockets/handlers/echo-query_v13_wsh.py
    case "/echo-query_v13":
      await respond(peer, rawQuery(peer).split("?")[0] ?? "");
      return;
    // websockets/handlers/protocol_wsh.py
    case "/protocol": {
      const protocol = peer.header("sec-websocket-protocol");
      if (!(await accept(peer, protocol === "" ? {} : { protocol }))) return;
      await peer.send(protocol);
      await finish(peer);
      return;
    }
    // websockets/handlers/protocol_array_wsh.py
    case "/protocol_array": {
      const protocol = peer.header("sec-websocket-protocol").split(",")[0] ?? "";
      if (!(await accept(peer, protocol === "" ? {} : { protocol }))) return;
      await peer.send(protocol);
      await finish(peer);
      return;
    }
    // websockets/handlers/handshake_protocol_wsh.py
    case "/handshake_protocol":
      if (await accept(peer, { protocol: "foobar" })) await finish(peer);
      return;
    // websockets/handlers/handshake_no_protocol_wsh.py
    case "/handshake_no_protocol":
      // This route deliberately hides the offered protocols from the handshaker.
      await peer.accept();
      await finish(peer);
      return;
    // websockets/handlers/handshake_no_extensions_wsh.py
    case "/handshake_no_extensions":
      if (await accept(peer, { compression: false })) await finish(peer);
      return;
    // websockets/handlers/handshake_sleep_2_wsh.py
    case "/handshake_sleep_2":
      await peer.delay(2000);
      if (!peer.signal.aborted && (await accept(peer))) await finish(peer);
      return;
    // websockets/handlers/invalid_wsh.py
    case "/invalid":
      await peer.writeRaw("FOO BAR BAZ\r\n\r\n");
      if (await accept(peer)) await finish(peer);
      return;
    // websockets/handlers/wrong_accept_key_wsh.py
    case "/wrong_accept_key":
      await peer.writeRaw(
        "HTTP/1.1 101 Switching Protocols:\r\nConnection: Upgrade\r\nUpgrade: WebSocket\r\n" +
        `Sec-WebSocket-Origin: ${peer.header("origin")}\r\n` +
        "Sec-WebSocket-Accept: thisisawrongacceptkey\r\n\r\n",
      );
      // Upstream then finishes its ordinary handshake after the invalid one.
      if (await accept(peer)) {
        await peer.send("test");
        await finish(peer);
      }
      return;
    // websockets/handlers/simple_handshake_wsh.py
    case "/simple_handshake":
      await peer.accept({
        compression: false,
        statusText: "Switching Protocols:",
        headers: [["Set-Cookie", "ws_test=test"], ["Sec-WebSocket-Origin", peer.header("origin")]],
        initialFrame: Uint8Array.of(136, 6, 3, 233, 80, 65, 83, 83),
      });
      // The response head and 1001/PASS Close frame are one write, then wait for
      // the client's masked close, as upstream's manual handshake does.
      while (!peer.socket.destroyed && (await peer.readMessage()) !== null) {}
      peer.end();
      return;
    // websockets/handlers/basic_auth_wsh.py
    case "/basic_auth":
      if (peer.header("authorization") !== "Basic Zm9vOmJhcg==") {
        await peer.writeRaw(
          "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nWWW-Authenticate: Basic realm=\"camelot\"\r\n\r\n",
        );
        peer.end();
      } else if (await accept(peer)) await finish(peer);
      return;
    // websockets/handlers/delayed-passive-close_wsh.py
    case "/delayed-passive-close":
      if (!(await accept(peer))) return;
      await peer.readMessage();
      if (peer.closeReceived) {
        await peer.delay(1000);
        await finish(peer, true);
      } else await finish(peer);
      return;
    // websockets/handlers/passive-close-abort_wsh.py
    case "/passive-close-abort":
      if (!(await accept(peer))) return;
      while (!peer.socket.destroyed && (await peer.readMessage()) !== null) {}
      peer.abort();
      return;
    // websockets/handlers/remote-close_wsh.py
    case "/remote-close": {
      if (!(await accept(peer))) return;
      if (peer.url.searchParams.has("abrupt")) {
        await peer.sendFrame(9, Buffer.from("ping"));
        peer.abort();
        return;
      }
      const rawCode = peer.url.searchParams.get("code");
      const code = rawCode === null ? null : Number(rawCode);
      const reason = code === null ? "" : peer.url.searchParams.get("reason") ?? "";
      await peer.close(code, reason);
      return;
    }
    // websockets/handlers/receive-backpressure_wsh.py
    case "/receive-backpressure":
      if (!(await accept(peer, { compression: false }))) return;
      await peer.delay(2000);
      if (peer.signal.aborted) return;
      await peer.readMessage();
      await finish(peer);
      return;
    // websockets/handlers/receive-many-with-backpressure_wsh.py
    case "/receive-many-with-backpressure":
      if (!(await accept(peer, { compression: false }))) return;
      while (!peer.socket.destroyed) {
        await peer.delay(100);
        if (peer.signal.aborted) return;
        const message = await peer.readMessage();
        if (message === null) break;
        // Python len(str) counts Unicode code points, not UTF-16 code units.
        const size = message.binary ? message.data.length : [...message.data.toString("utf8")].length;
        await peer.send(String(size));
      }
      await finish(peer);
      return;
    // websockets/handlers/send-backpressure_wsh.py
    case "/send-backpressure": {
      if (!(await accept(peer, { compression: false }))) return;
      await peer.send(new Uint8Array(0), true);
      const start = performance.now();
      const message = Buffer.alloc(1024 * 1024, 32);
      for (let index = 0; index < 16; index++) await peer.send(message, true);
      // The upstream handler reports seconds; this is a resource response, not
      // a timing assertion added to this package's gate.
      await peer.send(String((performance.now() - start) / 1000));
      await finish(peer);
      return;
    }
    // websockets/handlers/set-cookie_wsh.py
    case "/set-cookie":
      await setCookies(peer, [`ws_test_${rawQuery(peer)}=test; Path=/`]);
      return;
    // websockets/handlers/set-cookie-secure_wsh.py
    case "/set-cookie-secure":
      await setCookies(peer, [`ws_test_${rawQuery(peer)}=test; Secure; Path=/`]);
      return;
    // websockets/handlers/set-cookie_http_wsh.py
    case "/set-cookie_http":
      if (!(await accept(peer, { headers: [
        ["Set-Cookie", `ws_test_${rawQuery(peer)}=test; Path=/; HttpOnly`],
        ["Sec-WebSocket-Origin", peer.header("origin")],
      ] }))) return;
      await peer.readMessage();
      await finish(peer);
      return;
    // websockets/handlers/set-cookies-samesite_wsh.py
    case "/set-cookies-samesite": {
      const query = rawQuery(peer);
      const maxAge = query.includes("clear") ? "; Max-Age=0" : "";
      const value = query.includes("value") ? requiredString(peer.url.searchParams.get("value"), "value") : "1";
      await setCookies(peer, [
        `samesite-unspecified=${value}; Path=/${maxAge}`,
        `samesite-lax=${value}; Path=/; SameSite=Lax${maxAge}`,
        `samesite-strict=${value}; Path=/; SameSite=Strict${maxAge}`,
        `samesite-none=${value}; Path=/; SameSite=None; Secure${maxAge}`,
      ]);
      return;
    }
    // websockets/handlers/stash_responder_wsh.py
    case "/stash_responder":
      await stashResponder(peer, state);
      return;
    // websockets/handlers/stash_responder_blocking_wsh.py
    case "/stash_responder_blocking":
      await blockingStash(peer, state);
      return;
    // websockets/handlers/msg_channel_wsh.py
    case "/msg_channel":
      await messageChannel(peer, state);
      return;
    default:
      await reject(peer, 404, "Not Found");
  }
}
