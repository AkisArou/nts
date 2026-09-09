// The three `autoSelectFamily` defaults are the whole of what `net` publishes,
// and nothing was asking them anything.
//
// The compiled `net` addon publishes exactly three names, all of them node's:
//
//     getDefaultAutoSelectFamily        setDefaultAutoSelectFamily
//     getDefaultAutoSelectFamilyAttemptTimeout
//
// and the module records zero passes on the compiled axis, because every
// upstream `test-net-*.js` needs a socket. So three working functions sat
// behind a suite that could not reach them.
//
// This is a static file in the sense the rest of `test/` uses: no handle, no
// loop, no subprocess. It asks the three what they answer.
//
// # Why the round-trip and not just the defaults
//
// Reading a default is a shape question -- `--mutate-addon` keeps the names and
// destroys behaviour, and a stub returning a constant would satisfy it. Setting
// a value and reading it back is not: it requires the addon to be holding
// state, which is the thing worth demonstrating.
//
// So the file asserts node's documented defaults *and* that a write is visible
// to the next read *and* that restoring puts the original back.
//
// The restore is not process hygiene -- `run.mjs` spawns `run-one.mjs` per
// file, so nothing here outlives this test. It is a third observation: a
// setter that only ever moves one way would satisfy both writes above and fail
// to come back.
//
// Node 24.20.0, checked directly before writing this:
//
//     getDefaultAutoSelectFamily()               true
//     setDefaultAutoSelectFamily(false), get()   false
//
// The attempt timeout is **not** asserted here, and the reason is worth the
// paragraph. This file first asserted it was 250, node's documented default. It
// passed on the compiled lane and failed on the interpreted one, and the
// compiled lane was the one that was wrong.
//
// `test/common/index.js:182` *sets* the default when it loads:
//
//     net.setDefaultAutoSelectFamilyAttemptTimeout(
//       platformTimeout(net.getDefaultAutoSelectFamilyAttemptTimeout() * 10));
//
// so every test requiring `../common` -- including this one -- sees 2500 in
// node. The compiled addon does not publish
// `setDefaultAutoSelectFamilyAttemptTimeout`, so `common` cannot scale it and
// the value stays 250. **The assertion passed because the defect stopped the
// harness doing what node does**, which is the fourth failure mode in the
// fixture rules: a control that suppresses the thing it controls for.
//
// It lives in `attempt-timeout-static.js` now, where it fails on the compiled
// lane until the setter is published.
"use strict";

require("../common");

const assert = require("assert");
const net = require("net");

assert.strictEqual(
  typeof net.getDefaultAutoSelectFamily,
  "function",
  "net.getDefaultAutoSelectFamily is missing",
);
assert.strictEqual(
  typeof net.setDefaultAutoSelectFamily,
  "function",
  "net.setDefaultAutoSelectFamily is missing",
);
assert.strictEqual(
  typeof net.getDefaultAutoSelectFamilyAttemptTimeout,
  "function",
  "net.getDefaultAutoSelectFamilyAttemptTimeout is missing",
);

// The defaults node ships.
const original = net.getDefaultAutoSelectFamily();
assert.strictEqual(typeof original, "boolean", "the default is not a boolean");
assert.strictEqual(original, true, "node's default for autoSelectFamily is true");

assert.strictEqual(
  typeof net.getDefaultAutoSelectFamilyAttemptTimeout(),
  "number",
  "the attempt timeout is not a number",
);

// A write has to be visible to the next read. A stub that answers a constant
// passes everything above and fails here.
try {
  net.setDefaultAutoSelectFamily(false);
  assert.strictEqual(
    net.getDefaultAutoSelectFamily(),
    false,
    "setDefaultAutoSelectFamily(false) was not observed by the next read",
  );

  net.setDefaultAutoSelectFamily(true);
  assert.strictEqual(
    net.getDefaultAutoSelectFamily(),
    true,
    "setDefaultAutoSelectFamily(true) was not observed by the next read",
  );
} finally {
  // Restored even if an assertion above threw, so the final check below is
  // about the setter and not about which line failed.
  net.setDefaultAutoSelectFamily(original);
}

assert.strictEqual(
  net.getDefaultAutoSelectFamily(),
  original,
  "the original default was not restored",
);
