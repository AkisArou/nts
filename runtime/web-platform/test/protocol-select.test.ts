// The engine is chosen from what TLS actually negotiated, on the connection that was
// already established for it. Nothing reconnects to change engines, and nothing infers
// a protocol from a URL scheme or from request intent.
//
// Host evidence for the shared selection algorithm. It is not compiled-provider
// evidence, and it says nothing about providers that cannot report a selection.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import http2 from "node:http2";
import { createServer as createTlsServer } from "node:tls";
import { connect as tcpConnect, createServer } from "node:net";

import {
  AbortController,
  HttpConnectProxyConnector,
  ProtocolMismatchError,
  ProtocolSelectingTransport,
  Socks5ProxyConnector,
} from "../src/index.ts";
import {
  HostNodeSocketConnector,
  HostNodeTlsUpgrader,
  createHostNodePrimitives,
  hostNodeURLs,
} from "../host/node-primitives.ts";
import { tlsFixture } from "./tls-fixture.ts";
import type { Socket } from "node:net";
import { must, portOf } from "./harness.ts";
import type {
  ConnectAddress,
  SocketConnector,
} from "../src/provider/primitives.ts";
import type { AbortSignal } from "../src/index.ts";
import type { TransportRequest } from "../src/fetch/transport.ts";
import type { ReadableStream } from "../src/streams/readable.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};

