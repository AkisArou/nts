// `performance.nodeTiming`, less the assertions that need the first tick.
//
// Preserves node v24.20.0 test/parallel/test-performance-nodetiming.js, and
// the `nodeTiming` checks of test/sequential/test-perf-hooks.js and of the
// fixture test/fixtures/test-nodetiming-uvmetricsinfo.js.
//
// Upstream asserts `loopStart === -1`, `idleTime === 0` and a zero
// `uvMetricsInfo` at the top level of the main script, which is only true on
// the first tick, before the event loop has started. This runner evaluates a
// test body after node's loop is already running, so those three are the
// runner's to answer, not the module's (`not-applicable` says so). What the
// module decides -- the fields, their order, which are live, the milestones'
// order, `loopExit` before exit, the spread copy -- is asserted here.

'use strict';

const common = require('../common');
const assert = require('assert');
const { performance } = require('perf_hooks');

const { nodeTiming } = performance;
assert.strictEqual(nodeTiming.name, 'node');
assert.strictEqual(nodeTiming.entryType, 'node');
assert.strictEqual(nodeTiming.startTime, 0);
const now = performance.now();
assert.ok(nodeTiming.duration >= now);

// Check that the nodeTiming milestone values are in the correct order and greater than 0.
const keys = ['nodeStart', 'v8Start', 'environment', 'bootstrapComplete'];
for (let idx = 0; idx < keys.length; idx++) {
  if (idx === 0) {
    assert.ok(nodeTiming[keys[idx]] >= 0);
    continue;
  }
  assert.ok(nodeTiming[keys[idx]] > nodeTiming[keys[idx - 1]], `expect nodeTiming['${keys[idx]}'] > nodeTiming['${keys[idx - 1]}']`);
}
assert.strictEqual(nodeTiming.loopExit, -1);

// From test/sequential/test-perf-hooks.js: the fields are own and enumerable,
// so spreading copies them, and `duration` is computed on each read.
const initialTiming = { ...nodeTiming };
for (const field of ['name', 'entryType', 'startTime', 'duration', 'nodeStart',
                     'v8Start', 'environment', 'loopStart', 'loopExit',
                     'bootstrapComplete', 'idleTime']) {
  assert.strictEqual(typeof initialTiming[field], typeof nodeTiming[field], field);
}
assert.strictEqual(initialTiming.nodeStart, nodeTiming.nodeStart);
assert.strictEqual(initialTiming.bootstrapComplete, nodeTiming.bootstrapComplete);
{
  const uptime1 = Date.now() - performance.timeOrigin;
  const uptime2 = performance.now();
  assert(Math.abs(uptime1 - uptime2) < 50, `${uptime1} - ${uptime2}`);
}

// `toJSON` reports every field but `uvMetricsInfo`, as node's does.
assert.deepStrictEqual(
  Object.keys(JSON.parse(JSON.stringify(nodeTiming))),
  ['name', 'entryType', 'startTime', 'duration', 'nodeStart', 'v8Start',
   'bootstrapComplete', 'environment', 'loopStart', 'loopExit', 'idleTime'],
);

// From the uvMetricsInfo fixture, the part that holds on any tick: an
// iteration of the loop counts.
{
  const before = nodeTiming.uvMetricsInfo;
  assert.deepStrictEqual(Object.keys(before), ['loopCount', 'events', 'eventsWaiting']);
  setImmediate(common.mustCall(() => {
    assert.ok(nodeTiming.uvMetricsInfo.loopCount > before.loopCount);
  }));
}

setTimeout(common.mustCall(() => {
  assert.ok(nodeTiming.idleTime >= 0);
  assert.ok(nodeTiming.idleTime + nodeTiming.loopExit <= nodeTiming.duration);
  assert.ok(nodeTiming.loopStart >= nodeTiming.bootstrapComplete);
}, 1), 1);
