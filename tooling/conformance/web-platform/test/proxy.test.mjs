import test from "node:test";
import assert from "node:assert/strict";
import { connect as tcpConnect, createServer } from "node:net";
import { createServer as createTlsServer } from "node:tls";
import {
  AbortController,
  EnvironmentProxyPolicy,
  HttpConnectProxyConnector,
  NoProxyMatcher,
  ProxyConfigurationError,
  ProxyResponseError,
  Socks5ProxyConnector,
  Socks5ProxyError,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import {
  HostNodeSocketConnector,
  HostNodeTlsUpgrader,
  hostNodeURLs,
} from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-primitives.js";
import { tlsFixture } from "./tls-fixture.mjs";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const scheduler = {
  enqueue(task) {
    queueMicrotask(task);
  },
  delay(_milliseconds, _task) {
    return { cancel() {} };
  },
  reportError(error) {
    throw error;
  },
};

class ScriptedConnection {
  constructor(chunks, maximumWrite = Infinity) {
    this.chunks = chunks.map((chunk) =>
      typeof chunk === "string" ? encoder.encode(chunk) : new Uint8Array(chunk),
    );
    this.maximumWrite = maximumWrite;
    this.writes = [];
    this.closed = false;
  }

  async read(maximum) {
    if (this.chunks.length === 0) return null;
    const chunk = this.chunks[0];
    const result = chunk.subarray(0, maximum);
    if (result.length === chunk.length) this.chunks.shift();
    else this.chunks[0] = chunk.subarray(result.length);
    return result;
  }

  async write(data) {
    const length = Math.min(data.length, this.maximumWrite);
    this.writes.push(data.slice(0, length));
    return length;
  }

  close() {
    this.closed = true;
  }

  writtenBytes() {
    const length = this.writes.reduce((total, bytes) => total + bytes.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const bytes of this.writes) {
      result.set(bytes, offset);
      offset += bytes.length;
    }
    return result;
  }

  writtenText() {
    return decoder.decode(this.writtenBytes());
  }
}

class QueueConnector {
  constructor(connections) {
    this.connections = connections;
    this.addresses = [];
  }

  connect(address, signal) {
    signal.throwIfAborted();
    this.addresses.push(address);
    const connection = this.connections.shift();
    if (connection === undefined) return Promise.reject(new Error("No scripted connection"));
    return Promise.resolve(connection);
  }
}

class RecordingTls {
  constructor() {
    this.calls = [];
  }

  upgrade(connection, target, signal) {
    signal.throwIfAborted();
    this.calls.push({ connection, target });
    return Promise.resolve(connection);
  }
}

class ManualScheduler {
  constructor() {
    this.record = null;
  }

  enqueue(task) {
    queueMicrotask(task);
  }

  delay(milliseconds, task) {
    const record = { milliseconds, task, canceled: false };
    this.record = record;
    return {
      cancel() {
        record.canceled = true;
      },
    };
  }

  reportError(error) {
    throw error;
  }

  expire() {
    assert.notEqual(this.record, null);
    assert.equal(this.record.canceled, false);
    this.record.task();
  }
}

function target(hostname = "origin.example", secure = true) {
  return { hostname, port: secure ? 443 : 80, secure, connectTimeoutMs: 1234 };
}

test("HTTP CONNECT preserves target identity and percent-decoded Basic credentials", async () => {
  const connection = new ScriptedConnection(["HTTP/1.1 200 Connection Established\r\n\r\n"], 7);
  const direct = new QueueConnector([connection]);
  const tls = new RecordingTls();
  const connector = new HttpConnectProxyConnector({
    connector: direct,
    tls,
    scheduler,
    urls: hostNodeURLs,
    uri: "http://us%65r:p%40ss@proxy.example:8080",
    headers: [["User-Agent", "nts-proxy-test"]],
  });
  const address = target();
  assert.equal(await connector.connect(address, new AbortController().signal), connection);
  assert.deepEqual(direct.addresses, [
    {
      hostname: "proxy.example",
      port: 8080,
      secure: false,
      connectTimeoutMs: 1234,
    },
  ]);
  assert.equal(tls.calls.length, 1);
  assert.equal(tls.calls[0].target, address);
  assert.equal(
    connection.writtenText(),
    "CONNECT origin.example:443 HTTP/1.1\r\n" +
      "Host: origin.example:443\r\n" +
      "user-agent: nts-proxy-test\r\n" +
      "proxy-authorization: Basic dXNlcjpwQHNz\r\n\r\n",
  );
});

test("HTTP CONNECT brackets IPv6 and does not TLS-upgrade a plaintext target", async () => {
  const connection = new ScriptedConnection(["HTTP/1.1 200 ok\r\n\r\n"]);
  const direct = new QueueConnector([connection]);
  const tls = new RecordingTls();
  const connector = new HttpConnectProxyConnector({
    connector: direct,
    tls,
    scheduler,
    urls: hostNodeURLs,
    uri: "https://proxy.example",
  });
  await connector.connect(target("2001:db8::1", false), new AbortController().signal);
  assert.equal(direct.addresses[0].secure, true);
  assert.equal(
    connection.writtenText(),
    "CONNECT [2001:db8::1]:80 HTTP/1.1\r\nHost: [2001:db8::1]:80\r\n\r\n",
  );
  assert.equal(tls.calls.length, 0);
});

test("HTTP CONNECT retries a 407 on a fresh connection with typed authentication", async () => {
  const first = new ScriptedConnection([
    "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Bearer realm=test\r\n\r\n",
  ]);
  const second = new ScriptedConnection(["HTTP/1.1 200 ok\r\n\r\n"]);
  const direct = new QueueConnector([first, second]);
  const calls = [];
  const connector = new HttpConnectProxyConnector({
    connector: direct,
    tls: new RecordingTls(),
    scheduler,
    urls: hostNodeURLs,
    uri: "http://proxy.example",
    authenticate(context) {
      calls.push(context);
      return Promise.resolve("Bearer fresh-token");
    },
  });
  assert.equal(
    await connector.connect(target("plain.example", false), new AbortController().signal),
    second,
  );
  assert.equal(first.closed, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].attempt, 1);
  assert.deepEqual(calls[0].headers, [["proxy-authenticate", "Bearer realm=test"]]);
  assert.match(second.writtenText(), /proxy-authorization: Bearer fresh-token\r\n/);
});