async function consume(stream: ReadableStream<Uint8Array> | null) {
  if (stream === null) return "";
  const reader = stream.getReader();
  const parts = [];
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      parts.push(Buffer.from(result.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(parts).toString();
}

function transportRequest(url: string, overrides = {}) {
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

/**
 * Stands in for the shared DNS policy, which is what normally supplies the physical
 * endpoint. The logical hostname stays `target.test` so TLS identity, SNI and the
 * certificate check are still exercised against the name rather than the address.
 */
function resolvingToLoopback(
  base: SocketConnector,
): SocketConnector & { opened: { negotiated: boolean; alpn: readonly string[] | undefined }[] } {
  // Counting here rather than in the server's accept handler is deliberate: the server
  // observes its side of a handshake after the client observes its own, so a count read
  // from the server races and would pass while a second connection was still in flight.
  // What each connect was asked for: which entry point, and the protocols it offered.
  const opened: { negotiated: boolean; alpn: readonly string[] | undefined }[] = [];
  return {
    opened,
    reportsNegotiatedProtocol: base.reportsNegotiatedProtocol,
    connect(address: ConnectAddress, signal: AbortSignal) {
      opened.push({ negotiated: false, alpn: address.alpnProtocols });
      return base.connect({ ...address, resolvedAddress: "127.0.0.1" }, signal);
    },
    connectNegotiated(address: ConnectAddress, signal: AbortSignal) {
      opened.push({ negotiated: true, alpn: address.alpnProtocols });
      const negotiate = base.connectNegotiated;
      assert.ok(negotiate !== undefined, "the wrapped connector negotiates");
      return negotiate.call(base, { ...address, resolvedAddress: "127.0.0.1" }, signal);
    },
  };
}

/** A TLS server that speaks h2 or HTTP/1.1 according to what ALPN selected. */
async function originServer(t: TestContext, alpnProtocols: readonly string[]) {
  const fixture = tlsFixture();
  // `alpnProtocol` is `string | false | null`: false when none was offered, null before the
  // handshake settles.
  const connections: (string | false | null)[] = [];
  const sockets = new Set<Socket>();
  const h2 = http2.createServer();
  h2.on("stream", (stream) => {
    stream.respond({ ":status": 200, "content-type": "text/plain" });
    stream.end("served over h2");
  });
  const server = createTlsServer({ ...fixture, ALPNProtocols: alpnProtocols }, (socket) => {
    connections.push(socket.alpnProtocol);
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    if (socket.alpnProtocol === "h2") {
      h2.emit("connection", socket);
      return;
    }
    socket.on("data", () => {
      socket.write(
        "HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 20\r\n\r\nserved over HTTP/1.1",
      );
    });
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { fixture, port: portOf(server), connections };
}

suite(
  "a server offering h2 selects the HTTP/2 engine on the connection it negotiated",
  async (t) => {
    const { fixture, port, connections } = await originServer(t, ["h2", "http/1.1"]);
    const primitives = createHostNodePrimitives();
    const connector = resolvingToLoopback(
      new HostNodeSocketConnector({ ca: fixture.cert.toString() }),
    );
    const transport = new ProtocolSelectingTransport({
      scheduler: primitives.scheduler,
      connector,
    });
    t.after(() => transport.close());

    const origin = `https://target.test:${port}`;
    assert.equal(transport.protocolFor(origin), null, "nothing is decided before a request");
    const response = await transport.dispatch(transportRequest(`${origin}/a`));
    assert.equal(response.status, 200);
    assert.equal(await consume(response.body), "served over h2");
    assert.equal(transport.protocolFor(origin), "h2");

    // The decisive assertion: one connection, negotiated once, and the engine chosen
    // from its result rather than by reconnecting.
    // The decisive assertion: exactly one connection was opened for this origin, it
    // was the negotiating one, and it offered both protocols. The engine therefore
    // runs on the connection the decision was made on, not on a replacement.
    assert.equal(connector.opened.length, 1);
    const firstOpen = must(connector.opened[0], "the connector opened one connection");
    assert.equal(firstOpen.negotiated, true);
    assert.deepEqual(firstOpen.alpn, ["h2", "http/1.1"]);
    // The server agrees, once it has had the chance to record its side.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.deepEqual(connections, ["h2"]);
  },
);

suite("a server without h2 selects the HTTP/1.1 engine over the same connection", async (t) => {
  const { fixture, port, connections } = await originServer(t, ["http/1.1"]);
  const primitives = createHostNodePrimitives();
  const connector = resolvingToLoopback(
    new HostNodeSocketConnector({ ca: fixture.cert.toString() }),
  );
  const transport = new ProtocolSelectingTransport({
    scheduler: primitives.scheduler,
    connector,
  });
  t.after(() => transport.close());

  const origin = `https://target.test:${port}`;
  const response = await transport.dispatch(transportRequest(`${origin}/a`));
  assert.equal(response.status, 200);
  assert.equal(await consume(response.body), "served over HTTP/1.1");
  assert.equal(transport.protocolFor(origin), "http/1.1");
  assert.equal(connector.opened.length, 1, "one connection decided and served this origin");
  // The server agrees, once it has had the chance to record its side.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(connections, ["http/1.1"]);
});

suite("concurrent first requests to one origin negotiate once, not once each", async (t) => {
  const { fixture, port, connections } = await originServer(t, ["h2", "http/1.1"]);
  const primitives = createHostNodePrimitives();
  const connector = resolvingToLoopback(
    new HostNodeSocketConnector({ ca: fixture.cert.toString() }),
  );
  const transport = new ProtocolSelectingTransport({
    scheduler: primitives.scheduler,
    connector,
  });
  t.after(() => transport.close());

  const origin = `https://target.test:${port}`;
  const responses = await Promise.all([
    transport.dispatch(transportRequest(`${origin}/one`)),
    transport.dispatch(transportRequest(`${origin}/two`)),
    transport.dispatch(transportRequest(`${origin}/three`)),
  ]);
  for (const response of responses) {
    assert.equal(response.status, 200);
    assert.equal(await consume(response.body), "served over h2");
  }
  // h2 multiplexes, so three concurrent requests are one connection and one
  // negotiation -- not three racing selections.
  // h2 multiplexes: three concurrent requests are one connection and one
  // negotiation, not three racing selections.
  assert.equal(connector.opened.length, 1);
  // The server agrees, once it has had the chance to record its side.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(connections, ["h2"]);
  assert.equal(transport.protocolFor(origin), "h2");
});

suite("a cleartext origin is HTTP/1.1 and never guesses prior-knowledge h2", async (t) => {
  const primitives = createHostNodePrimitives();
  let connects = 0;
  const connector = {
    connect(address: ConnectAddress, signal: AbortSignal) {
      connects += 1;
      // Cleartext must not negotiate, so nothing may be offered here.
      assert.equal(address.alpnProtocols, undefined);
      return new HostNodeSocketConnector().connect(address, signal);
    },
  };
  const transport = new ProtocolSelectingTransport({
    scheduler: primitives.scheduler,
    connector,
  });
  t.after(() => transport.close());
  const origin = "http://cleartext.example";
  await transport.dispatch(transportRequest(`${origin}/a`)).catch(() => {});
  assert.equal(transport.protocolFor(origin), "http/1.1");
  assert.equal(connects, 1, "the HTTP/1.1 engine connected without a negotiation");
});

suite("a non-HTTP scheme is refused rather than negotiated", async (t) => {
  const primitives = createHostNodePrimitives();
  const transport = new ProtocolSelectingTransport({
    scheduler: primitives.scheduler,
    connector: new HostNodeSocketConnector(),
  });
  t.after(() => transport.close());
  await assert.rejects(transport.dispatch(transportRequest("ftp://example.test/a")), TypeError);
});

suite("ProtocolMismatchError names both protocols", () => {
  const mismatch = new ProtocolMismatchError("h2", "http/1.1");
  assert.equal(mismatch.name, "ProtocolMismatchError");
  assert.equal(mismatch.expected, "h2");
  assert.equal(mismatch.selected, "http/1.1");
  assert.match(mismatch.message, /http\/1\.1/);
  assert.equal(new ProtocolMismatchError("h2", null).selected, null);
});

/** A real HTTP CONNECT proxy that tunnels to the loopback origin. */
async function connectProxy(t: TestContext, originPort: number) {
  const tunnels: string[] = [];
  const sockets = new Set<Socket>();
  const proxy = createServer((downstream) => {
    sockets.add(downstream);
    downstream.on("error", () => {});
    downstream.on("close", () => sockets.delete(downstream));
    let request = "";
    const readHead = (chunk: Buffer): void => {
      request += chunk.toString("latin1");
      if (!request.includes("\r\n\r\n")) return;
      downstream.off("data", readHead);
      tunnels.push(must(request.split("\r\n")[0], "a CONNECT head begins with a request line"));
      const upstream = tcpConnect({ host: "127.0.0.1", port: originPort });
      upstream.once("connect", () => {
        downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        downstream.pipe(upstream);
        upstream.pipe(downstream);
      });
      upstream.once("error", (error: Error) => downstream.destroy(error));
    };
    downstream.on("data", readHead);
  });
  proxy.listen(0, "127.0.0.1");
  await new Promise((resolve) => proxy.once("listening", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve) => proxy.close(() => resolve()));
  });
  return { port: portOf(proxy), tunnels };
}

/** A real SOCKS5 proxy: no authentication, CONNECT by domain name. */
async function socksProxy(t: TestContext, originPort: number) {
  const targets: string[] = [];
  const sockets = new Set<Socket>();
  const proxy = createServer((downstream) => {
    sockets.add(downstream);
    downstream.on("error", () => {});
    downstream.on("close", () => sockets.delete(downstream));
    let stage = "greeting";
    let buffered = Buffer.alloc(0);
    downstream.on("data", function onData(chunk) {
      buffered = Buffer.concat([buffered, chunk]);
      if (stage === "greeting") {
        if (buffered.length < 2) return;
        // Guarded by the length check above, but read out so the index is checked once.
        const count = buffered[1];
        if (count === undefined || buffered.length < 2 + count) return;
        buffered = buffered.subarray(2 + count);
        stage = "request";
        downstream.write(Buffer.from([5, 0]));
      }
      if (stage === "request") {
        if (buffered.length < 5) return;
        // Guarded by the length check above, but read out so the index is checked once.
        const length = buffered[4];
        if (length === undefined || buffered.length < 7 + length) return;
        const host = buffered.subarray(5, 5 + length).toString("latin1");
        const port = buffered.readUInt16BE(5 + length);
        targets.push(`${host}:${port}`);
        buffered = buffered.subarray(7 + length);
        stage = "tunnel";
        downstream.off("data", onData);
        const upstream = tcpConnect({ host: "127.0.0.1", port: originPort });
        upstream.once("connect", () => {
          downstream.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0]));
          if (buffered.length > 0) upstream.write(buffered);
          downstream.pipe(upstream);
          upstream.pipe(downstream);
        });
        upstream.once("error", (error: Error) => downstream.destroy(error));
      }
    });
  });
  proxy.listen(0, "127.0.0.1");
  await new Promise((resolve) => proxy.once("listening", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve) => proxy.close(() => resolve()));
  });
  return { port: portOf(proxy), targets };
}

