// A WebSocket client whose connection comes from the HTTP dispatch stack.
//
// The tunnel seam landed with only its own tests as consumers, which is the shape this
// ledger keeps recording as a defect. This is its consumer: `DispatchedWebSocketTransport`
// sends an ordinary request that asks to keep its connection, so proxies, DNS, pooling
// and interceptors apply to a WebSocket exactly as they do to a request.
//
// The peer is the shared server pieces over a real socket, so both ends of one framing
// engine have to agree -- and the connection between them has been through a real HTTP
// transport rather than a fake.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";

import {
  AbortController,
  DispatchedWebSocketTransport,
} from "../src/index.ts";
import { Http1Transport } from "../src/http1/transport.ts";
import {
  HostNodeSocketConnector,
  HostNodeScheduler,
  HostNodeTlsUpgrader,
  hostNodeRandom,
  hostNodeURLs,
} from "../host/node-primitives.ts";
import { ProxyAgent } from "../src/provider.ts";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { connect, createServer } from "node:net";

import { websocketServer } from "./websocket-echo-server.ts";
import type { Socket } from "node:net";
import { causeText, messageData, must, portOf } from "./harness.ts";
import type {
  FetchTransport,
  TransportRequest,
  TransportResponse,
} from "../src/fetch/transport.ts";
import type { ByteConnection } from "../src/provider/primitives.ts";
import type { WebSocketHandshake } from "../src/websocket/transport.ts";
import type { Event } from "../src/index.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const none = () => new AbortController().signal;

function transportOf(
  t: TestContext,
  fetchTransport?: FetchTransport,
): DispatchedWebSocketTransport {
  const scheduler = new HostNodeScheduler(() => {});
  const transport =
    fetchTransport ?? new Http1Transport(new HostNodeSocketConnector(), scheduler, {});
  const websockets = new DispatchedWebSocketTransport(transport, hostNodeRandom, scheduler, {});
  t.after(() => websockets.close());
  return websockets;
}

function handshake(port: number, protocols: readonly string[] = []): WebSocketHandshake {
  return {
    url: hostNodeURLs.parse(`http://127.0.0.1:${port}/socket`),
    protocols,
    origin: "http://127.0.0.1",
  };
}

suite("a dispatched client round-trips text and binary with a real server", async (t) => {
  const { port, seen } = await websocketServer(t, { protocols: ["chat"] });
  const websockets = transportOf(t);

  const session = await websockets.connect(handshake(port, ["chat"]), none());
  assert.equal(session.protocol, "chat", "the subprotocol survived the dispatch");

  await session.send({ kind: "text", data: "hello over HTTP" });
  const first = await session.next();
  assert.equal(first.kind, "text");
  assert.equal(first.data, "hello over HTTP");

  await session.send({ kind: "binary", data: encoder.encode("raw bytes") });
  const second = await session.next();
  assert.equal(second.kind, "binary");
  assert.equal(decoder.decode(second.data), "raw bytes");

  await session.close(1000, "done");
  assert.equal(seen.protocol, "chat");
  assert.equal(seen.messages.length, 2);
});

