// Protocol switches: `101` upgrades and `CONNECT` tunnels, over a real socket.
//
// The last slice recorded `connect` and `upgrade` as absent because `FetchTransport`
// answered with a response and no way to reach the socket underneath. This is that seam:
// a request may ask for the connection, and a transport that can surrender it does.
//
// A raw socket server rather than Node's HTTP server, because the case that matters is
// a response whose last byte is immediately followed by the tunnelled protocol's first
// -- which is exactly what an HTTP server will not do on request.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createServer } from "node:net";

import {
  AbortController,
  DispatcherOperations,
} from "../src/index.ts";
import { Http1Transport } from "../src/http1/transport.ts";
import {
  HostNodeSocketConnector,
  createHostNodePrimitives,
  hostNodeURLs,
} from "../host/node-primitives.ts";
import type { Socket } from "node:net";
import { causeText, must, portOf } from "./harness.ts";
import type { ByteConnection } from "../src/provider/primitives.ts";
import type {
  FetchTransport,
  TransportRequest,
  TransportResponse,
} from "../src/fetch/transport.ts";
import type { ReadableStream } from "../src/streams/readable.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};
const CRLF = String.fromCharCode(13, 10);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * A server that answers with `responseText` and then echoes whatever else arrives.
 *
 * The echo is what makes a tunnel testable: after the switch the socket is no longer
 * speaking HTTP, and the only way to show the caller really owns it is to use it.
 */
