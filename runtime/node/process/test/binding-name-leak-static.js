// No public function on `process` may be named after its native binding.
//
// `os` had four exports written as `export const totalmem = nts_os_totalmem`.
// That aliases the binding straight out of the module, and the consequence is
// not only that the Node-API backend cannot name it: on the interpreted lane
// `os.freemem.name` was `""` where node has `"freemem"`, so a function reached
// the public surface with no name at all. (Reported at first as the *binding's*
// name being observable, which is the alarming version and is wrong: the host
// stand-in is assigned to a property, and a property assignment infers no name.)
// `process` is written the same way in a dozen places -- `cwd`, `uptime`, `abort`, `getuid`, `getgid`,
// `geteuid`, `getegid`, `getgroups`, `availableMemory`, `constrainedMemory`,
// `reallyExit`.
//
// Nothing upstream checks this, and nothing could: on node these are ordinary
// function declarations, so there is no way for a binding name to appear.
//
// **Exact names are deliberately not asserted.** Node's own `process.cwd.name`
// is `"wrappedCwd"` -- an internal detail of how node wraps it, and pinning that
// would be asserting node's implementation rather than its surface. What is
// asserted is the property that actually matters and that has actually been
// violated: a name belonging to the native layer must not be observable from
// script.
"use strict";

require("../common");

const assert = require("assert");

// Every function node publishes on `process` that this profile also publishes.
// Read off the object rather than listed, so a new export is covered the day it
// appears rather than the day somebody remembers to add it here.
const leaked = [];
const checked = [];

for (const name of Object.getOwnPropertyNames(process)) {
  let value;
  try {
    value = process[name];
  } catch {
    continue; // a getter that throws on this platform is not this file's business
  }
  if (typeof value !== "function") continue;
  checked.push(name);
  if (/^nts_/.test(value.name)) leaked.push(`process.${name}.name === ${JSON.stringify(value.name)}`);
}

assert.ok(checked.length > 0, "no functions found on process, so this file checked nothing");

// The weaker half of the same property, which catches the other spelling of the
// mistake. `export const uptime = nts_process_uptime` does not leak a name on
// this lane, because the stand-in is `globalThis.nts_process_uptime = () => ...`
// and a property assignment infers no name at all -- so the function arrives
// anonymous where node has `"uptime"`. Every function node publishes has a name;
// an empty one is a surface defect whatever node happens to call it.
const anonymous = checked.filter((n) => process[n].name === "");
assert.deepStrictEqual(
  anonymous,
  [],
  `public functions with no name, where node names every one: ${anonymous.join(", ")}`,
);
assert.deepStrictEqual(
  leaked,
  [],
  `a native binding's name is observable on the public surface:\n  ${leaked.join("\n  ")}`,
);

// The same for the one nested surface node documents as a function with a
// method, since `hrtime.bigint` is written as a binding alias too.
if (typeof process.hrtime === "function" && typeof process.hrtime.bigint === "function") {
  assert.ok(
    !/^nts_/.test(process.hrtime.bigint.name),
    `process.hrtime.bigint.name === ${JSON.stringify(process.hrtime.bigint.name)}`,
  );
}
