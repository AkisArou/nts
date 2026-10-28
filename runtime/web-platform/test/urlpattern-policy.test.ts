import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { createHostNodeWebPlatform } from "../host/node-runtime.ts";
import { getURLPatternURLCapability, installURLPatternURLCapability, URLPatternCapabilityError } from "../src/provider/url-pattern.ts";
import type { URLPatternURLCapability } from "../src/provider/url-pattern.ts";
import { URLPattern } from "../src/urlpattern/url-pattern.ts";
import type { URLPatternInit, URLPatternInput } from "../src/urlpattern/types.ts";
import { HostURLPatternURLCapability } from "./urlpattern-provider.ts";
import { WptHarness } from "./wpt/harness.ts";

function runtime(t: TestContext, capability: URLPatternURLCapability = new HostURLPatternURLCapability()) {
  const runtime = createHostNodeWebPlatform();
  t.after(() => runtime.close());
  installURLPatternURLCapability(runtime, capability);
  return runtime;
}

test("URLPattern Web IDL dictionary members convert once in lexical order before options", (t) => {
  runtime(t);
  const calls: string[] = [];
  const input = {
    get baseURL() { calls.push("baseURL"); return undefined; },
    get hash() { calls.push("hash"); return undefined; },
    get hostname() { calls.push("hostname"); return undefined; },
    get password() { calls.push("password"); return undefined; },
    get pathname() { calls.push("pathname"); return { toString() { calls.push("pathname string"); return "/:id"; } }; },
    get port() { calls.push("port"); return undefined; },
    get protocol() { calls.push("protocol"); return undefined; },
    get search() { calls.push("search"); return undefined; },
    get username() { calls.push("username"); return undefined; },
  };
  const pattern = new URLPattern(input as unknown as URLPatternInit, { get ignoreCase() { calls.push("ignoreCase"); return true; } });
  assert.equal(pattern.pathname, "/:id");
  assert.deepEqual(calls, ["baseURL", "hash", "hostname", "password", "pathname", "pathname string", "port", "protocol", "search", "username", "ignoreCase"]);
});

test("URLPattern conversion failure stops before later dictionary members and options", (t) => {
  runtime(t);
  const sentinel = {};
  let later = 0;
  assert.throws(() => new URLPattern({ get hash(): string { throw sentinel; }, get hostname() { later++; return "example.com"; } },
    { get ignoreCase() { later++; return false; } }), (error) => error === sentinel);
  assert.equal(later, 0);
});

for (const method of ["test", "exec"] as const) {
  test(`URLPattern.${method} checks its receiver before argument conversion`, (t) => {
    runtime(t);
    let reads = 0;
    const operation: (this: URLPattern, input?: URLPatternInput) => unknown = URLPattern.prototype[method];
    assert.throws(() => operation.call({} as URLPattern, { get hash() { reads++; return "x"; } }), TypeError);
    assert.equal(reads, 0);
  });
  test(`URLPattern.${method} propagates dictionary getters rather than converting them into a failed match`, (t) => {
    runtime(t);
    const sentinel = {};
    const pattern = new URLPattern();
    assert.throws(() => pattern[method]({ get protocol(): string { throw sentinel; } }), (error) => error === sentinel);
  });
}

test("URLPattern converts null dictionaries, default arguments and primitive string inputs", (t) => {
  runtime(t);
  const all = new URLPattern(null as unknown as URLPatternInit, null as never);
  assert.equal(all.test(), true);
  assert.equal(all.exec()?.inputs.length, 1);
  assert.equal(new URLPattern(42 as unknown as string, "https://example.test/").pathname, "/42");
  assert.throws(() => new URLPattern(Symbol() as unknown as string), TypeError);
  assert.throws(() => new URLPattern({}, "https://example.test/"), TypeError);
  assert.throws(() => all.exec({}, "https://example.test/"), TypeError);
  assert.equal(all.exec("relative"), null);
});

test("URLPattern default-port canonicalization does not invent a default port for file", (t) => {
  runtime(t);
  assert.equal(new URLPattern({ protocol: "https", port: "00443" }).port, "");
  assert.equal(new URLPattern({ protocol: "file", port: "0" }).port, "0");
  assert.equal(new URLPattern({ protocol: "file", port: "80" }).port, "80");
  assert.equal(new URLPattern({ protocol: ":scheme", port: "443" }).port, "443");
});

