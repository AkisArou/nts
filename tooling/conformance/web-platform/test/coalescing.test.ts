// @ts-nocheck -- converted from `.mjs` and not yet typed.
//
// This file was JavaScript until the suite moved to running TypeScript source directly,
// and it was never type-checked. The pragma says so out loud rather than leaving the
// `.ts` extension to imply a guarantee that does not hold. Removing it is a per-file
// job: `grep -lc "@ts-nocheck" test/*.ts` is the remaining list.
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

import {
  AbortController,
  DnsCache,
} from "../../../../runtime/web-platform/src/index.ts";
import {
  certificateCovers,
  dnsNameCovers,
} from "../../../../runtime/web-platform/src/provider.ts";
import { Http2Transport } from "../../../../runtime/web-platform/src/http2/transport.ts";
import {
  HostNodeSocketConnector,
  createHostNodePrimitives,
  hostNodeURLs,
} from "../node-primitives.ts";
import { tlsFixtureFor } from "./tls-fixture.ts";

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
  const endpointsFor = () => ["127.0.0.1"];
  const { fixture, port } = await h2Origin(t);
  const primitives = createHostNodePrimitives();
  const connector = resolvingConnector(
    new HostNodeSocketConnector({ ca: fixture.cert.toString() }),
  );
  const transport = new Http2Transport(connector, primitives.scheduler, {
    coalesceConnections: true,
    knownEndpoints: (address) => endpointsFor(address),
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
  const endpointsFor = () => ["127.0.0.1"];
  const { fixture, port } = await h2Origin(t);
  const primitives = createHostNodePrimitives();
  const connector = resolvingConnector(
    new HostNodeSocketConnector({ ca: fixture.cert.toString() }),
  );
  const transport = new Http2Transport(connector, primitives.scheduler, {
    coalesceConnections: true,
    knownEndpoints: (address) => endpointsFor(address),
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
      return base.connect({ ...address, resolvedAddress: endpointsFor(address)[0] }, signal);
    },
    connectNegotiated(address, signal) {
      opened.push(address.hostname);
      return base.connectNegotiated(
        { ...address, resolvedAddress: endpointsFor(address)[0] },
        signal,
      );
    },
  };
  function endpointsFor(address) {
    return address.hostname === "alpha.test" ? ["127.0.0.1"] : ["127.0.0.2"];
  }
  const transport = new Http2Transport(connector, primitives.scheduler, {
    coalesceConnections: true,
    knownEndpoints: (address) => endpointsFor(address),
  });
  t.after(() => transport.close());

  await consume((await transport.dispatch(transportRequest(`https://alpha.test:${port}/a`))).body);
  // 127.0.0.2 has no listener here, so a refused connection is the proof that beta was
  // not silently answered over alpha's.
  await assert.rejects(transport.dispatch(transportRequest(`https://beta.test:${port}/b`)));
  assert.deepEqual(opened, ["alpha.test", "beta.test"]);
});

suite("a connection with no known endpoint does not coalesce", async (t) => {
  const endpointsFor = () => undefined;
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
    knownEndpoints: (address) => endpointsFor(address),
  });
  t.after(() => transport.close());
  await assert.rejects(transport.dispatch(transportRequest(`https://alpha.test:${port}/a`)));
  assert.deepEqual(opened, ["alpha.test"]);
});

suite("the live endpoint may be any of the ones the origin is known to reach", async (t) => {
  const { fixture, port } = await h2Origin(t);
  const primitives = createHostNodePrimitives();
  const connector = resolvingConnector(
    new HostNodeSocketConnector({ ca: fixture.cert.toString() }),
  );
  const transport = new Http2Transport(connector, primitives.scheduler, {
    coalesceConnections: true,
    // beta is known to reach two addresses and the live connection is on the second.
    // Asking which endpoint a fresh lookup would pick would answer 127.0.0.9 and miss
    // a connection that legitimately serves this origin.
    knownEndpoints: (address) =>
      address.hostname === "alpha.test" ? ["127.0.0.1"] : ["127.0.0.9", "127.0.0.1"],
  });
  t.after(() => transport.close());

  await consume((await transport.dispatch(transportRequest(`https://alpha.test:${port}/a`))).body);
  const second = await transport.dispatch(transportRequest(`https://beta.test:${port}/b`));
  assert.equal(await consume(second.body), `beta.test:${port}`);
  assert.deepEqual(connector.opened, ["alpha.test"]);
  assert.equal(transport.stats.connections, 1);
});

