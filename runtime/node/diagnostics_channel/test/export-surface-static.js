// `diagnostics_channel`'s six names, in both directions.
//
// The module compiles and publishes **zero of six**, and every one is refused
// through a single field: `#map = new Map<string | symbol, WeakRef<Channel>>()`.
// `Map` is representable -- the two sibling `Map` fields beside it are not
// refused -- so it is `WeakRef` alone, filed as `blockers/weakref-property`.
//
// So this cannot run against the addon today. It is written now because the
// module needs two separate things to land -- a weak reference the collector
// honours, and `export-class` for `Channel` and `TracingChannel` -- and when the
// first arrives without the second, the interesting question is which half
// moved.
//
// Node's values come from a child `node -p`: inside this harness
// `require("node:diagnostics_channel")` and `require("diagnostics_channel")` are
// the same object, so an oracle taken that way compares a thing with itself.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const dc = require("diagnostics_channel");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const expected = fromRealNode('Object.keys(require("node:diagnostics_channel")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:diagnostics_channel"))' +
    '.map((k) => [k, typeof require("node:diagnostics_channel")[k]]))',
);

assert.ok(
  expected.length >= 5,
  `node's diagnostics_channel exports ${expected.length} names, too few to be real`,
);

const actual = new Set(Object.keys(dc));
const missing = expected.filter((name) => !actual.has(name));
assert.deepStrictEqual(missing, [], `missing name(s) node has: ${missing.join(", ")}`);

for (const name of expected) {
  assert.strictEqual(
    typeof dc[name],
    nodeTypes[name],
    `diagnostics_channel.${name} is ${typeof dc[name]}, node's is ${nodeTypes[name]}`,
  );
}

const extra = [...actual].filter((name) => !expected.includes(name)).sort();
assert.deepStrictEqual(extra, [], `publishes name(s) node does not: ${extra.join(", ")}`);

// The behaviour the weak map exists for, and the reason its rewrite was
// declined: `channel(name)` returns the **same** object for the same name. A
// registry that made a fresh Channel per call would satisfy every check above
// and silently give every subscriber its own channel.
const first = dc.channel("nts.surface.probe");
const again = dc.channel("nts.surface.probe");
assert.strictEqual(first, again, "channel() returned a different object for the same name");
assert.strictEqual(typeof first.publish, "function");

// And that subscription reaches a subscriber, so a `Channel` of the right shape
// and inert cannot pass.
let seen = 0;
const listener = () => { seen++; };
dc.subscribe("nts.surface.probe", listener);
assert.strictEqual(dc.hasSubscribers("nts.surface.probe"), true);
first.publish({});
assert.strictEqual(seen, 1, "publish did not reach the subscriber");
dc.unsubscribe("nts.surface.probe", listener);
assert.strictEqual(dc.hasSubscribers("nts.surface.probe"), false);
