'use strict';

// Focused applicable coverage from Node v24.20.0
// `test-timers-async-store-leak.js`. The upstream file also spawns uninjected
// child processes and inspects AsyncLocalStorage's private resource fields;
// this retains the timer-owned callback and argument release assertions.

const common = require('../common');
const assert = require('assert');

{
  const argument = {};
  const timeout = setTimeout(common.mustNotCall(), 1000, argument);
  clearTimeout(timeout);
  assert.strictEqual(timeout._onTimeout, undefined);
  assert.strictEqual(timeout._timerArgs, undefined);
}

{
  const argument = {};
  const immediate = setImmediate(common.mustNotCall(), argument);
  clearImmediate(immediate);
  assert.strictEqual(immediate._onImmediate, undefined);
  assert.strictEqual(immediate._argv, undefined);
}

{
  const argument = {};
  const interval = setInterval(common.mustCall(function onInterval(received) {
    assert.strictEqual(received, argument);
    clearInterval(interval);
    queueMicrotask(common.mustCall(function checkIntervalRelease() {
      assert.strictEqual(interval._onTimeout, undefined);
      assert.strictEqual(interval._timerArgs, undefined);
    }));
  }), 1, argument);
}

{
  const argument = {};
  const immediate = setImmediate(common.mustCall(function onImmediate(received) {
    assert.strictEqual(received, argument);
    queueMicrotask(common.mustCall(function checkImmediateRelease() {
      assert.strictEqual(immediate._onImmediate, undefined);
      assert.strictEqual(immediate._argv, undefined);
    }));
  }), argument);
}
