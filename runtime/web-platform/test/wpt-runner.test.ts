// Negative controls for the shared fixture loader. These tiny local inputs test
// adapter integrity and are not represented as upstream conformance cases.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import test from "node:test";
import type { TestContext } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WptHarness } from "./wpt/harness.ts";
import { executeWptFixture, loadWptFixtures, runWptFixtures } from "./wpt/runner.ts";
import type { WptFixture, WptManifest, WptRunnerOptions, WptSource } from "./wpt/runner.ts";

import type { WptVersions } from "./wpt/versions.ts";

function corpus(t: TestContext): {
  root: URL;
  manifest: WptManifest;
  versions: WptVersions;
  support(path: string, content: string | Buffer): WptSource;
  fixture(path: string, content: string | Buffer, fields?: Partial<WptFixture>): WptFixture;
} {
  const directory = mkdtempSync(join(tmpdir(), "nts-wpt-runner-"));
  const root = pathToFileURL(directory + sep);
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const versions: WptVersions = { version: 1, directories: { "": "a".repeat(40) }, files: {} };
  const pin = (path: string, content: string | Buffer): WptSource => {
    const bytes = Buffer.from(content);
    const file = fileURLToPath(new URL(path, root));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes);
    versions.files[path] = {
      sha256: createHash("sha256").update(bytes).digest("hex"),
      gitBlob: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
    };
    writeFileSync(new URL("versions.json", root), JSON.stringify(versions));
    return { path };
  };
  const manifest: WptManifest = {
    fixtures: [], support: [],
    license: pin("LICENSE.md", "Local adapter control, not an upstream fixture.\n"),
  };
  return {
    root, manifest, versions,
    support(path, content) {
      const source = pin(path, content);
      manifest.support.push(source);
      return source;
    },
    fixture(path, content, fields = {}) {
      const fixture: WptFixture = {
        ...pin(path, content), format: "javascript", support: [], harnessScripts: [],
        expectedTests: 1, blockedTests: {}, ...fields,
      };
      manifest.fixtures.push(fixture);
      return fixture;
    },
  };
}

test("WPT substitutions see verified originals and cannot conceal changed source bytes", (t) => {
  const files = corpus(t);
  const supportText = 'const host = "{{host}}";';
  const fixtureText = '// META: script=constants.sub.js\ntest(() => assert_equals(host,"{{host}}"),"host");';
  const support = files.support("network/constants.sub.js", supportText);
  const fixture = files.fixture("network/example.any.js", fixtureText, { support: [support.path] });
  const calls: string[] = [];
  const options: WptRunnerOptions = {
    transformScript(text, script) { calls.push(script.kind + ":" + script.path); return text.replaceAll("{{host}}", "web-platform.test"); },
  };
  const prepared = loadWptFixtures(files.root, files.manifest, options);
  assert.deepEqual(calls, ["support:network/constants.sub.js", "fixture:network/example.any.js"]);
  assert.ok(prepared[0]?.scripts.every((script) => !script.source.includes("{{host}}")));
  assert.equal(readFileSync(new URL(support.path, files.root), "utf8"), supportText);
  assert.equal(readFileSync(new URL(fixture.path, files.root), "utf8"), fixtureText);

  for (const source of [fixture, support, files.manifest.license]) {
    const file = new URL(source.path, files.root);
    const original = readFileSync(file);
    writeFileSync(file, Buffer.concat([original, Buffer.from("\nchanged")]));
    calls.length = 0;
    assert.throws(() => loadWptFixtures(files.root, files.manifest, options));
    assert.deepEqual(calls, [], "no substitution ran before original-byte verification");
    writeFileSync(file, original);
  }
  files.versions.files[fixture.path]!.gitBlob = "0".repeat(40);
  writeFileSync(new URL("versions.json", files.root), JSON.stringify(files.versions));
  assert.throws(() => loadWptFixtures(files.root, files.manifest, options), /upstream blob changed/);
});

test("WPT dependency mapping is checked before a transform can rewrite META comments", (t) => {
  const files = corpus(t);
  files.support("area/first.js", "");
  files.support("area/second.js", "");
  const fixture = files.fixture("area/example.any.js", "// META: script=first.js\ntest(() => {});", {
    support: ["area/second.js"],
  });
  let transformed = false;
  const options: WptRunnerOptions = { transformScript(source) { transformed = true; return source.replace("first.js", "second.js"); } };
  assert.throws(() => loadWptFixtures(files.root, files.manifest, options), /must match pinned dependencies/);
  assert.equal(transformed, false);
  fixture.support = ["area/first.js"];
  files.manifest.support.splice(0, 1);
  assert.throws(() => loadWptFixtures(files.root, files.manifest, options), /unpinned support script/);
  assert.equal(transformed, false);
});

