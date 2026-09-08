// `util`'s surface, and the eight names that are not on it.
//
// Node exports 34. We publish 26. The eight below are **absent, not shaped
// away**, and no decision has been recorded about any of them -- which is the
// reason this file pins the list rather than asserting the surface matches.
// A pinned list that cannot widen is worth more than a test that would have to
// be deleted to add the ninth.
//
// Node ships no test that enumerates `util`, so none of this could fail
// upstream and none of it was visible here until this file existed.
//
// Node's answers come from a child `node -p`: inside this harness
// `require("node:util")` and `require("util")` are the same object.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const mod = require("util");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const nodeKeys = fromRealNode('Object.keys(require("node:util")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:util"))' +
    '.map((k) => [k, typeof require("node:util")[k]]))',
);
// A function's `name` is not always the key it is filed under -- an alias is
// the same object under a second key, and carries the original's name. Reading
// node's answer rather than assuming the key is what makes this safe for
// aliases; assuming cost this file its first failure, against a correct module.
const nodeNames = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:util"))' +
    '.filter((k) => typeof require("node:util")[k] === "function")' +
    '.map((k) => [k, require("node:util")[k].name]))',
);
// Which keys hold the *same object* in node. Each key maps to the first key
// (in sorted order) holding an identical value, so aliases share a
// representative and the whole grouping compares with one assertion.
const nodeAliases = fromRealNode(
  '(() => { const m = require("node:util"); const ks = Object.keys(m).sort();' +
    ' return Object.fromEntries(ks.map((k) => [k, ks.find((j) => m[j] === m[k])])); })()',
);

assert.ok(
  nodeKeys.length >= 30,
  `node's util exports ${nodeKeys.length} names, too few to be the surface this pins`,
);

const ours = new Set(Object.keys(mod));

// Absent, deliberately pinned so the list cannot widen unnoticed.
// Why each is absent, so the list is a record and not a bucket:
//
//   MIMEType, MIMEParams   an RFC 2045 parser, not written
//   getCallSites           reads V8 stack frames; no representation here
//   inherits               prototype surgery is what the API *is*, and this
//                          profile does not do prototype surgery
//   _extend                deprecated in node since v6; nothing needs it yet
//   setTraceSigInt         internal tracing hook
//   transferableAbortController, transferableAbortSignal
//                          structured-clone integration, which the Abort
//                          implementation here does not have
const ABSENT = [
  "MIMEParams",
  "MIMEType",
  "_extend",
  "getCallSites",
  "inherits",
  "setTraceSigInt",
  "transferableAbortController",
  "transferableAbortSignal",
];

const missing = nodeKeys.filter((name) => !ours.has(name));
assert.deepStrictEqual(
  missing,
  ABSENT,
  `util's difference from node is [${missing.join(", ")}], not the pinned [${ABSENT.join(", ")}]`,
);

const extra = [...ours].filter((name) => !nodeKeys.includes(name)).sort();
assert.deepStrictEqual(extra, [], `util publishes name(s) node does not: ${extra.join(", ")}`);

for (const name of nodeKeys) {
  if (ABSENT.includes(name)) continue;
  assert.strictEqual(
    typeof mod[name],
    nodeTypes[name],
    `util.${name} is ${typeof mod[name]}, node's is ${nodeTypes[name]}`,
  );
  if (nodeTypes[name] === "function") {
    assert.strictEqual(
      mod[name].name,
      nodeNames[name],
      `util.${name}.name is ${JSON.stringify(mod[name].name)}, node's is ${JSON.stringify(nodeNames[name])}`,
    );
  }
}

// **The aliases**, which node's own tests have no reason to assert: on node two
// keys holding one object are the same object by construction. An artifact that
// published two distinct functions with the right names and the right behaviour
// would pass everything above and still be wrong -- a caller replacing
// `util.X` would not change what the other key sees.
const present = nodeKeys.filter((name) => !ABSENT.includes(name));
for (const name of present) {
  const rep = nodeAliases[name];
  if (rep === name || ABSENT.includes(rep)) continue;
  assert.strictEqual(
    mod[name],
    mod[rep],
    `util.${name} and util.${rep} are the same object on node and are not here`,
  );
}
