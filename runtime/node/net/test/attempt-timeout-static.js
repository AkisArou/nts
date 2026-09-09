// `common` scales the attempt timeout, and the compiled lane cannot be scaled.
//
// `test/common/index.js:182` runs on load, in node and here:
//
//     net.setDefaultAutoSelectFamilyAttemptTimeout(
//       platformTimeout(net.getDefaultAutoSelectFamilyAttemptTimeout() * 10));
//
// So node reports **2500** to any test that requires `../common`, and 250 only
// to a program that does not. Checked directly: `node -e 'require("../common");
// require("net").getDefaultAutoSelectFamilyAttemptTimeout()'` answers 2500.
//
// The compiled addon publishes the *getter* and not the setter, so `common`'s
// call cannot land and the value stays at the unscaled 250. This file fails on
// the compiled lane for that reason and passes on the interpreted one.
//
// # It is asserted as a relation, not as 2500
//
// `platformTimeout` scales again on slow or instrumented builds, so the literal
// is not stable across machines. What is stable is that `common` moved it: the
// scaled value is strictly greater than the unscaled default. A lane where the
// setter is missing cannot satisfy that however the platform scales.
//
// # How this got its own file
//
// `default-family-static.js` asserted `=== 250` and **passed on the compiled
// lane and failed on the interpreted one**. The compiled lane was the wrong
// one: it agreed with the documented default only because the missing setter
// stopped `common` doing what node does. An assertion that holds because of the
// defect is the fourth failure mode in the fixture rules -- a control that
// suppresses the thing it controls for -- and it was worth splitting out rather
// than deleting.
"use strict";

require("../common");

const assert = require("assert");
const net = require("net");

const scaled = net.getDefaultAutoSelectFamilyAttemptTimeout();

assert.strictEqual(typeof scaled, "number", "the attempt timeout is not a number");
assert.ok(Number.isInteger(scaled), `the attempt timeout is not an integer: ${scaled}`);

// Node's unscaled default. `common` multiplies it by ten before any test body
// runs, so a lane that reports this value is a lane `common` could not reach.
const UNSCALED = 250;
assert.ok(
  scaled > UNSCALED,
  `the attempt timeout is ${scaled}; common scales it above ${UNSCALED}, ` +
    "so this lane does not publish setDefaultAutoSelectFamilyAttemptTimeout",
);
