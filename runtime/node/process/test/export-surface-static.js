// `process`'s surface: 55 of node's 83.
//
// This is the largest gap of any module and the least decided. The 28 below are
// bindings, debugger hooks, module-loader internals and a few real public names
// -- `exitCode`, `title`, `stdin`, `ppid` -- and they are grouped in the list
// rather than argued individually because no argument has been made for them.
//
// `process` is a global before it is a module: `require('process') ===
// globalThis.process`, and `shape.mjs` returns the instance so that a test
// setting `process.exitCode` on one sees it on the other. That makes a missing
// name here wider in effect than a missing name anywhere else.
//
// Node's answers come from a child `node -p`: inside this harness
// `require("node:process")` and `require("process")` are the same object.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const mod = require("process");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const nodeKeys = fromRealNode('Object.keys(require("node:process")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:process"))' +
    '.map((k) => [k, typeof require("node:process")[k]]))',
);
// A function's `name` is not always the key it is filed under -- an alias is
// the same object under a second key, and carries the original's name. Reading
// node's answer rather than assuming the key is what makes this safe for
// aliases; assuming cost this file its first failure, against a correct module.
const nodeNames = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:process"))' +
    '.filter((k) => typeof require("node:process")[k] === "function")' +
    '.map((k) => [k, require("node:process")[k].name]))',
);
// Which keys hold the *same object* in node. Each key maps to the first key
// (in sorted order) holding an identical value, so aliases share a
// representative and the whole grouping compares with one assertion.
const nodeAliases = fromRealNode(
  '(() => { const m = require("node:process"); const ks = Object.keys(m).sort();' +
    ' return Object.fromEntries(ks.map((k) => [k, ks.find((j) => m[j] === m[k])])); })()',
);

assert.ok(
  nodeKeys.length >= 70,
  `node's process exports ${nodeKeys.length} names, too few to be the surface this pins`,
);

const ours = new Set(Object.keys(mod));

// Names where node's `.name` is an artifact of how node builds the property
// rather than an API contract, and matching it would mean making our code
// worse. Each is pinned with its reason; an unpinned mismatch still fails.
//
//   _fatalException  anonymous on node -- assigned to the member, so named
//                    evaluation never applies. Ours is a declaration and
//                    carries its name. Copying the empty string would be
//                    reproducing an accident.
//   chdir            node's is `wrappedChdir`, an internal wrapper. Ours does
//                    the work directly.
//
// This is the opposite direction from `http.get`, where node had the name and
// we had lost it to a member-assigned arrow. There, matching node was the fix.
const NAME_DIFFERS = {
  // Anonymous on node -- assigned to the member, so named evaluation never
  // applies. Ours are declarations and carry their names.
  _fatalException: "fatalException",
  setegid: "setegid",
  seteuid: "seteuid",
  setgid: "setgid",
  setuid: "setuid",
  // Node's are internal wrappers: `wrappedChdir`, `wrappedCwd`, `wrappedUmask`.
  // Ours do the work directly, so there is no wrapper to be named after.
  chdir: "chdir",
  cwd: "cwd",
  umask: "umask",
};

// Absent, deliberately pinned so the list cannot widen unnoticed.
//   `exitCode`, `title`, `ppid`, `stdin` are public and wanted.
//   The `_`-prefixed ones plus `binding`, `dlopen`, `moduleLoadList` and
//   `getBuiltinModule` are loader and V8 plumbing with no representation here.
//   `report`, `domain` and the source-map pair are subsystems, not names.
const ABSENT = [
  "_debugEnd",
  "_debugProcess",
  "_eval",
  "_exiting",
  "_kill",
  "_linkedBinding",
  "_preload_modules",
  "_print_eval",
  "_startProfilerIdleNotifier",
  "_stopProfilerIdleNotifier",
  "_tickCallback",
  "binding",
  "debugPort",
  "dlopen",
  "domain",
  "exitCode",
  "getBuiltinModule",
  "moduleLoadList",
  "openStdin",
  "ppid",
  "reallyExit",
  "ref",
  "report",
  "setSourceMapsEnabled",
  "sourceMapsEnabled",
  "stdin",
  "title",
  "unref",
];

