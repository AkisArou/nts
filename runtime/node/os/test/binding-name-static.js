// Every function `os` publishes carries its own name, not its binding's.
//
// Four of these were written as `export const totalmem = nts_os_totalmem`,
// aliasing the native binding straight out of the module. Two things followed,
// and the quiet one is the reason this file exists.
//
// The loud one: the Node-API backend has no compiled function to publish for an
// alias, so the addon carried 4 of `os`'s 23 names. Writing them as functions
// took it to 8.
//
// The quiet one: `os.freemem.name` was `""`. Node has `"freemem"`. The function
// reached the public surface anonymous, on the lane that was already passing
// every test it had, and no test could have noticed -- searched
// `parallel/test-os*.js`, which never reads `.name` on anything. On node these
// are ordinary function declarations, so a name is guaranteed and there was
// nothing there to test.
//
// **Empty rather than `"nts_os_freemem"`, and the difference cost a wrong
// claim.** This was first reported -- in a commit message, in the ledger, and to
// two other lanes -- as the binding's own name being readable from script, which
// is the alarming version and is not what happens. The host stand-in is
// `globalThis.nts_os_freemem = () => os.freemem()`, and a property assignment
// infers no name, so the alias carries an empty one. The defect is real and the
// fix is unchanged; the sentence that made it sound urgent was not checked until
// this file's control was run, which is what a control is for.
//
// `process` had the identical defect in twelve places. See
// `runtime/node/process/test/binding-name-leak-static.js`. Both are guarded now,
// because the fix in each case is a spelling, and a spelling is what a later
// edit changes back without noticing.
"use strict";

require("../common");

const assert = require("assert");
const os = require("os");

const wrong = [];
const checked = [];

for (const name of Object.keys(os)) {
  const value = os[name];
  if (typeof value !== "function") continue;
  checked.push(name);
  // The binding's name must not be observable...
  if (/^nts_/.test(value.name)) wrong.push(`${name}.name === ${JSON.stringify(value.name)}`);
  // ...and neither may the function be anonymous, which is the same mistake
  // made through a host stand-in rather than through a compiled binding.
  else if (value.name === "") wrong.push(`${name}.name is empty`);
  // Node names each of these after the export itself.
  else if (value.name !== name) wrong.push(`${name}.name === ${JSON.stringify(value.name)}`);
}

assert.ok(checked.length > 0, "no functions found on os, so this file checked nothing");
assert.deepStrictEqual(wrong, [], `os function names disagree with their exports: ${wrong.join(", ")}`);

// The four that were aliases, named explicitly, so a regression names itself
// rather than appearing as a count.
for (const name of ["totalmem", "freemem", "availableParallelism", "loadavg"]) {
  assert.strictEqual(typeof os[name], "function", `os.${name} is missing`);
  assert.strictEqual(os[name].name, name, `os.${name} is not named ${name}`);
}

// And they still answer, so this cannot pass by every name being equally wrong.
assert.ok(os.totalmem() > 0, "os.totalmem() is not positive");
assert.ok(os.freemem() >= 0, "os.freemem() is negative");
assert.ok(os.availableParallelism() >= 1, "os.availableParallelism() is below one");
assert.strictEqual(os.loadavg().length, 3, "os.loadavg() is not three numbers");