test("HTTP CONNECT bounds authentication and rejects non-success or surplus bytes", async () => {
  const refused = new ScriptedConnection(["HTTP/1.1 407 no\r\n\r\n"]);
  const refusedConnector = new HttpConnectProxyConnector({
    connector: new QueueConnector([refused]),
    tls: new RecordingTls(),
    scheduler,
    urls: hostNodeURLs,
    uri: "http://proxy.example",
    maximumAuthenticationAttempts: 1,
    authenticate: () => "Basic ignored",
  });
  await assert.rejects(
    refusedConnector.connect(target(), new AbortController().signal),
    ProxyResponseError,
  );
  assert.equal(refused.closed, true);

  const surplus = new ScriptedConnection(["HTTP/1.1 200 ok\r\n\r\nunexpected"]);
  const surplusConnector = new HttpConnectProxyConnector({
    connector: new QueueConnector([surplus]),
    tls: new RecordingTls(),
    scheduler,
    urls: hostNodeURLs,
    uri: "http://proxy.example",
  });
  await assert.rejects(
    surplusConnector.connect(target(), new AbortController().signal),
    /beyond the CONNECT response/,
  );
  assert.equal(surplus.closed, true);
});

test("proxy deadlines cover the whole handshake and preserve TimeoutError", async () => {
  const clock = new ManualScheduler();
  const connection = new ScriptedConnection([]);
  const connector = new HttpConnectProxyConnector({
    connector: new QueueConnector([connection]),
    tls: new RecordingTls(),
    scheduler: clock,
    urls: hostNodeURLs,
    uri: "http://proxy.example",
  });
  const connecting = connector.connect(target(), new AbortController().signal);
  assert.equal(clock.record.milliseconds, 1234);
  clock.expire();
  await assert.rejects(
    connecting,
    (error) => error?.name === "TimeoutError" && error.message === "Proxy connection timed out",
  );
  assert.equal(connection.closed, true);
});

test("SOCKS5 delegates target DNS and applies end-to-end TLS after the tunnel", async () => {
  const connection = new ScriptedConnection([[5], [0], [5, 0, 0, 1, 127, 0, 0, 1, 0x1f, 0x90]]);
  const direct = new QueueConnector([connection]);
  const tls = new RecordingTls();
  const connector = new Socks5ProxyConnector({
    connector: direct,
    tls,
    scheduler,
    urls: hostNodeURLs,
    uri: "socks5://proxy.example:1081",
  });
  const address = target("does-not-resolve.invalid");
  assert.equal(await connector.connect(address, new AbortController().signal), connection);
  assert.equal(tls.calls[0].target, address);
  const bytes = connection.writtenBytes();
  assert.deepEqual(Array.from(bytes.subarray(0, 3)), [5, 1, 0]);
  const request = bytes.subarray(3);
  assert.deepEqual(Array.from(request.subarray(0, 5)), [5, 1, 0, 3, 24]);
  assert.equal(decoder.decode(request.subarray(5, 29)), "does-not-resolve.invalid");
  assert.deepEqual(Array.from(request.subarray(29)), [1, 187]);
});