const missing = nodeKeys.filter((name) => !ours.has(name));
assert.deepStrictEqual(
  missing,
  ABSENT,
  `process's difference from node is [${missing.join(", ")}], not the pinned [${ABSENT.join(", ")}]`,
);

// Published here and genuinely absent on node -- `n in process` is false for
// each, so this is not an enumerability difference.
//
// **These are not a leak and deleting them is not the fix.** Node's `process`
// is a dynamic object where `noDeprecation` appears only once a flag sets it.
// Ours is a typed class: `noDeprecation = false` is a declared field, read at
// four sites in `warning.ts`. In the compiled representation these are struct
// fields, which a host-side `delete` cannot remove at all -- so a shape that
// deleted them would make the interpreted and compiled lanes disagree about the
// same object.
//
// The difference is the object model, not an oversight, and it is pinned here
// so it stays that and does not become a place to put things.
//
// **`_captureRejections` and `_preserveEventShape` were on this list and are
// not any more, and the argument above is why the fix took the form it did.**
// They are `EventEmitter`'s, so they were on every emitter in the profile --
// `net.Server`, `net.Socket`, `http.Server`, every stream, `process`, `readline`,
// `dgram` -- and node has neither. Deleting them at the host was ruled out here
// for a good reason, and it does not reach the fix that was made: they are
// **symbol-keyed** now, as node keeps its own `Symbol(kCapture)`, so the field
// still exists in both lanes and neither lane enumerates it. A `#` field would
// also have hidden them and could not be used, because two module-level
// functions read the flag off an instance.
const EXTRA = [
  "noDeprecation",
  "throwDeprecation",
  "traceDeprecation",
  "traceProcessWarnings",
];

const extra = [...ours].filter((name) => !nodeKeys.includes(name)).sort();
assert.deepStrictEqual(
  extra,
  EXTRA,
  `process publishes [${extra.join(", ")}] that node does not, not the pinned [${EXTRA.join(", ")}]`,
);

// Collected rather than asserted one at a time: a surface check that stops at
// the first mismatch makes finding the shape of a divergence an exercise in
// re-running it, and the shape is the useful part.
const typeMismatches = [];
const nameMismatches = [];

for (const name of nodeKeys) {
  if (ABSENT.includes(name)) continue;
  if (typeof mod[name] !== nodeTypes[name]) {
    typeMismatches.push(`${name}: ours ${typeof mod[name]}, node's ${nodeTypes[name]}`);
    continue;
  }
  if (nodeTypes[name] !== "function") continue;
  const expected = NAME_DIFFERS[name] ?? nodeNames[name];
  if (mod[name].name !== expected) {
    nameMismatches.push(
      `${name}.name: ours ${JSON.stringify(mod[name].name)}, expected ${JSON.stringify(expected)}`,
    );
  }
}

assert.deepStrictEqual(typeMismatches, [], `process type divergence(s): ${typeMismatches.join(" | ")}`);
assert.deepStrictEqual(nameMismatches, [], `process name divergence(s): ${nameMismatches.join(" | ")}`);

// **The aliases**, which node's own tests have no reason to assert: on node two
// keys holding one object are the same object by construction. An artifact that
// published two distinct functions with the right names and the right behaviour
// would pass everything above and still be wrong -- a caller replacing
// `process.X` would not change what the other key sees.
const present = nodeKeys.filter((name) => !ABSENT.includes(name));
for (const name of present) {
  const rep = nodeAliases[name];
  if (rep === name || ABSENT.includes(rep)) continue;
  assert.strictEqual(
    mod[name],
    mod[rep],
    `process.${name} and process.${rep} are the same object on node and are not here`,
  );
}