test("URLPattern empty encoded suffix does not introduce a phantom group boundary", (t) => {
  runtime(t);
  const pattern = new URLPattern({ pathname: "/:id\\\n" });
  assert.equal(pattern.pathname, "/:id");
  assert.equal(pattern.exec("https://example.test/abc")?.pathname.groups.id, "abc");
});

test("URLPattern preserves Unicode identifiers and scalar-value string conversion", (t) => {
  runtime(t);
  const pattern = new URLPattern({ pathname: "/:𝒜/:café/:$x" });
  assert.deepEqual(pattern.exec("https://example.test/one/two/three")?.pathname.groups, { "𝒜": "one", "café": "two", "$x": "three" });
  assert.equal(new URLPattern({ hash: "\ud800" }).hash, "%EF%BF%BD");
  assert.throws(() => new URLPattern({ pathname: "/:0bad" }), TypeError);
});

test("URLPattern rejects duplicate names and malformed ASCII RegExp syntax", (t) => {
  runtime(t);
  for (const pathname of ["/:id/:id", "()", "((a))", "(?=a)", "(é)", "(\\)", "(a", "{}?+", ":"])
    assert.throws(() => new URLPattern({ pathname }), TypeError, pathname);
  assert.equal(new URLPattern({ pathname: "/:id([0-9]+)" }).hasRegExpGroups, true);
  assert.equal(new URLPattern({ pathname: "/:id([^\\/]+?)" }).hasRegExpGroups, false);
});

test("URLPattern uses UnicodeSets regex syntax and limits ignoreCase to path search and hash", (t) => {
  runtime(t);
  const pattern = new URLPattern({ pathname: "/:ascii([\\p{ASCII}&&\\p{Letter}]+)", username: "User", search: "Q", hash: "F" }, { ignoreCase: true });
  assert.equal(pattern.test("https://User@example.test/aBc?q#f"), true);
  assert.equal(pattern.test("https://user@example.test/aBc?q#f"), false);
  assert.equal(pattern.test("https://User@example.test/é?q#f"), false);
});

test("URLPattern repetition preserves separators inside captures and optional missing captures", (t) => {
  runtime(t);
  assert.equal(new URLPattern({ pathname: "/:segments+" }).exec("https://example.test/a/b/c")?.pathname.groups.segments, "a/b/c");
  assert.equal(new URLPattern({ pathname: "/:segments*" }).exec("https://example.test")?.pathname.groups.segments, undefined);
  const optional = new URLPattern({ pathname: "/x{/:id}?" }).exec("https://example.test/x");
  assert.ok(optional);
  assert.equal(Object.hasOwn(optional.pathname.groups, "id"), true);
  assert.equal(optional.pathname.groups.id, undefined);
});

test("URLPattern names such as __proto__ are own data values and results are fresh", (t) => {
  runtime(t);
  const pattern = new URLPattern({ pathname: "/:__proto__/:constructor/:hasOwnProperty" });
  const first = pattern.exec("https://example.test/a/b/c")!;
  assert.equal(Object.hasOwn(first.pathname.groups, "__proto__"), true);
  assert.equal(first.pathname.groups.__proto__, "a");
  assert.equal(first.pathname.groups.constructor, "b");
  assert.equal(first.pathname.groups.hasOwnProperty, "c");
  first.pathname.groups.__proto__ = "changed";
  const second = pattern.exec("https://example.test/a/b/c")!;
  assert.equal(second.pathname.groups.__proto__, "a");
  assert.notEqual(first.inputs, second.inputs);
  assert.notEqual(first.pathname, second.pathname);
});

test("URLPattern outputs converted dictionary snapshots rather than the original object", (t) => {
  runtime(t);
  const input = { pathname: 123, extra: true };
  const match = new URLPattern().exec(input as unknown as URLPatternInit)!;
  assert.deepEqual(match.inputs, [{ pathname: "123" }]);
  assert.notEqual(match.inputs[0], input);
  assert.deepEqual(Object.keys(match), ["inputs", "protocol", "username", "password", "hostname", "port", "pathname", "search", "hash"]);
});

test("URLPattern relative patterns inherit only the specified less-specific base components", (t) => {
  runtime(t);
  const base = "https://user:pass@example.test:8080/a/b?q#f";
  const pathname = new URLPattern({ pathname: "../:id", baseURL: base });
  assert.deepEqual([pathname.protocol, pathname.username, pathname.password, pathname.hostname, pathname.port, pathname.pathname, pathname.search, pathname.hash],
    ["https", "*", "*", "example.test", "8080", "//:id", "*", "*"]);
  const hash = new URLPattern({ hash: "new", baseURL: base });
  assert.equal(hash.pathname, "/a/b");
  assert.equal(hash.search, "q");
  assert.equal(new URLPattern({ hostname: "other.test", baseURL: base }).pathname, "*");
});

