// `os`'s twenty-three names, and the two things about them that are not names.
//
// This is the module closest to a second green: it compiles, loads, publishes
// **17 of 23**, and passes 4 of its 8 applicable files. All four failures are
// the six absent names -- `constants` and `networkInterfaces` behind a computed
// member write, `getPriority` and `setPriority` behind the
// `determineSpecificType` queue, `cpus` behind a heterogeneous tuple return,
// and `userInfo` behind a refusal nothing prints a cause for.
//
// So when those land, the question is whether the surface is *complete*, not
// whether four more files pass. `core-static.js` beside this checks the content
// of `networkInterfaces` and `constants-table-static.js` checks the constants;
// neither enumerates the module.
//
// Node's answers come from a child `node -p`: inside this harness
// `require("node:os")` and `require("os")` are the same object.

"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const os = require("os");

function fromRealNode(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["-p", `JSON.stringify(${expression})`], {
      encoding: "utf8",
    }),
  );
}

const expected = fromRealNode('Object.keys(require("node:os")).sort()');
const nodeTypes = fromRealNode(
  'Object.fromEntries(Object.keys(require("node:os"))' +
    '.map((k) => [k, typeof require("node:os")[k]]))',
);

assert.ok(
  expected.length >= 20,
  `node's os exports ${expected.length} names, too few to be real`,
);

const actual = new Set(Object.keys(os));
const missing = expected.filter((name) => !actual.has(name));
assert.deepStrictEqual(missing, [], `os is missing name(s) node has: ${missing.join(", ")}`);

for (const name of expected) {
  assert.strictEqual(
    typeof os[name],
    nodeTypes[name],
    `os.${name} is ${typeof os[name]}, node's is ${nodeTypes[name]}`,
  );
}

const extra = [...actual].filter((name) => !expected.includes(name)).sort();
assert.deepStrictEqual(extra, [], `os publishes name(s) node does not: ${extra.join(", ")}`);

// **Every function carries its own name.** Four of these were once written as
// `export const totalmem = nts_os_totalmem`, which aliased the native binding
// straight out of the module: the addon published 4 of 23 names, and
// `os.freemem.name` was the empty string rather than `"freemem"`. Node's are
// ordinary declarations, so a name is guaranteed there and no upstream test
// reads one. `binding-name-static.js` beside this covers the same ground from
// the binding side; this covers it from the surface.
for (const name of expected) {
  if (nodeTypes[name] !== "function") continue;
  assert.strictEqual(
    os[name].name,
    name,
    `os.${name}.name is ${JSON.stringify(os[name].name)}, not ${JSON.stringify(name)}`,
  );
}

// **`constants` is a table of tables**, and a published empty object satisfies
// every check above. Its four groups are the shape node's own tests index into.
assert.strictEqual(typeof os.constants, "object");
for (const group of ["signals", "errno", "priority", "dlopen"]) {
  assert.strictEqual(typeof os.constants[group], "object", `os.constants.${group}`);
  assert.ok(
    Object.keys(os.constants[group]).length > 0,
    `os.constants.${group} is empty`,
  );
}
// `SIGUSR1` is 10 on Linux and 30 on macOS, which is why the table is read from
// the platform rather than transcribed -- and why `readConstants` was not
// rewritten to avoid the computed member write that blocks it.
assert.strictEqual(
  os.constants.signals.SIGUSR1,
  fromRealNode('require("node:os").constants.signals.SIGUSR1'),
);
