// `net`'s surface, and two node-internal names.
//
// Both absent names are node's own plumbing rather than public API, and both
// are reachable from node's tests, so neither is safe to call "not ours" --
// they are simply not written. Pinned so the list cannot widen.
//
// Node's answers come from a child `node -p`: inside this harness
// `require("node:net")` and `require("net")` are the same object.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const mod = require("net");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const nodeKeys = fromRealNode('Object.keys(require("node:net")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:net"))' +
    '.map((k) => [k, typeof require("node:net")[k]]))',
);
// A function's `name` is not always the key it is filed under -- an alias is
// the same object under a second key, and carries the original's name. Reading
// node's answer rather than assuming the key is what makes this safe for
// aliases; assuming cost this file its first failure, against a correct module.
const nodeNames = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:net"))' +
    '.filter((k) => typeof require("node:net")[k] === "function")' +
    '.map((k) => [k, require("node:net")[k].name]))',
);
// Which keys hold the *same object* in node. Each key maps to the first key
// (in sorted order) holding an identical value, so aliases share a
// representative and the whole grouping compares with one assertion.
const nodeAliases = fromRealNode(
  '(() => { const m = require("node:net"); const ks = Object.keys(m).sort();' +
    ' return Object.fromEntries(ks.map((k) => [k, ks.find((j) => m[j] === m[k])])); })()',
);

assert.ok(
  nodeKeys.length >= 15,
  `node's net exports ${nodeKeys.length} names, too few to be the surface this pins`,
);

const ours = new Set(Object.keys(mod));

// Absent, deliberately pinned so the list cannot widen unnoticed.
//   _createServerHandle    cluster's, the same shape as dgram's
//                          `_createSocketHandle`, which `shape.mjs` argues
//                          should be absent rather than a throwing stand-in
//   _normalizeArgs         node-internal argument coercion shared with
//                          child_process
const ABSENT = [
  "_createServerHandle",
  "_normalizeArgs",
];

const missing = nodeKeys.filter((name) => !ours.has(name));
assert.deepStrictEqual(
  missing,
  ABSENT,
  `net's difference from node is [${missing.join(", ")}], not the pinned [${ABSENT.join(", ")}]`,
);

const extra = [...ours].filter((name) => !nodeKeys.includes(name)).sort();
assert.deepStrictEqual(extra, [], `net publishes name(s) node does not: ${extra.join(", ")}`);

for (const name of nodeKeys) {
  if (ABSENT.includes(name)) continue;
  assert.strictEqual(
    typeof mod[name],
    nodeTypes[name],
    `net.${name} is ${typeof mod[name]}, node's is ${nodeTypes[name]}`,
  );
  if (nodeTypes[name] === "function") {
    assert.strictEqual(
      mod[name].name,
      nodeNames[name],
      `net.${name}.name is ${JSON.stringify(mod[name].name)}, node's is ${JSON.stringify(nodeNames[name])}`,
    );
  }
}

// **The aliases**, which node's own tests have no reason to assert: on node two
// keys holding one object are the same object by construction. An artifact that
// published two distinct functions with the right names and the right behaviour
// would pass everything above and still be wrong -- a caller replacing
// `net.X` would not change what the other key sees.
const present = nodeKeys.filter((name) => !ABSENT.includes(name));
for (const name of present) {
  const rep = nodeAliases[name];
  if (rep === name || ABSENT.includes(rep)) continue;
  assert.strictEqual(
    mod[name],
    mod[rep],
    `net.${name} and net.${rep} are the same object on node and are not here`,
  );
}
