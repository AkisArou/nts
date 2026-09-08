// Shared policy cannot select an HTTP engine over a connection whose ALPN result it
// never learns. These tests cover the connect/upgrade result that reports it, and the
// contract that makes an absent report unambiguous: a provider that cannot report the
// selection is never offered a choice.
//
// Host evidence for the shared contract. It is not evidence that any real provider
// can report a selection; Android below API 29 cannot, which is why the contract
// exists.
import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { connect as tcpConnect, createServer } from "node:net";
import { createServer as createTlsServer } from "node:tls";

import {
  AbortController,
  HttpConnectProxyConnector,
} from "../../../../runtime/web-platform/src/index.ts";
// The negotiation contract is provider boundary, not public Web API, so it lives on
// the provider entry point that platform providers import.
import {
  connectNegotiated,
  isNegotiatingSocketConnector,
  isNegotiatingTlsUpgrader,
  offeredProtocols,
  offeredUpgradeProtocols,
  upgradeNegotiated,
} from "../../../../runtime/web-platform/src/provider.ts";
import {
  HostNodeSocketConnector,
  HostNodeTlsUpgrader,
  hostNodeURLs,
} from "../node-primitives.ts";
import { tlsFixture } from "./tls-fixture.ts";
import type { TLSSocket } from "node:tls";
import { portOf } from "./harness.ts";
import type { TlsFixture } from "./tls-fixture.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};
const scheduler = {
  enqueue(task: () => void) {
    queueMicrotask(task);
  },
  delay() {
    return { cancel() {} };
  },
  reportError(error: unknown) {
    throw error;
  },
};

const bothProtocols = { ordered: ["h2", "http/1.1"], whenUnreportable: "http/1.1" };

/** A connector from before this ABI: it reports nothing and declares nothing. */
const plainConnector = {
  connect() {
    return Promise.resolve({
      closed: false,
      read: async () => null,
      write: async (data: Uint8Array) => data.length,
      close() {},
    });
  },
};

suite("only a connector that reports a selection may be offered a choice", () => {
  const reporting = new HostNodeSocketConnector();
  const silent = new HostNodeSocketConnector({ reportsNegotiatedProtocol: false });

  assert.equal(isNegotiatingSocketConnector(reporting), true);
  assert.equal(isNegotiatingSocketConnector(silent), true);
  assert.equal(isNegotiatingSocketConnector(plainConnector), false);

  assert.deepEqual(offeredProtocols(reporting, bothProtocols), ["h2", "http/1.1"]);
  // The decisive case: negotiation would happen and the answer would be lost, so the
  // question is not asked.
  assert.deepEqual(offeredProtocols(silent, bothProtocols), ["http/1.1"]);
  assert.deepEqual(offeredProtocols(plainConnector, bothProtocols), ["http/1.1"]);

  // The single protocol is named, not taken from a position: the safe one is the most
  // compatible, which is the last entry here rather than the preferred first.
  assert.notDeepEqual(offeredProtocols(silent, bothProtocols), ["h2"]);

  const upgrading = new HostNodeTlsUpgrader();
  const silentUpgrader = new HostNodeTlsUpgrader({ reportsNegotiatedProtocol: false });
  assert.equal(isNegotiatingTlsUpgrader(upgrading), true);
  assert.deepEqual(offeredUpgradeProtocols(upgrading, bothProtocols), ["h2", "http/1.1"]);
  assert.deepEqual(offeredUpgradeProtocols(silentUpgrader, bothProtocols), ["http/1.1"]);
});

suite("a malformed protocol preference is refused rather than silently narrowed", () => {
  const reporting = new HostNodeSocketConnector();
  assert.throws(
    () => offeredProtocols(reporting, { ordered: [], whenUnreportable: "http/1.1" }),
    TypeError,
  );
  assert.throws(
    () => offeredProtocols(reporting, { ordered: ["h2"], whenUnreportable: "http/1.1" }),
    TypeError,
  );
  assert.throws(
    () =>
      offeredUpgradeProtocols(new HostNodeTlsUpgrader(), { ordered: [], whenUnreportable: "x" }),
    TypeError,
  );
});

suite("a connector from before this ABI still describes its result", async () => {
  const result = await connectNegotiated(
    plainConnector,
    { hostname: "example.test", port: 80, secure: false, connectTimeoutMs: 2000 },
    new AbortController().signal,
  );
  assert.equal(result.protocol, null);
  assert.deepEqual(result.certificateNames, []);
  assert.equal(typeof result.connection.close, "function");
  result.connection.close();
});

async function tlsOrigin(t: TestContext, alpnProtocols: readonly string[]): Promise<{
  fixture: TlsFixture;
  port: number;
  selected: (string | false | null)[];
  firstSelection: Promise<string | false | null>;
}> {
  const fixture = tlsFixture();
  // The server records what it actually selected, so a test can compare what the peer
  // chose against what shared policy was told -- which is the pair that matters.
  // `alpnProtocol` is `string | false | null`: false when the peer offered none, null before
  // the handshake settles.
  const selected: (string | false | null)[] = [];
  const sockets = new Set<TLSSocket>();
  // The server observes its side of the handshake after the client observes its own,
  // so a test that wants to compare the two must wait for this rather than read a
  // list that is still empty.
  let observeFirst: (value: string | false | null) => void = () => {};
  const firstSelection = new Promise<string | false | null>((resolve) => {
    observeFirst = resolve;
  });
  const server = createTlsServer({ ...fixture, ALPNProtocols: alpnProtocols }, (socket) => {
    selected.push(socket.alpnProtocol);
    observeFirst(socket.alpnProtocol);
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
    socket.once("data", () => socket.end("HTTP/1.1 204 ok\r\nConnection: close\r\n\r\n"));
  });
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  // Destroy rather than wait: a failed assertion must surface as a failure, not as a
  // close() that never resolves because the test never reached its own cleanup.
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return { fixture, port: portOf(server), selected, firstSelection };
}