test("URLPattern constructor separators respect regexp names optional modifiers braces and IPv6", (t) => {
  runtime(t);
  const pattern = new URLPattern("https://{:sub.}?example.test/:id?query#fragment");
  assert.equal(pattern.hostname, "{:sub.}?example.test");
  assert.equal(pattern.pathname, "/:id?query");
  assert.equal(pattern.search, "");
  assert.equal(pattern.hash, "fragment");
  const ipv6 = new URLPattern("https://[\\:\\:1]:8080/*");
  assert.equal(ipv6.test("https://[::1]:8080/x"), true);
});

test("URLPattern native capability errors are distinct from invalid input and no-match", (t) => {
  const cap = new HostURLPatternURLCapability();
  let unavailable = false;
  runtime(t, { canonicalize(component, value, protocol) { return unavailable ? { ok: false, error: "unsupported" } : cap.canonicalize(component, value, protocol); }, hasOpaquePath: (record) => cap.hasOpaquePath(record) });
  const pattern = new URLPattern();
  assert.equal(pattern.test({ hostname: "[broken" }), false);
  unavailable = true;
  assert.throws(() => pattern.test({ hostname: "valid.example" }), URLPatternCapabilityError);
  assert.throws(() => new URLPattern({ pathname: "/x" }), URLPatternCapabilityError);
});

test("URLPattern capabilities are explicitly installed per environment and instances retain theirs", async (t) => {
  const first = runtime(t);
  const pattern = new URLPattern({ pathname: "/:name" });
  const missing = createHostNodeWebPlatform();
  t.after(() => missing.close());
  assert.throws(() => getURLPatternURLCapability(missing), URLPatternCapabilityError);
  assert.throws(() => new URLPattern(), URLPatternCapabilityError);
  assert.equal(pattern.test("https://example.test/x"), true);
  assert.ok(getURLPatternURLCapability(first));
});

test("URLPattern test-only URL primitive covers nonempty failure sentinels and empty values", () => {
  const cap = new HostURLPatternURLCapability();
  for (const component of ["username", "password", "hostname", "port", "pathname", "opaquePathname", "search", "hash"] as const)
    assert.deepEqual(cap.canonicalize(component, ""), { ok: true, value: "" });
  for (const value of ["dummy.invalid", "other.invalid", "DUMMY.INVALID", "é.example"]) assert.equal(cap.canonicalize("hostname", value).ok, true);
  assert.deepEqual(cap.canonicalize("hostname", "a:b"), { ok: false, error: "invalid-input" });
  for (const value of ["1", "2", "00001", "443x"]) assert.equal(cap.canonicalize("port", value).ok, true);
  assert.deepEqual(cap.canonicalize("port", "65536"), { ok: false, error: "invalid-input" });
  assert.deepEqual(cap.canonicalize("port", "hello"), { ok: false, error: "invalid-input" });
  assert.deepEqual(cap.canonicalize("port", "443", "https"), { ok: true, value: "" });
  assert.deepEqual(cap.canonicalize("port", "0", "file"), { ok: true, value: "0" });
});

test("URLPattern opaque URL primitive preserves trailing C0 and spaces without path normalization", () => {
  const cap = new HostURLPatternURLCapability();
  for (const [input, expected] of [["/a/../b", "/a/../b"], [" x ", " x "], ["x\0", "x%00"], ["é", "%C3%A9"], ["x ?q", "x%20"], ["x#fragment", "x"], ["x\ty", "xy"]])
    assert.deepEqual(cap.canonicalize("opaquePathname", input!), { ok: true, value: expected });
});

test("URLPattern query and fragment URL primitives preserve leading component separators", () => {
  const cap = new HostURLPatternURLCapability();
  assert.deepEqual(cap.canonicalize("search", "?a#b'"), { ok: true, value: "?a%23b%27" });
  assert.deepEqual(cap.canonicalize("hash", "#a?b "), { ok: true, value: "#a?b%20" });
  assert.deepEqual(cap.canonicalize("pathname", "a?b#c"), { ok: true, value: "a%3Fb%23c" });
});

