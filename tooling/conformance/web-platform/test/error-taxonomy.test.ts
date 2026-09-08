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
import type { TestContext } from "node:test";

import * as api from "../../../../runtime/web-platform/src/index.ts";
import { DOMException } from "../../../../runtime/web-platform/src/core/errors.ts";
import { memberNamed } from "./harness.ts";

const suite = (name: string, fn: (t: TestContext) => void | Promise<void>): void => {
  test(name, { timeout: 8000 }, fn);
};

/**
 * Every error this runtime exports, how to build one, and whether it is a typed
 * transport failure.
 *
 * `transport: true` is not documentation. It is exactly the set that `RetryInterceptor`
 * will retry and that reduces a `BalancedPool` upstream's health, so moving an entry
 * across that column changes what the network does.
 */
/**
 * How to construct one error, and whether it belongs to the transport set.
 *
 * `build` takes the constructor rather than closing over it, because the test looks each one
 * up by name off the module namespace -- which is the thing being checked.
 */
interface TaxonomyEntry {
  readonly build: (constructor: new (...args: readonly unknown[]) => Error) => Error;
  readonly transport: boolean;
}

const TAXONOMY: Readonly<Record<string, TaxonomyEntry>> = {
  AgentOriginLimitError: { build: (C: new (...args: readonly unknown[]) => Error) => new C(1), transport: false },
  AgentPendingLimitError: { build: (C: new (...args: readonly unknown[]) => Error) => new C(1), transport: false },
  BalancedPoolLimitError: { build: (C: new (...args: readonly unknown[]) => Error) => new C(1), transport: false },
  BalancedPoolMissingUpstreamError: { build: (C: new (...args: readonly unknown[]) => Error) => new C("origin"), transport: false },
  // Not a transport failure, and the classification is the whole decision. A corrupt or
  // unreadable stored snapshot fails the same way every time it is read, so retrying it
  // spends attempts to reach an identical answer -- and letting it reduce an upstream's
  // health would blame a server for a local storage fault it never saw.
  CookieJarStoreError: { build: (C: new (...args: readonly unknown[]) => Error) => new C("unreadable"), transport: false },
  DeduplicationBufferError: { build: (C: new (...args: readonly unknown[]) => Error) => new C("limit"), transport: false },
  DnsConnectionError: { build: (C: new (...args: readonly unknown[]) => Error) => new C("host", []), transport: true },
  DnsLookupLimitError: { build: (C: new (...args: readonly unknown[]) => Error) => new C(1), transport: false },
  DnsNoAddressError: { build: (C: new (...args: readonly unknown[]) => Error) => new C("host"), transport: true },
  MockNotMatchedError: { build: (C: new (...args: readonly unknown[]) => Error) => new C("no match"), transport: false },
  ProtocolMismatchError: { build: (C: new (...args: readonly unknown[]) => Error) => new C("h2", "http/1.1"), transport: false },
  ProxyConfigurationError: { build: (C: new (...args: readonly unknown[]) => Error) => new C("bad"), transport: false },
  ProxyResponseError: { build: (C: new (...args: readonly unknown[]) => Error) => new C(502, []), transport: false },
  ResponseError: {
    build: (C: new (...args: readonly unknown[]) => Error) => new C({ status: 500, statusText: "Server Error", headers: [] }, null),
    transport: false,
  },
  ResponseExceededMaxSizeError: { build: (C: new (...args: readonly unknown[]) => Error) => new C(1, 2), transport: false },
  RetryExhaustedError: { build: (C: new (...args: readonly unknown[]) => Error) => new C("exhausted"), transport: false },
  SnapshotNotFoundError: { build: (C: new (...args: readonly unknown[]) => Error) => new C("key"), transport: false },
  Socks5ProxyError: { build: (C: new (...args: readonly unknown[]) => Error) => new C("refused"), transport: false },
  TransportError: { build: (C: new (...args: readonly unknown[]) => Error) => new C("other", "failed"), transport: true },
  UnreplayableRequestError: { build: (C: new (...args: readonly unknown[]) => Error) => new C("body"), transport: false },
  WebSocketError: { build: (C: new (...args: readonly unknown[]) => Error) => new C("closed"), transport: false },
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

/** The error `name` denotes, built through its taxonomy entry. */
function errorNamed(name: string): Error {
  const entry = TAXONOMY[name];
  assert.ok(entry !== undefined, `${name} is not in the taxonomy`);
  const constructor = memberNamed(api, name);
  assert.equal(typeof constructor, "function", `${name} must be exported as a class`);
  return entry.build(constructor as new (...args: readonly unknown[]) => Error);
}

suite("every error names itself and is an Error", () => {
  const seen = new Set();
  for (const [name, entry] of Object.entries(TAXONOMY)) {
    const constructor = memberNamed(api, name);
    assert.equal(typeof constructor, "function", `${name} must be exported as a class`);
    const instance = entry.build(constructor as new (...args: readonly unknown[]) => Error);
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
  const actual: string[] = [];
  const expected: string[] = [];
  for (const [name, entry] of Object.entries(TAXONOMY)) {
    const instance = errorNamed(name);
    if (instance instanceof api.TransportError) actual.push(name);
    if (entry.transport) expected.push(name);
  }
  // This is the set retry retries and the set that costs an upstream its health.
  assert.deepEqual(actual.sort(), expected.sort());
  // And a transport failure always carries the code those policies read.
  for (const name of expected) {
    const instance = errorNamed(name);
    // `code` is not on `Error`; it is what the transport set adds, and reading it through a
    // widened shape is what the untyped version did implicitly.
    const code: unknown = (instance as { code?: unknown }).code;
    assert.equal(typeof code, "string", `${name} must carry a transport code`);
    assert.ok(typeof code === "string" && code.length > 0);
  }
});

suite("the two errors with a non-Error base keep it", () => {
  // `MockNotMatchedError` is a `TypeError` because an unmatched mock is a programming
  // mistake, and `WebSocketError` is a `DOMException` because the WebSockets standard
  // says so. Both are observable through `instanceof` and neither is incidental.
  const mock = errorNamed("MockNotMatchedError");
  assert.ok(mock instanceof TypeError);
  const socket = errorNamed("WebSocketError");
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
    const instance = errorNamed(name);
    assert.ok(
      !(instance instanceof api.TransportError),
      `${name} is outside the transport set; changing that changes retry and routing`,
    );
  }
});
