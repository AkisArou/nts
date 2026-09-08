// The proxy auto-configuration result grammar.
//
// There is no upstream fixture for this: WPT does not test proxies, because a browser's
// proxy stack sits below everything WPT can observe. So the oracle here is the grammar's
// own documentation plus the behaviour every implementation converges on, and the cases
// worth writing are the ones where a plausible implementation would differ -- SOCKS4
// versus SOCKS5, a missing port, a bare IPv6 literal, and what happens when the result
// names nothing usable.
import assert from "node:assert/strict";
import test from "node:test";

import {
  NoProxyMatcher,
  parseProxyResult,
  SystemProxyPolicy,
  systemProxyPolicy,
} from "../node_modules/.tsbuild/host/runtime/web-platform/src/index.js";
import { createHostNodeWebPlatform } from "../node_modules/.tsbuild/host/tooling/conformance/web-platform/node-runtime.js";

const suite = (name, fn) => test(name, { timeout: 8000 }, fn);
const kinds = (result) => result.routes.map((route) => route.kind);

suite("directives are kept in the order the result gave them", () => {
  const result = parseProxyResult("PROXY a:8080; SOCKS5 b:1080; DIRECT");
  assert.deepEqual(kinds(result), ["http-connect", "socks5", "direct"]);
  assert.deepEqual(result.routes[0], {
    kind: "http-connect",
    hostname: "a",
    port: 8080,
    secure: false,
  });
  assert.deepEqual(result.unsupported, []);
});

suite("a result that does not say DIRECT still ends at DIRECT", () => {
  // A fallback list that runs out would otherwise fail a request that going direct would
  // have served. No implementation treats exhaustion as a failure.
  assert.deepEqual(kinds(parseProxyResult("PROXY a:8080")), ["http-connect", "direct"]);
});

suite("an empty or unparseable result is DIRECT rather than an error", () => {
  for (const value of ["", "   ", ";;;", "NONSENSE", "PROXY"]) {
    const result = parseProxyResult(value);
    assert.deepEqual(kinds(result), ["direct"], `for ${JSON.stringify(value)}`);
  }
});

suite("SOCKS4 is reported as unusable, not quietly upgraded to SOCKS5", () => {
  // The dangerous alternative is mapping `SOCKS` onto SOCKS5: it type-checks, it looks
  // like support, and it produces a connection that fails inside a handshake the peer
  // never agreed to speak. Both spellings mean SOCKS4.
  for (const value of ["SOCKS s:1080", "SOCKS4 s:1080"]) {
    const result = parseProxyResult(value);
    assert.deepEqual(kinds(result), ["direct"], value);
    assert.deepEqual(result.unsupported, [value], value);
  }
});

suite("an unusable directive does not take the usable ones beside it down", () => {
  const result = parseProxyResult("SOCKS a:1080; PROXY b:3128; QUIC c:443");
  assert.deepEqual(kinds(result), ["http-connect", "direct"]);
  assert.deepEqual(result.unsupported, ["SOCKS a:1080", "QUIC c:443"]);
});

suite("naming only unusable proxies is distinguishable from naming none", () => {
  // Both go direct. Only one of them is a configuration somebody expected to work, and a
  // caller that cannot tell them apart cannot report the difference.
  const unusable = parseProxyResult("SOCKS s:1080");
  const none = parseProxyResult("");
  assert.deepEqual(kinds(unusable), kinds(none));
  assert.equal(unusable.unsupported.length, 1);
  assert.equal(none.unsupported.length, 0);
});

suite("HTTPS is the only directive that makes the hop to the proxy TLS", () => {
  assert.equal(parseProxyResult("HTTPS p:443").routes[0].secure, true);
  assert.equal(parseProxyResult("PROXY p:443").routes[0].secure, false);
  assert.equal(parseProxyResult("HTTP p:443").routes[0].secure, false);
});

suite("a missing port takes the default for its keyword", () => {
  const port = (value) => parseProxyResult(value).routes[0].port;
  assert.equal(port("PROXY p"), 80);
  assert.equal(port("HTTP p"), 80);
  assert.equal(port("HTTPS p"), 443);
  assert.equal(port("SOCKS5 p"), 1080);
});

suite("keywords are matched without regard to case", () => {
  assert.deepEqual(kinds(parseProxyResult("proxy a:1; Socks5 b:2; direct")), [
    "http-connect",
    "socks5",
    "direct",
  ]);
});

suite("an IPv6 proxy needs brackets, and keeps none once parsed", () => {
  const bracketed = parseProxyResult("PROXY [::1]:8080").routes[0];
  assert.equal(bracketed.hostname, "::1", "brackets are stripped to match ConnectAddress");
  assert.equal(bracketed.port, 8080);
  assert.equal(parseProxyResult("PROXY [::1]").routes[0].port, 80);
  // Unbracketed is genuinely ambiguous: `::1:8080` is a valid address as well as a host
  // and a port, so the only honest answer is to refuse it.
  assert.deepEqual(parseProxyResult("PROXY ::1:8080").unsupported, ["PROXY ::1:8080"]);
});

