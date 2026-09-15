// `readline`'s surface, complete -- **module keys and `Interface.prototype`**.
//
// All eight of node's names, matching types, matching function names, and the
// alias identities below. Nothing is pinned absent -- if that changes, the
// empty list is what fails.
//
// The prototype sweep was added after this file, titled "complete", missed 21
// methods. It compared `Object.keys(require("readline"))` and stopped there, so
// every method on the module's principal class was outside what it looked at:
// `_insertString`, `_ttyWrite`, `_wordLeft` and eighteen more existed on node and
// not here, and this file said the surface was complete the whole time. The claim
// was true of the eight module keys; "complete" was the word that was wrong.
//
// What found it was `corpus-reach.mjs`, which counts *published functions* and so
// walks one level into published objects -- it reported 26 of readline's 38 as
// never called, and 21 of those turned out to be never called because they were
// never there. A surface test that enumerates one level shallower than the
// instrument measuring it will keep reporting complete.
//
// Node's answers come from a child `node -p`: inside this harness
// `require("node:readline")` and `require("readline")` are the same object.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const mod = require("readline");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const nodeKeys = fromRealNode('Object.keys(require("node:readline")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:readline"))' +
    '.map((k) => [k, typeof require("node:readline")[k]]))',
);
// A function's `name` is not always the key it is filed under -- an alias is
// the same object under a second key, and carries the original's name. Reading
// node's answer rather than assuming the key is what makes this safe for
// aliases; assuming cost this file its first failure, against a correct module.
const nodeNames = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:readline"))' +
    '.filter((k) => typeof require("node:readline")[k] === "function")' +
    '.map((k) => [k, require("node:readline")[k].name]))',
);
// Which keys hold the *same object* in node. Each key maps to the first key
// (in sorted order) holding an identical value, so aliases share a
// representative and the whole grouping compares with one assertion.
const nodeAliases = fromRealNode(
  '(() => { const m = require("node:readline"); const ks = Object.keys(m).sort();' +
    ' return Object.fromEntries(ks.map((k) => [k, ks.find((j) => m[j] === m[k])])); })()',
);

assert.ok(
  nodeKeys.length >= 8,
  `node's readline exports ${nodeKeys.length} names, too few to be the surface this pins`,
);

const ours = new Set(Object.keys(mod));

// Nothing absent. An empty pin is the strongest form of this check.
const ABSENT = [];

const missing = nodeKeys.filter((name) => !ours.has(name));
assert.deepStrictEqual(
  missing,
  ABSENT,
  `readline's difference from node is [${missing.join(", ")}], not the pinned [${ABSENT.join(", ")}]`,
);

const extra = [...ours].filter((name) => !nodeKeys.includes(name)).sort();
assert.deepStrictEqual(extra, [], `readline publishes name(s) node does not: ${extra.join(", ")}`);

// Collected rather than asserted in the loop. Asserting here reported
// `Interface` and stopped, which hid the `.name` sweep and the alias sweep
// below -- and the alias sweep is, by its own comment, the check node's tests
// have no reason to make. A file that reports its first finding and stops is a
// file whose other findings do not exist until the first is repaired.
const findings = [];
for (const name of nodeKeys) {
  if (ABSENT.includes(name)) continue;
  const ours = typeof mod[name];
  if (ours !== nodeTypes[name]) {
    findings.push(`readline.${name} is ${ours}, node's is ${nodeTypes[name]}`);
    continue;
  }
  if (nodeTypes[name] === "function" && mod[name].name !== nodeNames[name]) {
    findings.push(
      `readline.${name}.name is ${JSON.stringify(mod[name].name)}, node's is ${JSON.stringify(nodeNames[name])}`,
    );
  }
}

// **The aliases**, which node's own tests have no reason to assert: on node two
// keys holding one object are the same object by construction. An artifact that
// published two distinct functions with the right names and the right behaviour
// would pass everything above and still be wrong -- a caller replacing
// `readline.X` would not change what the other key sees.
const present = nodeKeys.filter((name) => !ABSENT.includes(name));
for (const name of present) {
  const rep = nodeAliases[name];
  if (rep === name || ABSENT.includes(rep)) continue;
  // Both absent is not an alias finding -- it is the same absence twice, and
  // reporting it here would say "the aliases are broken" about a module that
  // has not published either half.
  if (mod[name] === undefined && mod[rep] === undefined) continue;
  if (mod[name] !== mod[rep]) {
    findings.push(`readline.${name} and readline.${rep} are one object on node and are not here`);
  }
}

// **`Interface.prototype`**, which is where the 21 were missing.
//
// Read from a child rather than listed here, for the same reason the module keys
// are: a hand-written list is a second copy of node's surface that goes stale
// without saying so. Own property names of the prototype chain up to (but not
// including) `EventEmitter.prototype`, because everything above that belongs to
// `events` and is that module's surface to match.
const nodeInterfaceMethods = fromRealNode(
  '(() => {' +
    'const { Interface } = require("node:readline");' +
    'const stop = require("node:events").EventEmitter.prototype;' +
    'const out = [];' +
    'for (let p = Interface.prototype; p && p !== stop && p !== Object.prototype;' +
    '     p = Object.getPrototypeOf(p)) {' +
    '  for (const k of Object.getOwnPropertyNames(p)) {' +
    '    const d = Object.getOwnPropertyDescriptor(p, k);' +
    '    if (d && typeof d.value === "function" && k !== "constructor") out.push(k);' +
    '  }' +
    '}' +
    'return [...new Set(out)].sort();' +
  '})()',
);

const ourInterface = mod.Interface.prototype;
const missingMethods = nodeInterfaceMethods.filter(
  (name) => typeof ourInterface[name] !== "function",
);
if (missingMethods.length > 0) {
  findings.push(
    `Interface.prototype is missing ${missingMethods.length} of node's ${nodeInterfaceMethods.length} method(s): ${missingMethods.join(", ")}`,
  );
}

// A sanity floor on the sweep itself. If the child ever answers an empty list --
// a changed internal layout, a `require` that resolves elsewhere -- the filter
// above finds nothing missing and this file reports a complete surface for the
// second time. The number is deliberately well under node's current count rather
// than equal to it, so an added method is not a failure and a broken probe is.
assert.ok(
  nodeInterfaceMethods.length >= 20,
  `the prototype probe found only ${nodeInterfaceMethods.length} method(s) on node's Interface, which means it stopped working rather than that node shrank`,
);
assert.ok(
  nodeInterfaceMethods.includes("_ttyWrite"),
  "the prototype probe must reach the underscore-prefixed internals, which are the ones this check exists for",
);

assert.deepStrictEqual(
  findings,
  [],
  `${findings.length} surface finding(s):\n  ${findings.join("\n  ")}`,
);