test("WPT fixture metadata, declared variants and deadline categories reach the environment", (t) => {
  const files = corpus(t);
  const fixture = files.fixture("area/nested/example.any.js", [
    "// META: title=Network case", "// META: timeout=long", "// META: global=window,worker",
    "// META: variant=?default", "// META: variant=?wss", "test(() => {});",
  ].join("\n"), { variant: "?wss" });
  const options: WptRunnerOptions = {
    baseURL: "https://web-platform.test:9443/ignored/base/",
    timeouts: { default: 111, long: 222, network: 333, reconnect: 444 }, timeoutCategory: "network",
  };
  const context = loadWptFixtures(files.root, files.manifest, options)[0]?.context;
  assert.ok(context);
  assert.equal(context.url.href, "https://web-platform.test:9443/area/nested/example.any.js?wss");
  assert.deepEqual(context.metadata, {
    title: "Network case", timeout: "long", globals: ["window", "worker"], variants: ["?default", "?wss"], scripts: [],
  });
  assert.equal(context.timeoutMilliseconds, 333);
  fixture.timeoutCategory = "reconnect";
  assert.equal(loadWptFixtures(files.root, files.manifest, options)[0]?.context.timeoutMilliseconds, 444);
  options.timeouts = { long: 555, reconnect: 100 };
  assert.equal(loadWptFixtures(files.root, files.manifest, options)[0]?.context.timeoutMilliseconds, 555,
    "network allowances must not shorten the declared long budget");
  fixture.variant = "?undeclared";
  assert.throws(() => loadWptFixtures(files.root, files.manifest, options), /variant is not declared/);
  fixture.variant = "?default";
  for (const value of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => loadWptFixtures(files.root, files.manifest, { timeouts: { network: value } }), /positive integer/);
  }
});

test("WPT rejects malformed metadata and paths instead of dropping their constraints", (t) => {
  for (const source of ["// META: timeout=short", "// META: timeout=long\n// META: timeout=long", "// META: variant=/elsewhere"]) {
    const files = corpus(t);
    files.fixture("area/example.any.js", source);
    assert.throws(() => loadWptFixtures(files.root, files.manifest));
  }
  const files = corpus(t);
  const fixture = files.fixture("example.any.js", "test(() => {});");
  fixture.path = "../example.any.js";
  assert.throws(() => loadWptFixtures(files.root, files.manifest), /noncanonical WPT source path/);
});

test("WPT HTML loads pinned external scripts in source order with an async environment", async (suite) => {
  const files = corpus(suite);
  files.support("support/constants.sub.js", 'record("external"); const host = "{{host}}";');
  files.fixture("area/ordered.html", [
    "<!doctype html><title>Network title</title>",
    '<meta name="timeout" content="long"><meta name="variant" content="?wss">',
    '<script src="/resources/testharness.js"></script>',
    '<script>record("before");</script>',
    '<script type="text/javascript" src="../support/constants.sub.js"></script>',
    '<script>test(() => { record("after"); assert_equals(host,"web-platform.test");',
    'assert_equals(self,globalThis); assert_equals(location.search,"?wss");',
    'assert_false("process" in self); assert_equals(typeof document,"undefined"); },"ordered");</script>',
    '<script src="/resources/testharnessreport.js"></script>',
  ].join("\n"), {
    format: "html", variant: "?wss", support: ["support/constants.sub.js"],
    harnessScripts: ["/resources/testharness.js", "/resources/testharnessreport.js"],
  });
  const order: string[] = [];
  const urls: string[] = [];
  await runWptFixtures(suite, files.root, files.manifest, async (_report, context) => {
    await Promise.resolve();
    assert.equal(context.metadata.title, "Network title");
    assert.equal(context.timeoutMilliseconds, 120_000);
    return {
      globals: { location: context.url, record: (entry: string) => { order.push(entry); } },
      globalAliases: ["self"],
      async close() { await Promise.resolve(); order.push("closed"); },
    };
  }, {
    baseURL: "https://web-platform.test:9443/base/", timeouts: { long: 120_000 },
    transformScript(source, script) { urls.push(script.url.href); return source.replaceAll("{{host}}", "web-platform.test"); },
  });
  assert.deepEqual(order, ["before", "external", "after", "closed"]);
  assert.deepEqual(urls, [
    "https://web-platform.test:9443/area/ordered.html?wss",
    "https://web-platform.test:9443/support/constants.sub.js",
    "https://web-platform.test:9443/area/ordered.html?wss",
  ]);
});