test("SOCKS5 performs RFC 1929 authentication and encodes IPv4 targets", async () => {
  const connection = new ScriptedConnection([
    [5, 2],
    [1, 0],
    [5, 0, 0, 3, 0, 0, 80],
  ]);
  const connector = new Socks5ProxyConnector({
    connector: new QueueConnector([connection]),
    tls: new RecordingTls(),
    scheduler,
    urls: hostNodeURLs,
    uri: "socks://proxy.example",
    username: "user",
    password: "pass",
  });
  await connector.connect(target("192.0.2.9", false), new AbortController().signal);
  assert.deepEqual(Array.from(connection.writes[0]), [5, 2, 0, 2]);
  assert.deepEqual(
    Array.from(connection.writes[1]),
    [1, 4, 117, 115, 101, 114, 4, 112, 97, 115, 115],
  );
  assert.deepEqual(Array.from(connection.writes[2]), [5, 1, 0, 1, 192, 0, 2, 9, 0, 80]);
});

test("SOCKS5 encodes compressed IPv6 and exposes the proxy reply code", async () => {
  const rejected = new ScriptedConnection([
    [5, 0],
    [5, 5, 0, 1],
  ]);
  const connector = new Socks5ProxyConnector({
    connector: new QueueConnector([rejected]),
    tls: new RecordingTls(),
    scheduler,
    urls: hostNodeURLs,
    uri: "socks5://proxy.example",
  });
  await assert.rejects(
    connector.connect(target("2001:db8::1", false), new AbortController().signal),
    (error) => error instanceof Socks5ProxyError && error.reply === 5,
  );
  assert.deepEqual(
    Array.from(rejected.writes[1]),
    [5, 1, 0, 4, 0x20, 0x01, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 80],
  );
  assert.equal(rejected.closed, true);
});

test("proxy configuration rejects unsafe headers, schemes, ports and credential overflow", () => {
  const common = {
    connector: new QueueConnector([]),
    tls: new RecordingTls(),
    scheduler,
    urls: hostNodeURLs,
  };
  assert.throws(
    () => new HttpConnectProxyConnector({ ...common, uri: "ftp://proxy.example" }),
    ProxyConfigurationError,
  );
  assert.throws(
    () =>
      new HttpConnectProxyConnector({
        ...common,
        uri: "http://proxy.example",
        headers: [["Proxy-Authorization", "leak"]],
      }),
    ProxyConfigurationError,
  );
  assert.throws(
    () =>
      new Socks5ProxyConnector({
        ...common,
        uri: "socks5://proxy.example",
        username: "x".repeat(256),
      }),
    ProxyConfigurationError,
  );
  assert.throws(
    () =>
      new Socks5ProxyConnector({
        ...common,
        uri: "socks5://proxy.example",
        password: "password-without-username",
      }),
    ProxyConfigurationError,
  );
});

test("NO_PROXY matches exact hosts and subdomains only at DNS label boundaries", () => {
  const matcher = new NoProxyMatcher("example.com, *.internal.test, .service.test");
  for (const hostname of [
    "example.com",
    "api.example.com",
    "internal.test",
    "deep.internal.test",
    "service.test.",
  ]) {
    assert.equal(matcher.bypasses(hostNodeURLs.parse(`https://${hostname}/`)), true, hostname);
  }
  for (const hostname of ["notexample.com", "example.com.invalid", "internal.testing"]) {
    assert.equal(matcher.bypasses(hostNodeURLs.parse(`https://${hostname}/`)), false, hostname);
  }
});

test("NO_PROXY ports use effective URL ports and parse bracketed or bare IPv6", () => {
  const matcher = new NoProxyMatcher("example.test:443 [::1]:8443 ::2");
  assert.equal(matcher.bypasses(hostNodeURLs.parse("https://example.test/path")), true);
  assert.equal(matcher.bypasses(hostNodeURLs.parse("http://example.test/path")), false);
  assert.equal(matcher.bypasses(hostNodeURLs.parse("http://[::1]:8443/path")), true);
  assert.equal(matcher.bypasses(hostNodeURLs.parse("http://[::1]:8080/path")), false);
  assert.equal(matcher.bypasses(hostNodeURLs.parse("http://[::2]/path")), true);
});