/** A server that answers the upgrade with an ordinary HTTP response. */
async function decliningServer(t: TestContext): Promise<number> {
  const CRLF = String.fromCharCode(13, 10);
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    let head = "";
    socket.on("data", (chunk) => {
      head += chunk.toString("latin1");
      if (!head.includes(CRLF + CRLF)) return;
      socket.write(
        ["HTTP/1.1 426 Upgrade Required", "Content-Length: 10", "", "no sockets"].join(CRLF),
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return portOf(server);
}

suite("a real server that declines is reported, not mistaken for a socket", async (t) => {
  // Through the real HTTP transport, so this is the whole path: the server answers with
  // a status instead of switching, and a WebSocket that treated that as connected would
  // read the refusal's body as frames.
  const port = await decliningServer(t);
  const websockets = transportOf(t);

  await assert.rejects(
    () => websockets.connect(handshake(port, []), none()),
    (error: unknown) => /did not yield a connection \(status 426\)/.test(causeText(error)),
  );
});

suite("a transport that cannot surrender its socket is refused, not assumed", async (t) => {
  // Not a hypothetical: any transport predating the tunnel seam behaves exactly like
  // this, and the failure it would otherwise cause is a session reading HTTP as frames.
  const plain = {
    async dispatch() {
      return { status: 200, statusText: "OK", headers: [], body: null };
    },
  };
  const websockets = transportOf(t, plain);

  await assert.rejects(
    () => websockets.connect(handshake(1, []), none()),
    (error: unknown) => /did not yield a connection/.test(causeText(error)),
  );
});

suite("a bad Sec-WebSocket-Accept closes the connection it was handed", async (t) => {
  // Recorded into an array rather than a `let`: the only assignment is inside the dispatch, and
  // control-flow analysis cannot see that it ran.
  const handed: { closed: boolean }[] = [];
  const lying: FetchTransport = {
    async dispatch(request: TransportRequest): Promise<TransportResponse> {
      assert.equal(request.acceptTunnel, true);
      assert.equal(request.upgradeProtocol, "websocket");
      // A closed flag behind a getter, because `ByteConnection.closed` is readonly: the
      // literal declared it as a mutable field and assigned through `this`, which the
      // interface does not permit and which only worked because nothing checked.
      let closed = false;
      const connection: ByteConnection = {
        get closed(): boolean {
          return closed;
        },
        read: async () => null,
        write: async () => 0,
        close(): void {
          closed = true;
        },
      };
      handed.push(connection);
      return {
        status: 101,
        statusText: "Switching Protocols",
        headers: [
          ["upgrade", "websocket"],
          ["connection", "upgrade"],
          ["sec-websocket-accept", "obviously-wrong"],
        ],
        body: null,
        connection,
      };
    },
  };
  const websockets = transportOf(t, lying);

  await assert.rejects(() => websockets.connect(handshake(1, []), none()));
  // The connection became ours the moment it was handed over; nothing else will close it.
  assert.equal(must(handed[0], "the transport handed a connection over").closed, true);
});

suite("the handshake headers the server needs are the ones sent", async (t) => {
  const sent: TransportRequest[] = [];
  const capturing: FetchTransport = {
    async dispatch(request: TransportRequest): Promise<TransportResponse> {
      sent.push(request);
      return { status: 200, statusText: "OK", headers: [], body: null };
    },
  };
  const websockets = transportOf(t, capturing);
  await assert.rejects(() => websockets.connect(handshake(1, ["a", "b"]), none()));

  const capturedRequest = must(sent[0], "the transport dispatched the handshake");
  const names = new Map<string, string>(
    capturedRequest.headers.map(([name, value]) => [name, value]),
  );
  assert.equal(names.get("sec-websocket-version"), "13");
  assert.equal(names.get("sec-websocket-protocol"), "a, b");
  assert.equal(names.get("origin"), "http://127.0.0.1");
  assert.ok(/^[A-Za-z0-9+/]{22}==$/.test(names.get("sec-websocket-key") ?? ""), "a 16-byte key");
  // Framing headers stay the transport's: the protocol is named by the field.
  assert.equal(names.has("connection"), false);
  assert.equal(names.has("upgrade"), false);
  assert.equal(capturedRequest.upgradeProtocol, "websocket");
});

suite("closing the transport aborts the sessions it opened", async (t) => {
  const { port } = await websocketServer(t, { protocols: [] });
  const scheduler = new HostNodeScheduler(() => {});
  const websockets = new DispatchedWebSocketTransport(
    new Http1Transport(new HostNodeSocketConnector(), scheduler, {}),
    hostNodeRandom,
    scheduler,
    {},
  );

  const session = await websockets.connect(handshake(port), none());
  websockets.close();
  const ending = await session.next();
  assert.equal(ending.kind, "close", "an aborted session reports a close rather than hanging");

  await assert.rejects(() => websockets.connect(handshake(port), none()), TypeError);
});

suite("an already-aborted signal never reaches the transport", async (t) => {
  let dispatched = 0;
  const counting = {
    async dispatch() {
      dispatched++;
      return { status: 200, statusText: "OK", headers: [], body: null };
    },
  };
  const websockets = transportOf(t, counting);
  const controller = new AbortController();
  const reason = new Error("gave up first");
  controller.abort(reason);

  await assert.rejects(
    () => websockets.connect(handshake(1, []), controller.signal),
    (thrown) => thrown === reason,
  );
  assert.equal(dispatched, 0);
});

/**
 * A CONNECT proxy that pipes bytes to wherever it was asked to.
 *
 * Small on purpose: everything interesting happens on the client side, and a proxy that
 * does more would make it harder to tell whose behaviour a failure belonged to.
 */
async function connectProxy(t: TestContext) {
  const CRLF = String.fromCharCode(13, 10);
  const seen: { targets: string[] } = { targets: [] };
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    sockets.add(client);
    client.on("error", () => {});
    client.on("close", () => sockets.delete(client));
    let head = "";
    let piping = false;
    client.on("data", (chunk) => {
      if (piping) return;
      head += chunk.toString("latin1");
      if (!head.includes(CRLF + CRLF)) return;
      const authority = head.split(" ")[1] ?? "";
      seen.targets.push(authority);
      const colon = authority.lastIndexOf(":");
      const upstream = connect(Number(authority.slice(colon + 1)), authority.slice(0, colon), () => {
        piping = true;
        client.write("HTTP/1.1 200 Connection Established" + CRLF + CRLF);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      upstream.on("error", () => client.destroy());
      sockets.add(upstream);
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { port: portOf(server), seen };
}

suite("a WebSocket reaches its server through a CONNECT proxy", async (t) => {
  // The capability the raw transport cannot have: it opens its own socket, so a proxy
  // would have to be reimplemented inside it. Here the proxy is just a transport.
  const { port: originPort, seen: origin } = await websocketServer(t, { protocols: ["chat"] });
  const { port: proxyPort, seen: proxy } = await connectProxy(t);
  const scheduler = new HostNodeScheduler(() => {});
  const agent = new ProxyAgent({
    connector: new HostNodeSocketConnector(),
    tls: new HostNodeTlsUpgrader(),
    scheduler,
    urls: hostNodeURLs,
    uri: `http://127.0.0.1:${proxyPort}`,
    proxyTunnel: true,
  });
  t.after(() => agent.close());
  const websockets = new DispatchedWebSocketTransport(agent, hostNodeRandom, scheduler, {});
  t.after(() => websockets.close());

  const session = await websockets.connect(handshake(originPort, ["chat"]), none());
  assert.equal(session.protocol, "chat");
  await session.send({ kind: "text", data: "through the proxy" });
  const echoed = await session.next();
  assert.equal(echoed.kind, "text");
  assert.equal(echoed.data, "through the proxy");
  await session.close(1000, "done");

  assert.deepEqual(proxy.targets, [`127.0.0.1:${originPort}`], "the proxy was asked for the origin");
  assert.equal(origin.messages.length, 1, "and the origin server saw the message");
});

suite("the public WebSocket API works over a dispatched transport", async (t) => {
  const { port } = await websocketServer(t, { protocols: ["chat"] });
  const scheduler = new HostNodeScheduler(() => {});
  const api = createHostNodeWebPlatform({
    webSocketTransport: new DispatchedWebSocketTransport(
      new Http1Transport(new HostNodeSocketConnector(), scheduler, {}),
      hostNodeRandom,
      scheduler,
      {},
    ),
  });
  t.after(() => api.close());

  const socket = api.createWebSocket(`ws://127.0.0.1:${port}/`, ["chat"]);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", () => reject(new Error("handshake refused")));
  });
  assert.equal(socket.protocol, "chat");

  const echoed = new Promise((resolve) => {
    socket.addEventListener("message", (event: Event) => resolve(messageData(event)));
  });
  socket.send("public surface");
  assert.equal(await echoed, "public surface");
  socket.close(1000, "done");
});