suite("selection works through an HTTP CONNECT tunnel", async (t) => {
  const { fixture, port, connections } = await originServer(t, ["h2", "http/1.1"]);
  const proxy = await connectProxy(t, port);
  const primitives = createHostNodePrimitives();
  const tls = new HostNodeTlsUpgrader({ ca: fixture.cert.toString() });
  const connector = new HttpConnectProxyConnector({
    connector: new HostNodeSocketConnector(),
    tls,
    scheduler: primitives.scheduler,
    urls: hostNodeURLs,
    uri: `http://127.0.0.1:${proxy.port}`,
  });
  // The tunnel negotiates through its TLS upgrader, so it inherits that capability.
  assert.equal(connector.reportsNegotiatedProtocol, true);
  const transport = new ProtocolSelectingTransport({
    scheduler: primitives.scheduler,
    connector,
  });
  t.after(() => transport.close());

  const origin = `https://target.test:${port}`;
  const response = await transport.dispatch(transportRequest(`${origin}/a`));
  assert.equal(response.status, 200);
  assert.equal(await consume(response.body), "served over h2");
  assert.equal(transport.protocolFor(origin), "h2");
  // One tunnel, named by the logical target rather than the proxy or an address.
  assert.deepEqual(proxy.tunnels, [`CONNECT target.test:${port} HTTP/1.1`]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(connections, ["h2"]);
});

suite("selection works through a SOCKS5 tunnel", async (t) => {
  const { fixture, port, connections } = await originServer(t, ["h2", "http/1.1"]);
  const proxy = await socksProxy(t, port);
  const primitives = createHostNodePrimitives();
  const connector = new Socks5ProxyConnector({
    connector: new HostNodeSocketConnector(),
    tls: new HostNodeTlsUpgrader({ ca: fixture.cert.toString() }),
    scheduler: primitives.scheduler,
    urls: hostNodeURLs,
    uri: `socks5://127.0.0.1:${proxy.port}`,
  });
  assert.equal(connector.reportsNegotiatedProtocol, true);
  const transport = new ProtocolSelectingTransport({
    scheduler: primitives.scheduler,
    connector,
  });
  t.after(() => transport.close());

  const origin = `https://target.test:${port}`;
  const response = await transport.dispatch(transportRequest(`${origin}/a`));
  assert.equal(response.status, 200);
  assert.equal(await consume(response.body), "served over h2");
  assert.equal(transport.protocolFor(origin), "h2");
  // Proxy-side DNS: the target name crosses the wire and is never resolved locally.
  assert.deepEqual(proxy.targets, [`target.test:${port}`]);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(connections, ["h2"]);
});

suite("a tunnel whose TLS cannot report is not offered a choice", async (t) => {
  const { fixture, port, connections } = await originServer(t, ["h2", "http/1.1"]);
  const proxy = await connectProxy(t, port);
  const primitives = createHostNodePrimitives();
  const connector = new HttpConnectProxyConnector({
    connector: new HostNodeSocketConnector(),
    tls: new HostNodeTlsUpgrader({
      ca: fixture.cert.toString(),
      reportsNegotiatedProtocol: false,
    }),
    scheduler: primitives.scheduler,
    urls: hostNodeURLs,
    uri: `http://127.0.0.1:${proxy.port}`,
  });
  const transport = new ProtocolSelectingTransport({
    scheduler: primitives.scheduler,
    connector,
  });
  t.after(() => transport.close());

  // The behavioural assertions come first deliberately, so that overstating the
  // capability fails as a wrong protocol rather than as a wrong boolean.
  const origin = `https://target.test:${port}`;
  const response = await transport.dispatch(transportRequest(`${origin}/a`));
  assert.equal(await consume(response.body), "served over HTTP/1.1");
  assert.equal(transport.protocolFor(origin), "http/1.1");
  // The contract holds through a proxy: this server prefers h2 and would have
  // selected it, so being unable to report must mean it was never asked.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(connections, ["http/1.1"]);
  assert.equal(connector.reportsNegotiatedProtocol, false);
});