suite("a port outside range is refused rather than truncated", () => {
  for (const value of ["PROXY p:0", "PROXY p:65536", "PROXY p:99999", "PROXY p:-1", "PROXY p:8o8"]) {
    assert.deepEqual(parseProxyResult(value).unsupported, [value], value);
  }
});

suite("DIRECT stated twice is one instruction, not two routes", () => {
  assert.deepEqual(kinds(parseProxyResult("DIRECT; PROXY a:1; DIRECT")), [
    "direct",
    "http-connect",
  ]);
});

suite("surrounding whitespace and empty directives are ignored", () => {
  assert.deepEqual(kinds(parseProxyResult("  PROXY   a:8080  ;; \t DIRECT ;")), [
    "http-connect",
    "direct",
  ]);
});

function url(href) {
  return new URL(href);
}

suite("the policy asks the host, and parses what it says", () => {
  const asked = [];
  const policy = new SystemProxyPolicy((target) => {
    asked.push(target.href);
    return "PROXY p:3128";
  });
  const result = policy.resolve(url("http://example.test/x"));
  assert.deepEqual(asked, ["http://example.test/x"]);
  assert.deepEqual(kinds(result), ["http-connect", "direct"]);
});

suite("the bypass list is applied before the host is asked", () => {
  // Not merely "the result is direct": a host that is bypassed must not be looked up at
  // all, or every request to a bypassed origin pays for a lookup whose answer is discarded.
  let asked = 0;
  const policy = new SystemProxyPolicy(
    () => {
      asked++;
      return "PROXY p:3128";
    },
    new NoProxyMatcher("example.test"),
  );
  assert.deepEqual(kinds(policy.resolve(url("http://api.example.test/x"))), ["direct"]);
  assert.equal(asked, 0, "the bypassed origin must not reach the resolver");
  assert.deepEqual(kinds(policy.resolve(url("http://other.test/x"))), ["http-connect", "direct"]);
  assert.equal(asked, 1);
});

suite("a scheme with no proxy story is direct without asking", () => {
  let asked = 0;
  const policy = new SystemProxyPolicy(() => {
    asked++;
    return "PROXY p:3128";
  });
  for (const href of ["data:,x", "blob:http://a.test/1", "file:///tmp/x"]) {
    assert.deepEqual(kinds(policy.resolve(url(href))), ["direct"], href);
  }
  assert.equal(asked, 0);
});

suite("a host with no answer is direct", () => {
  const policy = new SystemProxyPolicy(() => null);
  assert.deepEqual(kinds(policy.resolve(url("http://example.test/"))), ["direct"]);
});

suite("the platform-backed policy reads the provider, not a captured value", (t) => {
  // Built before any runtime exists, which is the point: a policy constructed at module
  // scope must not require one, and a provider whose settings change during the process
  // must be asked again rather than answered from a cache.
  const policy = systemProxyPolicy();
  const asked = [];
  const api = createHostNodeWebPlatform({}, {}, undefined, (target) => {
    asked.push(target.href);
    return asked.length === 1 ? "PROXY first.test:1" : "PROXY second.test:2";
  });
  t.after(() => api.close());
  assert.equal(policy.resolve(url("http://a.test/")).routes[0].hostname, "first.test");
  assert.equal(policy.resolve(url("http://b.test/")).routes[0].hostname, "second.test");
  assert.deepEqual(asked, ["http://a.test/", "http://b.test/"]);
});

suite("a host with no system proxy story answers direct, not an error", (t) => {
  // The default on this host, and the honest one: Node has no system proxy API. The
  // environment variables it does have are EnvironmentProxyPolicy's, and giving one
  // question two answers that could disagree is the arrangement this runtime avoids.
  const api = createHostNodeWebPlatform();
  t.after(() => api.close());
  assert.deepEqual(kinds(systemProxyPolicy().resolve(url("http://a.test/"))), ["direct"]);
});

suite("a loopback host is not bypassed unless the caller says so", () => {
  // Pinned because of a device measurement rather than a guess. On Android API 26 the
  // framework propagates the proxy's host and port to an application but *not*
  // `global_http_proxy_exclusion_list`, so the platform itself answers "use the proxy" for
  // `127.0.0.1`. Nothing here invents a loopback exemption -- the resolver's answer is
  // honoured, which is the contract -- so the caller's own list is what keeps a loopback
  // request off the proxy, and this asserts both halves of that.
  const proxied = new SystemProxyPolicy(() => "PROXY p:3128");
  assert.deepEqual(kinds(proxied.resolve(url("http://127.0.0.1:8080/x"))), [
    "http-connect",
    "direct",
  ]);

  const bypassed = new SystemProxyPolicy(() => "PROXY p:3128", new NoProxyMatcher("127.0.0.1"));
  assert.deepEqual(kinds(bypassed.resolve(url("http://127.0.0.1:8080/x"))), ["direct"]);
});
