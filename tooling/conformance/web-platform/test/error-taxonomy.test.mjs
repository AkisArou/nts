// The error taxonomy is a compatibility contract.
//
// Consumers switch on `error.name`, and two dispatch policies switch on whether an
// error is a `TransportError`: retry only retries typed transport failures, and only
// typed transport failures reduce a balanced upstream's health. Both are load-bearing
// and neither was asserted anywhere, so a class added to the wrong base — or renamed —
// would change retry and routing behaviour silently.
//
// This pins the taxonomy as it is. It is not a claim that every classification is the
// one we would choose today; see the note on proxy errors below.
import assert from "node:assert/strict";
import test from "node:test";

import * as api from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import { DOMException } from "../node_modules/.tsbuild/host/runtime/web-platform/src/core/errors.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);

/**
 * Every error this runtime exports, how to build one, and whether it is a typed
 * transport failure.
 *
 * `transport: true` is not documentation. It is exactly the set that `RetryInterceptor`
 * will retry and that reduces a `BalancedPool` upstream's health, so moving an entry
 * across that column changes what the network does.
 */
const TAXONOMY = {
  AgentOriginLimitError: { build: (C) => new C(1), transport: false },
  AgentPendingLimitError: { build: (C) => new C(1), transport: false },
  BalancedPoolLimitError: { build: (C) => new C(1), transport: false },
  BalancedPoolMissingUpstreamError: { build: (C) => new C("origin"), transport: false },
  // Not a transport failure, and the classification is the whole decision. A corrupt or
  // unreadable stored snapshot fails the same way every time it is read, so retrying it
  // spends attempts to reach an identical answer -- and letting it reduce an upstream's
  // health would blame a server for a local storage fault it never saw.
  CookieJarStoreError: { build: (C) => new C("unreadable"), transport: false },
  DeduplicationBufferError: { build: (C) => new C("limit"), transport: false },
  DnsConnectionError: { build: (C) => new C("host", []), transport: true },
  DnsLookupLimitError: { build: (C) => new C(1), transport: false },
  DnsNoAddressError: { build: (C) => new C("host"), transport: true },
  MockNotMatchedError: { build: (C) => new C("no match"), transport: false },
  ProtocolMismatchError: { build: (C) => new C("h2", "http/1.1"), transport: false },
  ProxyConfigurationError: { build: (C) => new C("bad"), transport: false },
  ProxyResponseError: { build: (C) => new C(502, []), transport: false },
  ResponseError: {
    build: (C) => new C({ status: 500, statusText: "Server Error", headers: [] }, null),
    transport: false,
  },
  ResponseExceededMaxSizeError: { build: (C) => new C(1, 2), transport: false },
  RetryExhaustedError: { build: (C) => new C("exhausted"), transport: false },
  SnapshotNotFoundError: { build: (C) => new C("key"), transport: false },
  Socks5ProxyError: { build: (C) => new C("refused"), transport: false },
  TransportError: { build: (C) => new C("other", "failed"), transport: true },
  UnreplayableRequestError: { build: (C) => new C("body"), transport: false },
  WebSocketError: { build: (C) => new C("closed"), transport: false },
};

function exportedErrorNames() {
  return Object.keys(api)
    .filter((name) => /Error$/.test(name))
    .sort();
}

suite("the set of exported errors is exactly the taxonomy", () => {
  // Adding an error class is a decision about retry and routing, so it fails here
  // until it is made. Removing one is a compatibility break and fails here too.
  assert.deepEqual(exportedErrorNames(), Object.keys(TAXONOMY).sort());
});

suite("every error names itself and is an Error", () => {
  const seen = new Set();
  for (const [name, entry] of Object.entries(TAXONOMY)) {
    const constructor = api[name];
    assert.equal(typeof constructor, "function", `${name} must be exported as a class`);
    const instance = entry.build(constructor);
    assert.ok(instance instanceof Error, `${name} must be an Error`);
    // `name` is what a consumer switches on; the class's own identifier is not it.
    assert.equal(instance.name, name, `${name} must report its own name`);
    assert.equal(typeof instance.message, "string");
    assert.ok(!seen.has(instance.name), `${instance.name} is not a unique name`);
    seen.add(instance.name);
  }
  assert.equal(seen.size, Object.keys(TAXONOMY).length);
});

suite("exactly the declared errors are typed transport failures", () => {
  const actual = [];
  const expected = [];
  for (const [name, entry] of Object.entries(TAXONOMY)) {
    const instance = entry.build(api[name]);
    if (instance instanceof api.TransportError) actual.push(name);
    if (entry.transport) expected.push(name);
  }
  // This is the set retry retries and the set that costs an upstream its health.
  assert.deepEqual(actual.sort(), expected.sort());
  // And a transport failure always carries the code those policies read.
  for (const name of expected) {
    const instance = TAXONOMY[name].build(api[name]);
    assert.equal(typeof instance.code, "string", `${name} must carry a transport code`);
    assert.ok(instance.code.length > 0);
  }
});

suite("the two errors with a non-Error base keep it", () => {
  // `MockNotMatchedError` is a `TypeError` because an unmatched mock is a programming
  // mistake, and `WebSocketError` is a `DOMException` because the WebSockets standard
  // says so. Both are observable through `instanceof` and neither is incidental.
  const mock = TAXONOMY.MockNotMatchedError.build(api.MockNotMatchedError);
  assert.ok(mock instanceof TypeError);
  const socket = TAXONOMY.WebSocketError.build(api.WebSocketError);
  assert.ok(socket instanceof DOMException);
  assert.equal(socket.name, "WebSocketError");
});

suite("proxy failures are deliberately outside the transport set", () => {
  // Recorded rather than asserted as ideal. A proxy that refuses a CONNECT is a
  // transport-layer failure by any ordinary reading, yet `ProxyResponseError`,
  // `Socks5ProxyError` and `ProxyConfigurationError` are not `TransportError`s, so a
  // failing proxy upstream never loses health and a proxy failure is never retried.
  //
  // For configuration and authentication that is right: retrying cannot help and
  // penalising an upstream for a fixed misconfiguration would route traffic away from
  // it forever. For a transient 502 from a proxy it is arguably wrong. Changing it
  // changes routing, so it is pinned here and left as a decision rather than drifting.
  for (const name of ["ProxyResponseError", "Socks5ProxyError", "ProxyConfigurationError"]) {
    const instance = TAXONOMY[name].build(api[name]);
    assert.ok(
      !(instance instanceof api.TransportError),
      `${name} is outside the transport set; changing that changes retry and routing`,
    );
  }
});
