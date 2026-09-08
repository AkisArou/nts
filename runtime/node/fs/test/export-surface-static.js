// `fs`'s surface: all 104 of node's names.
//
// The gap this file was written to find turned out not to exist, and the first
// failure it produced was **its own bug**. It asserted `fs.FileReadStream.name
// === "FileReadStream"`, which is false -- and false on node too, because
// `fs.FileReadStream` *is* `fs.ReadStream`, the same function object under a
// second key. Comparing a function's name to the key it is filed under is only
// correct for modules without aliases.
//
// So the check compares against node's own `.name`, and the alias identities
// are pinned separately below. That second check is the one node's tests could
// never need: on node the aliases are the same object by construction, and a
// compiled artifact publishing two distinct functions with the right names and
// the right behaviour would satisfy everything else in this file.
//
// Node's answers come from a child `node -p`: inside this harness
// `require("node:fs")` and `require("fs")` are the same object.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const mod = require("fs");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const nodeKeys = fromRealNode('Object.keys(require("node:fs")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:fs"))' +
    '.map((k) => [k, typeof require("node:fs")[k]]))',
);
// A function's `name` is not always the key it is filed under -- an alias is
// the same object under a second key, and carries the original's name. Reading
// node's answer rather than assuming the key is what makes this safe for
// aliases; assuming cost this file its first failure, against a correct module.
const nodeNames = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:fs"))' +
    '.filter((k) => typeof require("node:fs")[k] === "function")' +
    '.map((k) => [k, require("node:fs")[k].name]))',
);
// Which keys hold the *same object* in node. Each key maps to the first key
// (in sorted order) holding an identical value, so aliases share a
// representative and the whole grouping compares with one assertion.
const nodeAliases = fromRealNode(
  '(() => { const m = require("node:fs"); const ks = Object.keys(m).sort();' +
    ' return Object.fromEntries(ks.map((k) => [k, ks.find((j) => m[j] === m[k])])); })()',
);

assert.ok(
  nodeKeys.length >= 90,
  `node's fs exports ${nodeKeys.length} names, too few to be the surface this pins`,
);

const ours = new Set(Object.keys(mod));

// Nothing absent. An empty pin is the strongest form of this check.
const ABSENT = [];

const missing = nodeKeys.filter((name) => !ours.has(name));
assert.deepStrictEqual(
  missing,
  ABSENT,
  `fs's difference from node is [${missing.join(", ")}], not the pinned [${ABSENT.join(", ")}]`,
);

const extra = [...ours].filter((name) => !nodeKeys.includes(name)).sort();
assert.deepStrictEqual(extra, [], `fs publishes name(s) node does not: ${extra.join(", ")}`);

for (const name of nodeKeys) {
  if (ABSENT.includes(name)) continue;
  assert.strictEqual(
    typeof mod[name],
    nodeTypes[name],
    `fs.${name} is ${typeof mod[name]}, node's is ${nodeTypes[name]}`,
  );
  if (nodeTypes[name] === "function") {
    // `fs.Stats` is `DEP0180` on node, so node's is the `deprecate` wrapper and
    // its name is "deprecated". Ours is the class itself.
    //
    // **Not wrapped here, deliberately.** `deprecate` returns a plain function;
    // wrapping a constructor with it changes what `new fs.Stats()` builds and
    // what `instanceof fs.Stats` answers, and `Stats` objects are handed back
    // from every `stat` call in the module. `util.isArray` took the wrapper
    // because it is an ordinary function and nothing observes its identity.
    //
    // So the warning is absent and that is a real difference, recorded rather
    // than hidden: the name is pinned, not skipped, and the day `Stats` stops
    // being a class this fails.
    const expectedName = name === "Stats" ? "Stats" : nodeNames[name];
    assert.strictEqual(
      mod[name].name,
      expectedName,
      `fs.${name}.name is ${JSON.stringify(mod[name].name)}, expected ${JSON.stringify(expectedName)}`,
    );
  }
}

// **The aliases**, which node's own tests have no reason to assert: on node two
// keys holding one object are the same object by construction. An artifact that
// published two distinct functions with the right names and the right behaviour
// would pass everything above and still be wrong -- a caller replacing
// `fs.X` would not change what the other key sees.
const present = nodeKeys.filter((name) => !ABSENT.includes(name));
for (const name of present) {
  const rep = nodeAliases[name];
  if (rep === name || ABSENT.includes(rep)) continue;
  assert.strictEqual(
    mod[name],
    mod[rep],
    `fs.${name} and fs.${rep} are the same object on node and are not here`,
  );
}
