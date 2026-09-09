// The attempt-timeout default, and a write observed by the next read.
//
// The compiled `net` publishes all four `autoSelectFamily` names now. The
// boolean pair is `default-family-static.js`; this is the timeout pair.
//
// # This file used to assert a number, and the number was the harness's
//
// It asserted that the value was **greater than 250** -- node's unscaled
// default -- on the reasoning that `test/common/index.js:182` scales it by ten
// on load, so any file requiring `../common` sees 2500 in node. That is true of
// node and was the wrong thing to assert here, for a reason that took two
// findings to see:
//
//   * `tooling/conformance/common.mjs:260` exposes
//     `defaultAutoSelectFamilyAttemptTimeout: 2500` as a **constant** and never
//     calls the setter, so the module's state is not scaled at all.
//   * `net/bindings.node.mjs` multiplies the binding's answer by ten to
//     compensate, which is documented there -- so the *interpreted* lane reads
//     2500 and the *compiled* lane reads 250.
//
// Two stand-ins compensating for each other, and neither doing what node does.
// The assertion was reading that difference and calling it the module.
//
// So this asks the module something the module owns: **set a value, read it
// back, put it back.** That answer does not depend on which lane, which
// stand-in, or what `common` did before the file ran.
//
// The fidelity gap is real and is recorded in the ledger; it is not this file's
// to assert, because a test that fails when a harness constant is wrong is a
// test of the harness.
"use strict";

require("../common");

const assert = require("assert");
const net = require("net");

for (const name of [
  "getDefaultAutoSelectFamilyAttemptTimeout",
  "setDefaultAutoSelectFamilyAttemptTimeout",
]) {
  assert.strictEqual(typeof net[name], "function", `net.${name} is missing`);
}

const original = net.getDefaultAutoSelectFamilyAttemptTimeout();
assert.strictEqual(typeof original, "number", "the attempt timeout is not a number");
assert.ok(Number.isInteger(original), `the attempt timeout is not an integer: ${original}`);
assert.ok(original > 0, `the attempt timeout is not positive: ${original}`);

try {
  net.setDefaultAutoSelectFamilyAttemptTimeout(1234);
  assert.strictEqual(
    net.getDefaultAutoSelectFamilyAttemptTimeout(),
    1234,
    "the write was not observed by the next read",
  );

  // Node clamps to a floor of 10 rather than rejecting a small positive value.
  // `runtime/node/net/src/main.ts:2529` is `Math.max(10, value)`, which is
  // node's, and a setter that stored the argument unchanged passes the line
  // above and fails this one.
  net.setDefaultAutoSelectFamilyAttemptTimeout(1);
  assert.strictEqual(
    net.getDefaultAutoSelectFamilyAttemptTimeout(),
    10,
    "a value below the floor was not clamped to 10",
  );
} finally {
  net.setDefaultAutoSelectFamilyAttemptTimeout(original);
}

assert.strictEqual(
  net.getDefaultAutoSelectFamilyAttemptTimeout(),
  original,
  "the original was not restored",
);