suite("a direct TLS connect reports the selected protocol and the dNSName SANs", async (t) => {
  const { fixture, port } = await tlsOrigin(t, ["h2", "http/1.1"]);
  const connector = new HostNodeSocketConnector({ ca: fixture.cert.toString() });
  const result = await connectNegotiated(
    connector,
    {
      hostname: "target.test",
      port,
      secure: true,
      connectTimeoutMs: 2000,
      alpnProtocols: offeredProtocols(connector, bothProtocols),
      resolvedAddress: "127.0.0.1",
    },
    new AbortController().signal,
  );
  assert.equal(result.protocol, "h2", "the server prefers h2 and the client must be told");
  // The fixture presents `IP Address:127.0.0.1, DNS:target.test`; only dNSNames are
  // reported, because only they can justify reusing this connection for an origin.
  assert.deepEqual(result.certificateNames, ["target.test"]);
  result.connection.close();
});

suite("a server without h2 selects the compatible protocol and says so", async (t) => {
  const { fixture, port } = await tlsOrigin(t, ["http/1.1"]);
  const connector = new HostNodeSocketConnector({ ca: fixture.cert.toString() });
  const result = await connectNegotiated(
    connector,
    {
      hostname: "target.test",
      port,
      secure: true,
      connectTimeoutMs: 2000,
      alpnProtocols: offeredProtocols(connector, bothProtocols),
      resolvedAddress: "127.0.0.1",
    },
    new AbortController().signal,
  );
  assert.equal(result.protocol, "http/1.1");
  result.connection.close();
});

suite("a provider that cannot report is offered one protocol and reports none", async (t) => {
  const { fixture, port, firstSelection } = await tlsOrigin(t, ["h2", "http/1.1"]);
  const connector = new HostNodeSocketConnector({
    ca: fixture.cert.toString(),
    reportsNegotiatedProtocol: false,
  });
  const offered = offeredProtocols(connector, bothProtocols);
  assert.deepEqual(offered, ["http/1.1"]);
  const result = await connectNegotiated(
    connector,
    {
      hostname: "target.test",
      port,
      secure: true,
      connectTimeoutMs: 2000,
      alpnProtocols: offered,
      resolvedAddress: "127.0.0.1",
    },
    new AbortController().signal,
  );
  try {
    // Null here is safe precisely because only one protocol was ever on the table: the
    // server could not have chosen h2. Without the contract this same null would be
    // indistinguishable from a lost h2 selection.
    assert.equal(result.protocol, null);
    // The assertion that observes the danger rather than the helper. This server
    // prefers h2 and would have selected it if asked; being unable to report must mean
    // it was never asked, or shared policy would speak HTTP/1.1 into an h2 connection.
    assert.equal(await firstSelection, "http/1.1");
  } finally {
    result.connection.close();
  }
});

suite("proxied TLS reports its negotiation through the same contract", async (t) => {
  const { fixture, port } = await tlsOrigin(t, ["h2", "http/1.1"]);
  const proxy = createServer((downstream) => {
    let request = "";
    const readHead = (chunk: Buffer): void => {
      request += decoder.decode(chunk);
      if (!request.includes("\r\n\r\n")) return;
      downstream.off("data", readHead);
      assert.match(request, new RegExp(`^CONNECT target\\.test:${port} HTTP/1\\.1`));
      const upstream = tcpConnect({ host: "127.0.0.1", port });
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
  await new Promise<void>((resolve) => proxy.once("listening", () => resolve()));
  const proxyPort = portOf(proxy);
  t.after(() => new Promise<void>((resolve) => proxy.close(() => resolve())));

  // The tunnel itself is cleartext to the proxy; the negotiation that matters happens
  // in the TLS upgrade to the logical target on the far side of it.
  const tunnel = new HttpConnectProxyConnector({
    connector: new HostNodeSocketConnector(),
    tls: new HostNodeTlsUpgrader({ ca: fixture.cert.toString() }),
    scheduler,
    urls: hostNodeURLs,
    uri: `http://127.0.0.1:${proxyPort}`,
  });
  const upgrader = new HostNodeTlsUpgrader({ ca: fixture.cert.toString() });
  const target = {
    hostname: "target.test",
    port,
    secure: false,
    connectTimeoutMs: 2000,
  };
  const plain = await tunnel.connect(target, new AbortController().signal);
  const result = await upgradeNegotiated(
    upgrader,
    plain,
    {
      ...target,
      secure: true,
      alpnProtocols: offeredUpgradeProtocols(upgrader, bothProtocols),
    },
    new AbortController().signal,
  );
  assert.equal(result.protocol, "h2", "a tunnelled TLS session negotiates like a direct one");
  assert.deepEqual(result.certificateNames, ["target.test"]);
  await result.connection.write(encoder.encode("GET / HTTP/1.1\r\nHost: target.test\r\n\r\n"));
  assert.match(decoder.decode(await result.connection.read(65536)), /^HTTP\/1\.1 204/);
  result.connection.close();
});