suite("the shared DNS cache answers the probe without resolving or rotating", async (t) => {
  let resolverCalls = 0;
  const cache = new DnsCache({
    resolver: {
      resolve() {
        resolverCalls += 1;
        return Promise.resolve([
          { address: "127.0.0.1", family: 4, ttlMilliseconds: 60_000 },
          { address: "127.0.0.9", family: 4, ttlMilliseconds: 60_000 },
        ]);
      },
    },
    nowMilliseconds: () => 0,
  });

  // Nothing is known before a lookup, and probing must not cause one.
  assert.deepEqual(cache.knownAddresses("alpha.test"), []);
  assert.equal(resolverCalls, 0);

  const signal = new AbortController().signal;
  const first = await cache.lookup("alpha.test", [4], signal);
  assert.deepEqual(
    first.map((entry) => entry.address),
    ["127.0.0.1", "127.0.0.9"],
  );
  assert.equal(resolverCalls, 1);

  // The probe answers both addresses and repeating it resolves nothing.
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.deepEqual(cache.knownAddresses("alpha.test"), ["127.0.0.1", "127.0.0.9"]);
  }
  assert.equal(resolverCalls, 1, "the probe never resolves");

  // Whatever the rotation rule is, probing must not advance it. A control cache that
  // was never probed answers the comparison, so this asserts "the probe changed
  // nothing" rather than a hardcoded order.
  const control = new DnsCache({
    resolver: {
      resolve() {
        return Promise.resolve([
          { address: "127.0.0.1", family: 4, ttlMilliseconds: 60_000 },
          { address: "127.0.0.9", family: 4, ttlMilliseconds: 60_000 },
        ]);
      },
    },
    nowMilliseconds: () => 0,
  });
  const controlFirst = await control.lookup("alpha.test", [4], signal);
  assert.deepEqual(
    controlFirst.map((entry) => entry.address),
    first.map((entry) => entry.address),
  );
  const second = await cache.lookup("alpha.test", [4], signal);
  const controlSecond = await control.lookup("alpha.test", [4], signal);
  assert.deepEqual(
    second.map((entry) => entry.address),
    controlSecond.map((entry) => entry.address),
    "three probes must leave the next lookup exactly where it would have been",
  );
  assert.equal(resolverCalls, 1);

  // Family filtering and unknown hosts.
  assert.deepEqual(cache.knownAddresses("alpha.test", [6]), []);
  assert.deepEqual(cache.knownAddresses("unknown.test"), []);
  assert.deepEqual(cache.knownAddresses(""), []);
});

suite("a transport can take its probe straight from the shared DNS cache", async (t) => {
  const { fixture, port } = await h2Origin(t);
  const primitives = createHostNodePrimitives();
  const cache = new DnsCache({
    resolver: {
      resolve() {
        return Promise.resolve([{ address: "127.0.0.1", family: 4, ttlMilliseconds: 60_000 }]);
      },
    },
    nowMilliseconds: () => 0,
  });
  const signal = new AbortController().signal;
  await cache.lookup("alpha.test", [4], signal);
  await cache.lookup("beta.test", [4], signal);

  const connector = resolvingConnector(
    new HostNodeSocketConnector({ ca: fixture.cert.toString() }),
  );
  const transport = new Http2Transport(connector, primitives.scheduler, {
    coalesceConnections: true,
    knownEndpoints: (address) => {
      const known = cache.knownAddresses(address.hostname);
      return known.length === 0 ? undefined : known;
    },
  });
  t.after(() => transport.close());

  await consume((await transport.dispatch(transportRequest(`https://alpha.test:${port}/a`))).body);
  const second = await transport.dispatch(transportRequest(`https://beta.test:${port}/b`));
  assert.equal(await consume(second.body), `beta.test:${port}`);
  assert.deepEqual(connector.opened, ["alpha.test"]);
});
