"use strict";

// Non-hollow form of Node v24.20.0
// `test/parallel/test-os-constants-signals.js`. The upstream assertion accepts
// the TypeError caused by a completely absent constants object as success.
const assert = require("node:assert");
const { constants } = require("node:os");

assert.strictEqual(typeof constants, "object");
assert.strictEqual(typeof constants.signals, "object");
assert.strictEqual(Object.isFrozen(constants.signals), true);
assert.throws(() => (constants.signals.FOOBAR = 1337), TypeError);
