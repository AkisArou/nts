'use strict';

// Observable, non-terminating slice of upstream test-process-exit-recursive.js.
// The upstream call really exits the conformance child before it can report;
// replacing the documented/monkey-patchable `reallyExit` exposes the state
// machine without pretending that termination returned.
const assert = require('assert');

const realReallyExit = process.reallyExit;
const exits = [];
let events = 0;
process.reallyExit = (code) => exits.push(code);
process.on('exit', (code) => {
  events++;
  assert.strictEqual(code, 1);
  process.exit(0);
});

process.exit(1);
assert.strictEqual(events, 1);
assert.strictEqual(process.exitCode, 0);
assert(exits.length >= 1);
assert(exits.every((code) => code === 0));
process.reallyExit = realReallyExit;