test("environment proxy policy follows lowercase, explicit and HTTPS fallback precedence", () => {
  const policy = new EnvironmentProxyPolicy(
    hostNodeURLs,
    {
      http_proxy: "http://lower-http.test",
      HTTP_PROXY: "http://upper-ignored.test",
      HTTPS_PROXY: "http://secure.test",
      no_proxy: "bypass.test",
    },
    { httpsProxy: "socks5://explicit-secure.test" },
  );
  assert.equal(
    policy.proxyFor(hostNodeURLs.parse("http://origin.test/")),
    "http://lower-http.test",
  );
  assert.equal(
    policy.proxyFor(hostNodeURLs.parse("https://origin.test/")),
    "socks5://explicit-secure.test",
  );
  assert.equal(policy.proxyFor(hostNodeURLs.parse("https://bypass.test/")), null);

  const fallback = new EnvironmentProxyPolicy(hostNodeURLs, {
    HTTP_PROXY: "http://fallback.test",
  });
  assert.equal(
    fallback.proxyFor(hostNodeURLs.parse("https://origin.test/")),
    "http://fallback.test",
  );
});

test("empty lowercase proxy disables uppercase and wildcard NO_PROXY bypasses all", () => {
  const policy = new EnvironmentProxyPolicy(hostNodeURLs, {
    http_proxy: "",
    HTTP_PROXY: "http://must-not-win.test",
    HTTPS_PROXY: "http://secure.test",
    NO_PROXY: "*",
  });
  assert.equal(policy.httpProxy, null);
  assert.equal(policy.proxyFor(hostNodeURLs.parse("https://anywhere.test/")), null);
});

test("environment proxy policy rejects line breaks and unsupported schemes", () => {
  assert.throws(
    () => new EnvironmentProxyPolicy(hostNodeURLs, { HTTP_PROXY: "http://safe\r\nInjected: x" }),
    ProxyConfigurationError,
  );
  assert.throws(
    () => new EnvironmentProxyPolicy(hostNodeURLs, { HTTP_PROXY: "ftp://proxy.example" }),
    ProxyConfigurationError,
  );
});

test("real CONNECT tunnel upgrades TLS against the target identity, not the proxy", async () => {
  const fixture = tlsFixture();
  const origin = createTlsServer(fixture, (socket) => {
    socket.once("data", () => socket.end("HTTP/1.1 204 ok\r\nConnection: close\r\n\r\n"));
  });
  origin.listen(0, "127.0.0.1");
  await new Promise((resolve) => origin.once("listening", resolve));
  const originAddress = origin.address();
  assert.equal(typeof originAddress, "object");
  assert.notEqual(originAddress, null);

  const proxy = createServer((downstream) => {
    let request = "";
    const readHead = (chunk) => {
      request += decoder.decode(chunk);
      if (!request.includes("\r\n\r\n")) return;
      downstream.off("data", readHead);
      assert.match(request, new RegExp(`^CONNECT target\\.test:${originAddress.port} HTTP/1\\.1`));
      const upstream = tcpConnect({ host: "127.0.0.1", port: originAddress.port });
      upstream.once("connect", () => {
        downstream.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        downstream.pipe(upstream);
        upstream.pipe(downstream);
      });
      upstream.once("error", (error) => downstream.destroy(error));
    };
    downstream.on("data", readHead);
  });
  proxy.listen(0, "127.0.0.1");
  await new Promise((resolve) => proxy.once("listening", resolve));
  const proxyAddress = proxy.address();
  assert.equal(typeof proxyAddress, "object");
  assert.notEqual(proxyAddress, null);

  const connector = new HttpConnectProxyConnector({
    connector: new HostNodeSocketConnector(),
    tls: new HostNodeTlsUpgrader({ ca: fixture.cert.toString() }),
    scheduler,
    urls: hostNodeURLs,
    uri: `http://127.0.0.1:${proxyAddress.port}`,
  });
  const connection = await connector.connect(
    {
      hostname: "target.test",
      port: originAddress.port,
      secure: true,
      connectTimeoutMs: 2000,
    },
    new AbortController().signal,
  );
  await connection.write(encoder.encode("GET / HTTP/1.1\r\nHost: target.test\r\n\r\n"));
  assert.match(decoder.decode(await connection.read(65536)), /^HTTP\/1\.1 204/);
  connection.close();
  await new Promise((resolve) => proxy.close(resolve));
  await new Promise((resolve) => origin.close(resolve));
});
