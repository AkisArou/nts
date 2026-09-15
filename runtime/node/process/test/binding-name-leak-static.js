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
const { execFileSync } = require("child_process");

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
// anonymous where node has `"uptime"`. An empty name is a surface defect
// **wherever node has one**.
//
// That last clause was "whatever node happens to call it", asserting the empty
// list outright on the reasoning that every function node publishes has a name.
// It does not. `process._startProfilerIdleNotifier` and
// `process._stopProfilerIdleNotifier` are literally
// `process._startProfilerIdleNotifier = () => {}` upstream -- an arrow assigned to
// a member expression, which takes no name from it -- so node's own `name` for both
// is `""`. Implementing them faithfully made this file fail, naming them, which is
// the right outcome for the wrong reason: they were correct.
//
// So node's answer is read rather than assumed. A hand-written exemption list would
// be a second copy of node's surface that goes stale, which is the failure this
// whole file exists to catch one level down.
const nodeAnonymous = new Set(
  JSON.parse(
    execFileSync(
      process.execPath,
      ["-p", 'JSON.stringify(Object.getOwnPropertyNames(process).filter((k) => { try { return typeof process[k] === "function" && process[k].name === ""; } catch { return false; } }))'],
      { encoding: "utf8" },
    ),
  ),
);
// A floor on the probe: if the child ever answers nothing -- a changed spelling, a
// `-p` that fails -- every name would look unexempted and this check would report
// defects that are node's own shape. Two is what node has today, and asserting "at
// least one" keeps an added anonymous function upstream from failing this.
assert.ok(
  nodeAnonymous.size >= 1,
  "the probe found no anonymous functions on node's process, which means it stopped working rather than that node changed",
);
const anonymous = checked.filter((n) => process[n].name === "" && !nodeAnonymous.has(n));
assert.deepStrictEqual(
  anonymous,
  [],
  `public functions with no name, where node names its: ${anonymous.join(", ")}`,
);
// **No mirror check here**, deliberately. Asserting that a function node leaves
// anonymous is anonymous here too is a reasonable property, and it belongs in
// `export-surface-static.js`, which already compares every name against node's and
// carries the allowances with their reasons -- including this exact one:
// "_fatalException  anonymous on node -- assigned to the member, so named".
//
// A draft of this file added that mirror and it immediately failed on
// `_fatalException`, contradicting an allowance recorded one file over. Two checks
// deriving one fact will disagree eventually, and the one that disagrees later is
// the one nobody reconciles. This file's question is narrower and stays narrower: a
// name from the native layer must not be observable from script.

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