async function rawServer(t: TestContext, responseText: string, seen: string[] = []) {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    let head = "";
    let switched = false;
    socket.on("data", (chunk) => {
      if (switched) {
        socket.write(chunk.toString("latin1").toUpperCase());
        return;
      }
      head += chunk.toString("latin1");
      if (!head.includes(CRLF + CRLF)) return;
      switched = true;
      seen.push(head);
      socket.write(responseText);
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

function makeTransport(t: TestContext): Http1Transport {
  const primitives = createHostNodePrimitives();
  const transport = new Http1Transport(new HostNodeSocketConnector(), primitives.scheduler, {});
  t.after(() => transport.close?.());
  return transport;
}

function transportRequest(url: string, overrides: Partial<TransportRequest> = {}): TransportRequest {
  return {
    url: hostNodeURLs.parse(url),
    method: "GET",
    headers: [],
    body: null,
    bodyLength: null,
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function consume(stream: ReadableStream<Uint8Array> | null) {
  if (stream === null || stream === undefined) return "";
  const reader = stream.getReader();
  const parts = [];
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      parts.push(Buffer.from(item.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts).toString();
}

/** Reads until `count` bytes have arrived, so a test never depends on chunk boundaries. */
async function readExactly(connection: ByteConnection, count: number): Promise<string> {
  const parts: Uint8Array[] = [];
  let total = 0;
  while (total < count) {
    const chunk = await connection.read(65536);
    if (chunk === null) break;
    parts.push(chunk);
    total += chunk.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return decoder.decode(out);
}

const SWITCH = [
  "HTTP/1.1 101 Switching Protocols",
  "Upgrade: raw",
  "Connection: Upgrade",
  "",
  "",
].join(CRLF);

suite("a 101 hands back the connection, and the bytes behind the head are not lost", async (t) => {
  // The trailing text is written in the same packet as the response head, so the head
  // parser reads past the end of the head. Those bytes are the tunnelled protocol's
  // first: read the socket directly instead of the buffer and they are gone.
  const port = await rawServer(t, SWITCH + "already spoken");
  const transport = makeTransport(t);

  const response = await transport.dispatch(
    transportRequest(`http://127.0.0.1:${port}/upgrade`, {
      acceptTunnel: true,
      upgradeProtocol: "raw",
    }),
  );

  assert.equal(response.status, 101);
  assert.equal(response.body, null, "a switch has no body; what follows is not HTTP");
  assert.notEqual(response.connection, undefined);
  assert.equal(await readExactly(must(response.connection, "the tunnel handed a connection over"), 14), "already spoken");
  must(response.connection, "the tunnel handed a connection over").close();
});

suite("the caller can use the connection it was handed", async (t) => {
  const port = await rawServer(t, SWITCH);
  const transport = makeTransport(t);

  const response = await transport.dispatch(
    transportRequest(`http://127.0.0.1:${port}/upgrade`, { acceptTunnel: true }),
  );
  assert.notEqual(response.connection, undefined);

  await must(response.connection, "the tunnel handed a connection over").write(encoder.encode("hello tunnel"));
  assert.equal(await readExactly(must(response.connection, "the tunnel handed a connection over"), 12), "HELLO TUNNEL");
  must(response.connection, "the tunnel handed a connection over").close();
});

suite("the upgrade request actually asks, on the wire", async (t) => {
  const heads: string[] = [];
  const port = await rawServer(t, SWITCH, heads);
  const transport = makeTransport(t);

  // A field the transport reads and never sends would be exactly the kind of inert
  // mechanism this lane keeps finding: the tests above would all still pass.
  const response = await transport.dispatch(
    transportRequest(`http://127.0.0.1:${port}/upgrade`, {
      acceptTunnel: true,
      upgradeProtocol: "websocket",
    }),
  );
  assert.equal(response.status, 101);
  must(response.connection, "the tunnel handed a connection over").close();

  const head = must(heads[0], "the server recorded the request head").toLowerCase();
  assert.ok(head.includes("upgrade: websocket" + CRLF), `no upgrade header in: ${heads[0]}`);
  assert.ok(head.includes("connection: upgrade" + CRLF), `no connection header in: ${heads[0]}`);
});

suite("asking to upgrade without accepting the connection is refused", async (t) => {
  const port = await rawServer(t, SWITCH);
  const transport = makeTransport(t);

  await assert.rejects(
    () =>
      transport.dispatch(
        transportRequest(`http://127.0.0.1:${port}/upgrade`, { upgradeProtocol: "raw" }),
      ),
    TypeError,
  );
});

suite("a protocol that is not a token is refused", async (t) => {
  const port = await rawServer(t, SWITCH);
  const transport = makeTransport(t);

  await assert.rejects(
    () =>
      transport.dispatch(
        transportRequest(`http://127.0.0.1:${port}/upgrade`, {
          acceptTunnel: true,
          upgradeProtocol: "not a token",
        }),
      ),
    TypeError,
  );
});

suite("a server that declines answers normally, body and all", async (t) => {
  const port = await rawServer(
    t,
    ["HTTP/1.1 200 OK", "Content-Length: 21", "", "upgrade not supported"].join(CRLF),
  );
  const transport = makeTransport(t);

  const response = await transport.dispatch(
    transportRequest(`http://127.0.0.1:${port}/upgrade`, { acceptTunnel: true }),
  );
  assert.equal(response.status, 200);
  assert.equal(response.connection, undefined, "nothing switched, so nothing is handed over");
  assert.equal(await consume(response.body), "upgrade not supported");
});

suite("without asking, a 101 is still an error", async (t) => {
  const port = await rawServer(t, SWITCH);
  const transport = makeTransport(t);

  // Fetch never asks, which is why `101` remains an error there.
  await assert.rejects(
    () => transport.dispatch(transportRequest(`http://127.0.0.1:${port}/upgrade`)),
    (error: unknown) => /upgrade/i.test(causeText(error)),
  );
});

suite("a CONNECT answered 2xx is a tunnel", async (t) => {
  const port = await rawServer(t, ["HTTP/1.1 200 Connection Established", "", ""].join(CRLF));
  const transport = makeTransport(t);

  const response = await transport.dispatch(
    transportRequest(`http://127.0.0.1:${port}/`, { method: "CONNECT", acceptTunnel: true }),
  );
  assert.equal(response.status, 200);
  assert.notEqual(response.connection, undefined);
  await must(response.connection, "the tunnel handed a connection over").write(encoder.encode("tunnelled"));
  assert.equal(await readExactly(must(response.connection, "the tunnel handed a connection over"), 9), "TUNNELLED");
  must(response.connection, "the tunnel handed a connection over").close();
});

suite("a CONNECT that is refused is an ordinary response", async (t) => {
  const port = await rawServer(
    t,
    ["HTTP/1.1 403 Forbidden", "Content-Length: 9", "", "no tunnel"].join(CRLF),
  );
  const transport = makeTransport(t);

  const response = await transport.dispatch(
    transportRequest(`http://127.0.0.1:${port}/`, { method: "CONNECT", acceptTunnel: true }),
  );
  assert.equal(response.status, 403);
  assert.equal(response.connection, undefined);
  assert.equal(await consume(response.body), "no tunnel");
});

suite("a tunnelled connection is neither closed nor left occupying a pool slot", async (t) => {
  const port = await rawServer(t, SWITCH);
  const transport = makeTransport(t);

  const first = await transport.dispatch(
    transportRequest(`http://127.0.0.1:${port}/one`, { acceptTunnel: true }),
  );
  assert.notEqual(first.connection, undefined);
  assert.equal(must(first.connection, "the tunnel handed a connection over").closed, false, "detaching must not close it");

  // A second request to the same origin, while the first connection is still held. If
  // the tunnel had been released back to the pool, this would be handed a socket that
  // is no longer speaking HTTP.
  const second = await transport.dispatch(
    transportRequest(`http://127.0.0.1:${port}/two`, { acceptTunnel: true }),
  );
  assert.equal(second.status, 101);
  assert.notEqual(second.connection, undefined);
  assert.notEqual(second.connection, first.connection, "a fresh connection, not the tunnel");

  // And the first is still usable, which a pooled-and-reused socket would not be.
  await must(first.connection, "the tunnel handed a connection over").write(encoder.encode("still mine"));
  assert.equal(await readExactly(must(first.connection, "the tunnel handed a connection over"), 10), "STILL MINE");
  must(first.connection, "the tunnel handed a connection over").close();
  must(second.connection, "the tunnel handed a connection over").close();
});

suite("connect and upgrade report a switch, and report when there was not one", async () => {
  const handed = {
    closed: false,
    read: async () => null,
    write: async () => 0,
    close() {
      this.closed = true;
    },
  };
  const seen: TransportRequest[] = [];
  const switching: FetchTransport = {
    async dispatch(request: TransportRequest): Promise<TransportResponse> {
      seen.push(request);
      return {
        status: request.method === "CONNECT" ? 200 : 101,
        statusText: "Switched",
        headers: [["upgrade", "raw"]],
        body: null,
        connection: handed,
      };
    },
  };
  const operations = new DispatcherOperations(switching);

  const tunnel = await operations.connect(transportRequest("http://ops.test/"));
  assert.equal(tunnel.tunnelled, true);
  assert.equal(tunnel.status, 200);
  assert.equal(tunnel.connection, handed);
  assert.equal(must(seen[0], "the transport saw that many requests").method, "CONNECT", "connect names its own method");
  assert.equal(must(seen[0], "the transport saw that many requests").acceptTunnel, true);

  const upgraded = await operations.upgrade(
    transportRequest("http://ops.test/", { method: "GET" }),
  );
  assert.equal(upgraded.tunnelled, true);
  assert.equal(upgraded.status, 101);
  assert.equal(must(seen[1], "the transport saw that many requests").method, "GET", "upgrade keeps the caller's method");
  assert.equal(must(seen[1], "the transport saw that many requests").acceptTunnel, true);
});

suite("a transport that cannot surrender its socket is reported, not pretended", async () => {
  const plain = {
    async dispatch() {
      return {
        status: 200,
        statusText: "OK",
        headers: [],
        body: null,
      };
    },
  };
  const operations = new DispatcherOperations(plain);

  const outcome = await operations.upgrade(transportRequest("http://ops.test/"));
  assert.equal(outcome.tunnelled, false);
  assert.equal(outcome.response.status, 200);
});