test("WPT HTML dependencies and unsupported execution modes fail before scripts run", (t) => {
  for (const script of [
    '<script src="missing.js"></script>',
    '<script src="https://other.test/source.js"></script>',
    '<script async src="support.js"></script>',
    '<script type="module">test(() => {});</script>',
  ]) {
    const files = corpus(t);
    files.fixture("area/example.html", script, { format: "html" });
    let transformed = false;
    assert.throws(() => loadWptFixtures(files.root, files.manifest, {
      transformScript(source) { transformed = true; return source; },
    }));
    assert.equal(transformed, false);
  }
  const files = corpus(t);
  files.support("area/first.js", "");
  files.support("area/second.js", "");
  files.fixture("area/order.html", '<script src="first.js"></script><script src="second.js"></script>', {
    format: "html", support: ["area/second.js", "area/first.js"],
  });
  assert.throws(() => loadWptFixtures(files.root, files.manifest), /must match pinned dependencies/);
});

test("WPT HTML charset decoding preserves verified Windows-1252 bytes", async (suite) => {
  const files = corpus(suite);
  const bytes = Buffer.concat([
    Buffer.from('<meta charset="windows-1252"><script>test(() => assert_equals("'),
    Buffer.from([0x80, 0xe9]), Buffer.from('", expected), "legacy charset");</script>'),
  ]);
  const fixture = files.fixture("area/legacy.html", bytes, { format: "html" });
  await runWptFixtures(suite, files.root, files.manifest, () => ({
    globals: { expected: "\u20ac\u00e9" }, close() {},
  }));
  assert.deepEqual(readFileSync(new URL(fixture.path, files.root)), bytes);
  const javascript = corpus(suite);
  javascript.fixture("area/utf8.any.js", Buffer.from([0x80]));
  assert.equal(loadWptFixtures(javascript.root, javascript.manifest)[0]?.scripts[0]?.source, "\ufffd",
    "JavaScript files retain their UTF-8 decoding");
});

test("WPT self aliases the real VM global and cannot replace supplied APIs", async () => {
  class CanonicalWebSocket {}
  const harness = new WptHarness({ WebSocket: CanonicalWebSocket }, {}, 60_000, ["self"]);
  harness.run('test(() => { assert_equals(self,globalThis); assert_equals(self.WebSocket,WebSocket); assert_equals(self.Object,Object); },"alias");', "alias.js");
  assert.equal((await harness.finish())[0]?.status, "pass");
  for (const alias of ["Object", "WebSocket", "assert_equals", "bad.name"]) {
    assert.throws(() => new WptHarness({ WebSocket: CanonicalWebSocket }, {}, 60_000, [alias]));
  }
  assert.throws(() => new WptHarness({}, {}, 60_000, ["self", "self"]));
});

test("WPT numeric and regular-expression assertions preserve upstream type checks", async () => {
  const harness = new WptHarness({});
  harness.run(`
    test(() => assert_greater_than(2,1), "number");
    test(() => assert_greater_than_equal(2n,2n), "bigint equal");
    test(() => assert_greater_than("2",1), "string");
    test(() => assert_greater_than(2,1n), "mixed numeric types");
    test(() => assert_greater_than(new Number(2),1), "boxed number");
    test(() => assert_greater_than_equal(NaN,1), "NaN");
    test(() => assert_greater_than(1,1), "strict inequality");
    test(() => assert_regexp_match("protocol",/^pro/), "regexp match");
    test(() => assert_regexp_match("protocol",/^bad/), "regexp mismatch");
  `, "network-assertions.js");
  assert.deepEqual((await harness.finish()).map((result) => result.status), [
    "pass", "pass", "fail", "fail", "fail", "fail", "fail", "pass", "fail",
  ]);
});

test("WPT base origins are selected separately for secure and ordinary fixtures", (t) => {
  const files = corpus(t);
  files.fixture("area/normal.any.js", "test(() => {});");
  files.fixture("area/secure.https.any.js", "test(() => {});");
  const result = loadWptFixtures(files.root, files.manifest, {
    baseURL: (fixture) => fixture.path.includes(".https.")
      ? "https://web-platform.test:9443/" : "http://web-platform.test:8000/",
  });
  assert.deepEqual(result.map((entry) => entry.context.url.href), [
    "http://web-platform.test:8000/area/normal.any.js",
    "https://web-platform.test:9443/area/secure.https.any.js",
  ]);
});

