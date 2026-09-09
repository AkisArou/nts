// `process.env`, against a child node's answer for the same environment.
//
// The compiled `process` publishes exactly one name, `env`, and the module
// records zero passes. Every upstream `test-process-*.js` needs the rest of the
// object -- `argv`, `exit`, `hrtime`, the event emitter -- so nothing was
// asking the one thing that is there.
//
// # The oracle is a child, because both sides here are ours
//
// `process/shape.mjs` declares `installGlobals`, so inside this harness
// `globalThis.process` and `require("process")` are the same object under test.
// Comparing them would compare a thing with itself.
//
// A child `node -p` runs node's own `process` over the **same environment**,
// because a child inherits it. That is the same device
// `stream/test/export-surface-static.js` uses for node's export list, and for
// the same reason.
//
// The binary comes from `/proc/self/exe` and not from `process.execPath`.
// `process` here *is* the module under test -- `run-one.mjs` installs it over
// the global, and `shape.mjs` says why: node's `process` is a global first and
// a module second. So `process.execPath` is whatever the compiled module
// publishes, which today is nothing. Reading the running binary from the kernel
// asks nobody who is being measured.
//
// # What is compared
//
// The key set, exactly -- not its size. Two environments can have the same
// count and different names, and the count is the comparison that passes when
// half the keys are wrong. Then the values for every shared key.
//
// A stub returning a fixed object fails the key set. A stub returning the right
// keys with wrong values fails the second pass.
//
// # It is shape-only, and that is the correct label
//
// Measured: this passes plain, passes `--mutate-addon`, and fails
// `--empty-exports` and `--sabotage`. `env` is a **data table**, and mutation
// keeps the addon's names while destroying its behaviour -- a table has none to
// destroy. So `process` joins the compiled axis demonstrating that it delivers
// a correct environment, not that it computes anything.
//
// `os/test/constants-signals-static.js` is the same category for the same
// reason. Calling either of them hollow would be wrong -- they fail with no
// module at all -- and calling them behaviour-dependent would be wrong too.
"use strict";

require("../common");

const assert = require("assert");
const { execFileSync } = require("child_process");
const { readlinkSync } = require("fs");

const ours = process.env;
assert.strictEqual(typeof ours, "object", "process.env is not an object");
assert.notStrictEqual(ours, null, "process.env is null");

// Node's answer for this same environment, from a child that inherited it.
const nodeBinary = readlinkSync("/proc/self/exe");
const raw = execFileSync(
  nodeBinary,
  ["-p", "JSON.stringify(process.env)"],
  { encoding: "utf8" },
);
const theirs = JSON.parse(raw);

const ourKeys = Object.keys(ours).sort();
const theirKeys = Object.keys(theirs).sort();

// The child adds nothing of its own, so any difference is ours.
assert.ok(theirKeys.length > 0, "the child reported an empty environment; the oracle is broken");
assert.deepStrictEqual(
  ourKeys,
  theirKeys,
  `process.env has ${ourKeys.length} keys, node has ${theirKeys.length}`,
);

for (const key of theirKeys) {
  assert.strictEqual(
    ours[key],
    theirs[key],
    `process.env.${key} is ${JSON.stringify(ours[key])}, node's is ${JSON.stringify(theirs[key])}`,
  );
}
