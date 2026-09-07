// Reusing one HTTP/2 connection for a second origin is sound only when the peer's
// certificate covers that origin and the endpoint is the same one. Getting this wrong
// is a cross-origin routing defect rather than a slow path, so the conditions are
// tested individually and the certificate check has its own sabotage.
//
// Host evidence for the shared decision. It is not evidence about any provider's own
// connection management.
import assert from "node:assert/strict";
import test from "node:test";
import http2 from "node:http2";
import { createServer as createTlsServer } from "node:tls";

import { AbortController } from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import {
  certificateCovers,
  dnsNameCovers,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/provider.js";
import { Http2Transport } from "../node_modules/.tsbuild/host/runtime/web-platform/src/http2/transport.js";
import {
  HostNodeSocketConnector,
  createHostNodePrimitives,
  hostNodeURLs,
} from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-primitives.js";
import { tlsFixtureFor } from "./tls-fixture.mjs";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);

async function consume(stream) {
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

function transportRequest(url) {
  return {
    url: hostNodeURLs.parse(url),
    method: "GET",
    headers: [],
    body: null,
    bodyLength: null,
    signal: new AbortController().signal,
  };
}

suite("a dNSName covers exactly what it says and no more", () => {
  assert.equal(dnsNameCovers("example.test", "example.test"), true);
  assert.equal(dnsNameCovers("EXAMPLE.test", "example.TEST"), true, "names are case-folded");
  assert.equal(
    dnsNameCovers("example.test.", "example.test"),
    true,
    "a root label is the same name",
  );
  assert.equal(dnsNameCovers("example.test", "other.test"), false);
  assert.equal(dnsNameCovers("", "example.test"), false);

  assert.equal(dnsNameCovers("*.example.test", "a.example.test"), true);
  assert.equal(dnsNameCovers("*.example.test", "example.test"), false, "a wildcard needs a label");
  assert.equal(dnsNameCovers("*.example.test", "a.b.example.test"), false, "one label, not many");
  assert.equal(dnsNameCovers("*.example.test", ".example.test"), false, "never an empty label");
  assert.equal(dnsNameCovers("*.test", "example.test"), false, "a registry-wide wildcard");
  assert.equal(dnsNameCovers("f*.example.test", "foo.example.test"), false, "no partial labels");
  assert.equal(dnsNameCovers("*", "example.test"), false);
  assert.equal(dnsNameCovers("*.*.test", "a.b.test"), false);

  assert.equal(certificateCovers(["a.test", "*.b.test"], "x.b.test"), true);
  assert.equal(certificateCovers(["a.test", "*.b.test"], "x.c.test"), false);
  assert.equal(certificateCovers([], "a.test"), false, "cleartext covers nothing");
});

/** One h2 origin whose certificate covers alpha and beta but not gamma. */
async function h2Origin(t) {
  const fixture = tlsFixtureFor(["IP:127.0.0.1", "DNS:alpha.test", "DNS:beta.test"]);
  const sockets = new Set();
  const h2 = http2.createServer();
  h2.on("stream", (stream, headers) => {
    stream.respond({ ":status": 200, "content-type": "text/plain" });
    stream.end(String(headers[":authority"]));
  });
  const server = createTlsServer({ ...fixture, ALPNProtocols: ["h2"] }, (socket) => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    h2.emit("connection", socket);
  });
  server.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise((resolve) => server.close(resolve));
  });
  return { fixture, port: server.address().port };
}

/** Counts connects and supplies the endpoint the shared DNS policy would have. */
function resolvingConnector(base, resolvedAddress = "127.0.0.1") {
  const opened = [];
  return {
    opened,
    reportsNegotiatedProtocol: true,
    connect(address, signal) {
      opened.push(address.hostname);
      return base.connect({ ...address, resolvedAddress }, signal);
    },
    connectNegotiated(address, signal) {
      opened.push(address.hostname);
      return base.connectNegotiated({ ...address, resolvedAddress }, signal);
    },
  };
}

suite("a covered origin on the same endpoint reuses the connection", async (t) => {
  const endpointFor = () => "127.0.0.1";
  const { fixture, port } = await h2Origin(t);
  const primitives = createHostNodePrimitives();
  const connector = resolvingConnector(
    new HostNodeSocketConnector({ ca: fixture.cert.toString() }),
  );
  const transport = new Http2Transport(connector, primitives.scheduler, {
    coalesceConnections: true,
    knownEndpoint: (address) => endpointFor(address),
  });
  t.after(() => transport.close());

  const first = await transport.dispatch(transportRequest(`https://alpha.test:${port}/a`));
  assert.equal(await consume(first.body), `alpha.test:${port}`);
  const second = await transport.dispatch(transportRequest(`https://beta.test:${port}/b`));
  // The second origin is served over the first connection, and its own authority is
  // still what reaches the server.
  assert.equal(await consume(second.body), `beta.test:${port}`);
  assert.deepEqual(connector.opened, ["alpha.test"], "beta must not open a connection");
  assert.equal(transport.stats.connections, 1);
});