test("URLPattern class inherits normally and exposes canonical strings without descriptor mutation", (t) => {
  runtime(t);
  class Route extends URLPattern {}
  const route = new Route({ pathname: "/:id" });
  assert.equal(route instanceof URLPattern, true);
  assert.equal(Object.prototype.toString.call(route), "[object URLPattern]");
  assert.equal(URLPattern.length, 0);
  assert.equal(URLPattern.prototype.test.length, 0);
  assert.equal(URLPattern.prototype.exec.length, 0);
});

test("WPT assert_implements passes truthy capabilities and records false as failure", async () => {
  const harness = new WptHarness({});
  harness.run('test(() => assert_implements(1), "present"); test(() => assert_implements(0), "absent");', "implements.js");
  assert.deepEqual((await harness.finish()).map((entry) => entry.status), ["pass", "fail"]);
});

test("WPT implicit completion drains tests registered by pending promise and async tests", async () => {
  const harness = new WptHarness({});
  harness.run(`
    promise_test(async () => {
      await Promise.resolve();
      test(() => assert_true(true), "sync child");
      promise_test(async () => { await Promise.resolve(); test(() => {}, "grandchild"); }, "promise child");
      const child = async_test("async child");
      child.step_timeout(() => { test(() => {}, "task child"); child.done(); }, 0);
    }, "loader");
  `, "nested.js");
  const results = await harness.finish();
  assert.equal(results.length, 6);
  assert.ok(results.every((entry) => entry.status === "pass"));
});

test("WPT nested failures still fail and explicit done still refuses further registration", async () => {
  const harness = new WptHarness({});
  harness.run('promise_test(async () => { await Promise.resolve(); test(() => assert_unreached("broken"), "child"); }, "loader");', "nested-fail.js");
  assert.deepEqual((await harness.finish()).map((entry) => entry.status), ["pass", "fail"]);
  const closed = new WptHarness({});
  closed.run('setup({explicit_done:true}); test(() => {}, "first"); done(); test(() => {}, "late");', "closed.js");
  await assert.rejects(closed.finish(), AggregateError);
});

test("WPT implicit draining keeps promise timeouts and stale exclusion checks", async () => {
  const harness = new WptHarness({}, {}, 1000);
  harness.run('promise_test(() => new Promise(() => {}), "never settles");', "timeout.js");
  await assert.rejects(harness.finish(), (error) => error instanceof AggregateError &&
    error.errors.some((entry: unknown) => String(entry).includes("pending tests did not complete")));
  const stale = new WptHarness({}, { missing: { category: "provider-capability", reason: "test" } });
  stale.run('test(() => {}, "actual");', "stale.js");
  await assert.rejects(stale.finish(), /stale WPT capability exclusion/);
});

test("WPT recursive asynchronous registration fails at its inventory bound without waiting for a timer", async () => {
  let executed = 0;
  const harness = new WptHarness({ count() { executed++; } }, {}, 10000, { maxTests: 3 });
  harness.run(`
    let index = 0;
    function next() {
      promise_test(async () => { count(); next(); }, "generated " + index++);
    }
    next();
  `, "unbounded.js");
  await assert.rejects(harness.finish(), (error) => error instanceof AggregateError &&
    error.errors.some((entry: unknown) => String(entry).includes("declared inventory limit")));
  assert.equal(executed, 3);
  assert.throws(() => new WptHarness({}, {}, 10000, { maxTests: 0 }), /maxTests/);
});

test("WPT duplicate registration remains a harness failure when a provider consumes its exception", async () => {
  const caught: unknown[] = [];
  const harness = new WptHarness({
    dispatch(callback: () => void) { try { callback(); } catch (error) { caught.push(error); } },
  }, {}, 1000, { maxTests: 2 });
  harness.run(`
    test(() => {}, "first");
    dispatch(() => test(() => {}, "first"));
    test(() => {}, "second");
  `, "caught-duplicate.js");
  assert.equal(caught.length, 1);
  await assert.rejects(harness.finish(), (error) => error instanceof AggregateError &&
    error.errors.includes(caught[0]));
});

test("WPT after-done registration remains a harness failure when a provider consumes its exception", async () => {
  const caught: unknown[] = [];
  const harness = new WptHarness({
    dispatch(callback: () => void) { try { callback(); } catch (error) { caught.push(error); } },
  }, {}, 1000, { maxTests: 1 });
  harness.run(`
    setup({ explicit_done: true });
    test(() => {}, "first");
    done();
    dispatch(() => test(() => {}, "late"));
  `, "caught-after-done.js");
  assert.equal(caught.length, 1);
  await assert.rejects(harness.finish(), (error) => error instanceof AggregateError &&
    error.errors.includes(caught[0]));
});
