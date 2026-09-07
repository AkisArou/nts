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

import {
  AbortController,
  DispatchedWebSocketTransport,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import { Http1Transport } from "../node_modules/.tsbuild/host/runtime/web-platform/src/http1/transport.js";
import {
  HostNodeSocketConnector,
  HostNodeScheduler,
  hostNodeRandom,
  hostNodeURLs,
} from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-primitives.js";
import { createServer } from "node:net";

import { websocketServer } from "./websocket-echo-server.mjs";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const none = () => new AbortController().signal;

function transportOf(t, fetchTransport) {
  const scheduler = new HostNodeScheduler(() => {});
  const transport =
    fetchTransport ?? new Http1Transport(new HostNodeSocketConnector(), scheduler, {});
  const websockets = new DispatchedWebSocketTransport(transport, hostNodeRandom, scheduler, {});
  t.after(() => websockets.close());
  return websockets;
}

function handshake(port, protocols = []) {
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
async function decliningServer(t) {
  const CRLF = String.fromCharCode(13, 10);
  const sockets = new Set();
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
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  return server.address().port;
}

suite("a real server that declines is reported, not mistaken for a socket", async (t) => {
  // Through the real HTTP transport, so this is the whole path: the server answers with
  // a status instead of switching, and a WebSocket that treated that as connected would
  // read the refusal's body as frames.
  const port = await decliningServer(t);
  const websockets = transportOf(t);

  await assert.rejects(
    () => websockets.connect(handshake(port, []), none()),
    (error) => /did not yield a connection \(status 426\)/.test(String(error?.message)),
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
    (error) => /did not yield a connection/.test(String(error?.message)),
  );
});

suite("a bad Sec-WebSocket-Accept closes the connection it was handed", async (t) => {
  let handed = null;
  const lying = {
    async dispatch(request) {
      assert.equal(request.acceptTunnel, true);
      assert.equal(request.upgradeProtocol, "websocket");
      handed = {
        closed: false,
        read: async () => null,
        write: async () => 0,
        close() {
          this.closed = true;
        },
      };
      return {
        status: 101,
        statusText: "Switching Protocols",
        headers: [
          ["upgrade", "websocket"],
          ["connection", "upgrade"],
          ["sec-websocket-accept", "obviously-wrong"],
        ],
        body: null,
        connection: handed,
      };
    },
  };
  const websockets = transportOf(t, lying);

  await assert.rejects(() => websockets.connect(handshake(1, []), none()));
  // The connection became ours the moment it was handed over; nothing else will close it.
  assert.equal(handed.closed, true);
});

suite("the handshake headers the server needs are the ones sent", async (t) => {
  let sent = null;
  const capturing = {
    async dispatch(request) {
      sent = request;
      return { status: 200, statusText: "OK", headers: [], body: null };
    },
  };
  const websockets = transportOf(t, capturing);
  await assert.rejects(() => websockets.connect(handshake(1, ["a", "b"]), none()));

  const names = new Map(sent.headers.map(([name, value]) => [name, value]));
  assert.equal(names.get("sec-websocket-version"), "13");
  assert.equal(names.get("sec-websocket-protocol"), "a, b");
  assert.equal(names.get("origin"), "http://127.0.0.1");
  assert.ok(/^[A-Za-z0-9+/]{22}==$/.test(names.get("sec-websocket-key") ?? ""), "a 16-byte key");
  // Framing headers stay the transport's: the protocol is named by the field.
  assert.equal(names.has("connection"), false);
  assert.equal(names.has("upgrade"), false);
  assert.equal(sent.upgradeProtocol, "websocket");
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