suite("coalescing is off unless it is asked for", async (t) => {
  const { fixture, port } = await h2Origin(t);
  const primitives = createHostNodePrimitives();
  const connector = resolvingConnector(
    new HostNodeSocketConnector({ ca: fixture.cert.toString() }),
  );
  const transport = new Http2Transport(connector, primitives.scheduler);
  t.after(() => transport.close());

  await consume((await transport.dispatch(transportRequest(`https://alpha.test:${port}/a`))).body);
  await consume((await transport.dispatch(transportRequest(`https://beta.test:${port}/b`))).body);
  assert.deepEqual(connector.opened, ["alpha.test", "beta.test"]);
  assert.equal(transport.stats.connections, 2);
});

suite("an origin the certificate does not cover is never routed over the connection", async (t) => {
  const endpointFor = () => "127.0.0.1";
  const { fixture, port } = await h2Origin(t);
  const primitives = createHostNodePrimitives();
  const connector = resolvingConnector(
    new HostNodeSocketConnector({ ca: fixture.cert.toString() }),
  );
  const transport = new Http2Transport(connector, primitives.scheduler, {
    coalesceConnections: true,
    knownEndpoint: (address) => endpointFor(address),
  });
  t.after(() => transport.close());

  await consume((await transport.dispatch(transportRequest(`https://alpha.test:${port}/a`))).body);
  // gamma.test resolves to the same endpoint and the connection is live, so every
  // condition except certificate coverage is met. It must open its own connection and
  // fail identity verification there, rather than being answered by a server that does
  // not speak for it.
  await assert.rejects(
    transport.dispatch(transportRequest(`https://gamma.test:${port}/c`)),
    (error) => /gamma\.test|altnames|certificate/i.test(String(error) + String(error?.cause)),
  );
  assert.deepEqual(connector.opened, ["alpha.test", "gamma.test"]);
});

suite("a different endpoint is a different peer even under one certificate", async (t) => {
  const { fixture, port } = await h2Origin(t);
  const primitives = createHostNodePrimitives();
  const base = new HostNodeSocketConnector({ ca: fixture.cert.toString() });
  const opened = [];
  // alpha resolves to the loopback address; beta claims a different endpoint, so the
  // certificate covering both is not on its own a reason to reuse the connection.
  const connector = {
    reportsNegotiatedProtocol: true,
    connect(address, signal) {
      opened.push(address.hostname);
      return base.connect({ ...address, resolvedAddress: endpointFor(address) }, signal);
    },
    connectNegotiated(address, signal) {
      opened.push(address.hostname);
      return base.connectNegotiated({ ...address, resolvedAddress: endpointFor(address) }, signal);
    },
  };
  function endpointFor(address) {
    return address.hostname === "alpha.test" ? "127.0.0.1" : "127.0.0.2";
  }
  const transport = new Http2Transport(connector, primitives.scheduler, {
    coalesceConnections: true,
    knownEndpoint: (address) => endpointFor(address),
  });
  t.after(() => transport.close());

  await consume((await transport.dispatch(transportRequest(`https://alpha.test:${port}/a`))).body);
  // 127.0.0.2 has no listener here, so a refused connection is the proof that beta was
  // not silently answered over alpha's.
  await assert.rejects(transport.dispatch(transportRequest(`https://beta.test:${port}/b`)));
  assert.deepEqual(opened, ["alpha.test", "beta.test"]);
});

suite("a connection with no known endpoint does not coalesce", async (t) => {
  const endpointFor = () => undefined;
  const { fixture, port } = await h2Origin(t);
  const primitives = createHostNodePrimitives();
  // No resolvedAddress at all: certificate coverage alone must not be enough.
  const base = new HostNodeSocketConnector({ ca: fixture.cert.toString() });
  const opened = [];
  const connector = {
    reportsNegotiatedProtocol: true,
    connect(address, signal) {
      opened.push(address.hostname);
      return base.connect(address, signal);
    },
    connectNegotiated(address, signal) {
      opened.push(address.hostname);
      return base.connectNegotiated(address, signal);
    },
  };
  const transport = new Http2Transport(connector, primitives.scheduler, {
    coalesceConnections: true,
    knownEndpoint: (address) => endpointFor(address),
  });
  t.after(() => transport.close());
  await assert.rejects(transport.dispatch(transportRequest(`https://alpha.test:${port}/a`)));
  assert.deepEqual(opened, ["alpha.test"]);
});
