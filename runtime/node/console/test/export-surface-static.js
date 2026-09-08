// `console`'s exported names, and the binding that is not a name.
//
// The module compiles and publishes **zero of five**. Its wrapper diagnostics
// split 4 / 1: four the backend cannot name and one function never compiled, so
// this module is almost entirely the `export-class` arm.
//
// Node's answers come from a child `node -p`: inside this harness
// `require("node:console")` and `require("console")` are the same object.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const consoleModule = require("console");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const expected = fromRealNode('Object.keys(require("node:console")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:console"))' +
    '.map((k) => [k, typeof require("node:console")[k]]))',
);

assert.ok(
  expected.length >= 15,
  `node's console exports ${expected.length} names, too few to be real`,
);

// Two names this profile does not implement, both already in the ledger's
// missing-export register under `console`. Excluded here rather than passing
// silently, so the register stays the one place they are tracked.
const notImplemented = new Set(["context", "createTask"]);

const actual = new Set(Object.keys(consoleModule));
const missing = expected.filter((name) => !actual.has(name) && !notImplemented.has(name));
assert.deepStrictEqual(missing, [], `console is missing name(s) node has: ${missing.join(", ")}`);

for (const name of expected) {
  if (notImplemented.has(name)) continue;
  assert.strictEqual(
    typeof consoleModule[name],
    nodeTypes[name],
    `console.${name} is ${typeof consoleModule[name]}, node's is ${nodeTypes[name]}`,
  );
}

// **The module is the global `console`.** `require("console") === console` in
// node, and nothing in a key list can see it. A surface that published a second
//, separate console would satisfy every check above while leaving
// `console.log` and `require("console").log` writing through different paths --
// so `count`, `group` and `table`, all of which hold state, would keep two sets
// of it.
assert.strictEqual(consoleModule, globalThis.console, "the module is not the global console");

// **`Console` is a constructor, and an instance is independent of the global.**
// State is per-instance: node's own tests build a `Console` over a stream to
// capture output, and a `Console` that shared the global's counters would make
// every such test interfere with the next.
assert.strictEqual(typeof consoleModule.Console, "function");
const { Writable } = require("stream");
const written = [];
const sink = new Writable({
  write(chunk, _encoding, done) { written.push(String(chunk)); done(); },
});
const isolated = new consoleModule.Console({ stdout: sink });
isolated.log("probe");
assert.strictEqual(written.join(""), "probe\n", "a Console over a stream did not write to it");

isolated.count("k");
isolated.count("k");
assert.ok(written.join("").includes("k: 2"), "count did not accumulate on the instance");
