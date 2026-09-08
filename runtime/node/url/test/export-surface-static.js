// `url`'s exported names, and three identities that are not names.
//
// The module compiles and publishes **zero**. Its wrapper diagnostics split
// 3 / 10 / 2: three the backend cannot name -- `URL`, `URLSearchParams`, `Url`
// -- and ten functions that were never compiled.
//
// The name half of this duplicates what `audit.mjs --exports` already tracks in
// the ledger's missing-export register. What it adds is the other half: three
// things about this surface that no list of names can state, and that node's own
// tests mostly do not check because on node they cannot fail.
//
// Node's answers come from a child `node -p`: inside this harness
// `require("node:url")` and `require("url")` are the same object.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const url = require("url");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const expected = fromRealNode('Object.keys(require("node:url")).sort()');

assert.ok(
  expected.length >= 12,
  `node's url exports ${expected.length} names, too few to be real`,
);

// Two names this profile does not implement, both already in the ledger's
// missing-export register under `url`. Excluded here rather than silently
// passing, so that the register stays the one place they are tracked and this
// file does not become a second list to keep in step.
const notImplemented = new Set(["URLPattern", "fileURLToPathBuffer"]);

const actual = new Set(Object.keys(url));
const missing = expected.filter((name) => !actual.has(name) && !notImplemented.has(name));
assert.deepStrictEqual(missing, [], `url is missing name(s) node has: ${missing.join(", ")}`);

// **`URLSearchParams` is web-platform's class, and `URL` is this lane's.**
// `runtime/web-platform` has no `URL` at all. Both must nonetheless be the same
// objects the globals are, or a program that constructs one and passes it to the
// other gets an instance the receiver does not recognise.
assert.strictEqual(typeof url.URL, "function");
assert.strictEqual(typeof url.URLSearchParams, "function");
assert.strictEqual(url.URL, globalThis.URL, "url.URL is not the global URL");
assert.strictEqual(
  url.URLSearchParams,
  globalThis.URLSearchParams,
  "url.URLSearchParams is not the global URLSearchParams",
);

// **`searchParams` is live and owned.** A `URL` whose `searchParams` returned a
// fresh detached object each time would satisfy every type check and silently
// drop every mutation.
const made = new url.URL("https://example.test/p?a=1");
const params = made.searchParams;
assert.strictEqual(params, made.searchParams, "searchParams is not the same object twice");
params.set("b", "2");
assert.strictEqual(made.href, "https://example.test/p?a=1&b=2");

// **`parse` and `format` round-trip through the legacy shape**, which is a
// different object from `URL` and is the half node keeps for compatibility.
const legacy = url.parse("https://example.test/p?a=1");
assert.strictEqual(legacy.protocol, "https:");
assert.strictEqual(legacy.pathname, "/p");
assert.strictEqual(url.format(legacy), "https://example.test/p?a=1");

// And `fileURLToPath` accepts both a string and a `URL`, which is the one place
// the two halves of this module have to agree with each other.
assert.strictEqual(url.fileURLToPath("file:///tmp/x"), "/tmp/x");
assert.strictEqual(url.fileURLToPath(new url.URL("file:///tmp/x")), "/tmp/x");
