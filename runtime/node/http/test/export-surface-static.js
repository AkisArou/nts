// `http`'s surface, and one node-internal name.
//
// Twenty of node's twenty-one. `shape.mjs` already deletes three of our own
// names that node does not have -- `getHTTPParserPoolLimit` and the two global
// agent accessors -- and installs `globalAgent` as a real accessor pair, so the
// interesting question here is the other direction.
//
// Node's answers come from a child `node -p`: inside this harness
// `require("node:http")` and `require("http")` are the same object.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const mod = require("http");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const nodeKeys = fromRealNode('Object.keys(require("node:http")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:http"))' +
    '.map((k) => [k, typeof require("node:http")[k]]))',
);
// A function's `name` is not always the key it is filed under -- an alias is
// the same object under a second key, and carries the original's name. Reading
// node's answer rather than assuming the key is what makes this safe for
// aliases; assuming cost this file its first failure, against a correct module.
const nodeNames = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:http"))' +
    '.filter((k) => typeof require("node:http")[k] === "function")' +
    '.map((k) => [k, require("node:http")[k].name]))',
);
// Which keys hold the *same object* in node. Each key maps to the first key
// (in sorted order) holding an identical value, so aliases share a
// representative and the whole grouping compares with one assertion.
const nodeAliases = fromRealNode(
  '(() => { const m = require("node:http"); const ks = Object.keys(m).sort();' +
    ' return Object.fromEntries(ks.map((k) => [k, ks.find((j) => m[j] === m[k])])); })()',
);

assert.ok(
  nodeKeys.length >= 18,
  `node's http exports ${nodeKeys.length} names, too few to be the surface this pins`,
);

const ours = new Set(Object.keys(mod));

// Absent, deliberately pinned so the list cannot widen unnoticed.
//   _connectionListener    node-internal; `https` reaches into `http` for it.
//                          Not written.
const ABSENT = [
  "_connectionListener",
];

const missing = nodeKeys.filter((name) => !ours.has(name));
assert.deepStrictEqual(
  missing,
  ABSENT,
  `http's difference from node is [${missing.join(", ")}], not the pinned [${ABSENT.join(", ")}]`,
);

const extra = [...ours].filter((name) => !nodeKeys.includes(name)).sort();
assert.deepStrictEqual(extra, [], `http publishes name(s) node does not: ${extra.join(", ")}`);

for (const name of nodeKeys) {
  if (ABSENT.includes(name)) continue;
  assert.strictEqual(
    typeof mod[name],
    nodeTypes[name],
    `http.${name} is ${typeof mod[name]}, node's is ${nodeTypes[name]}`,
  );
  if (nodeTypes[name] === "function") {
    assert.strictEqual(
      mod[name].name,
      nodeNames[name],
      `http.${name}.name is ${JSON.stringify(mod[name].name)}, node's is ${JSON.stringify(nodeNames[name])}`,
    );
  }
}

// **The aliases**, which node's own tests have no reason to assert: on node two
// keys holding one object are the same object by construction. An artifact that
// published two distinct functions with the right names and the right behaviour
// would pass everything above and still be wrong -- a caller replacing
// `http.X` would not change what the other key sees.
const present = nodeKeys.filter((name) => !ABSENT.includes(name));
for (const name of present) {
  const rep = nodeAliases[name];
  if (rep === name || ABSENT.includes(rep)) continue;
  assert.strictEqual(
    mod[name],
    mod[rep],
    `http.${name} and http.${rep} are the same object on node and are not here`,
  );
}