test("WPT literal importScripts loads verified dependencies synchronously without worker stubs", async (t) => {
  const files = corpus(t);
  files.support("area/constants.sub.js", 'record("dependency"); const host = "{{host}}";');
  files.fixture("area/example.worker.js", [
    'importScripts("/resources/testharness.js");',
    'importScripts("constants.sub.js");',
    'test(() => { record("fixture"); assert_equals(host,"local.test");',
    'assert_equals(self,globalThis); assert_equals(typeof WorkerGlobalScope,"undefined"); },"loaded");',
    'done();',
  ].join("\n"), {
    support: ["area/constants.sub.js"], harnessScripts: ["/resources/testharness.js"],
    importScripts: ["resources/testharness.js", "area/constants.sub.js"],
  });
  const prepared = loadWptFixtures(files.root, files.manifest, {
    transformScript: (source) => source.replaceAll("{{host}}", "local.test"),
  })[0];
  assert.ok(prepared);
  const order: string[] = [];
  const results = await executeWptFixture(prepared, () => ({
    globals: { record: (entry: string) => { order.push(entry); } }, globalAliases: ["self"],
    close() { order.push("closed"); },
  }));
  assert.deepEqual(results.map((result) => result.status), ["pass"]);
  assert.deepEqual(order, ["dependency", "fixture", "closed"]);
});

test("WPT importScripts rejects changed, missing or unconsumed dependency declarations", async (t) => {
  const files = corpus(t);
  files.support("area/first.js", "");
  files.support("area/second.js", "");
  const fixture = files.fixture("area/example.worker.js", 'importScripts("first.js");\ntest(() => {});', {
    support: ["area/first.js"], importScripts: ["area/first.js"],
  });
  fixture.importScripts = ["area/second.js"];
  let transformed = false;
  assert.throws(() => loadWptFixtures(files.root, files.manifest, {
    transformScript(source) { transformed = true; return source.replace("first.js", "second.js"); },
  }), /declarations must match/);
  assert.equal(transformed, false);
  fixture.importScripts = ["area/first.js"];
  for (const transform of [
    (source: string) => source.replace('importScripts("first.js");', 'importScripts("second.js");'),
    (source: string) => source.replace('importScripts("first.js");', ""),
    (source: string) => source.replace('importScripts("first.js");', 'importScripts("first.js"); importScripts("first.js");'),
  ]) {
    const prepared = loadWptFixtures(files.root, files.manifest, { transformScript: transform })[0];
    assert.ok(prepared);
    let closed = false;
    await assert.rejects(executeWptFixture(prepared, () => ({ globals: {}, close() { closed = true; } })));
    assert.equal(closed, true, "a loader failure still closes its provider environment");
  }
});

test("WPT importScripts refuses computed arguments and an environment replacement", async (t) => {
  const files = corpus(t);
  files.support("area/first.js", "");
  files.fixture("area/computed.worker.js", 'const dependency = "first.js";\nimportScripts(dependency);', {
    support: ["area/first.js"], importScripts: ["area/first.js"],
  });
  assert.throws(() => loadWptFixtures(files.root, files.manifest), /literal URL arguments/);
  files.manifest.fixtures.length = 0;
  files.fixture("area/literal.worker.js", 'importScripts("first.js");\ntest(() => {});', {
    support: ["area/first.js"], importScripts: ["area/first.js"],
  });
  const prepared = loadWptFixtures(files.root, files.manifest)[0];
  assert.ok(prepared);
  await assert.rejects(executeWptFixture(prepared, () => ({ globals: { importScripts() {} }, close() {} })),
    /must not replace the verified/);
});

test("WPT provider startup errors are retained before the harness exists", async (t) => {
  const files = corpus(t);
  files.fixture("area/example.any.js", "test(() => {});");
  const prepared = loadWptFixtures(files.root, files.manifest)[0];
  assert.ok(prepared);
  let closed = false;
  const failure = new Error("provider startup failed");
  await assert.rejects(executeWptFixture(prepared, (reportError) => {
    reportError(failure);
    return { globals: {}, close() { closed = true; } };
  }), (error: unknown) => error instanceof AggregateError && error.errors.includes(failure));
  assert.equal(closed, true);
});
