'use strict';

// Supported behavior retained from pinned Node v24.20.0
// parallel/test-util-deprecate.js. The upstream file also observes wrapper
// length and prototype grafting and imports the private pending deprecator.
const common = require('../common');
const assert = require('assert');
const { deprecate } = require('util');

const warnings = [];
process.on('warning', common.mustCall((warning) => {
  warnings.push({ message: warning.message, code: warning.code });
}, 4));

const receiver = { value: 41 };
const once = deprecate(function addOne() {
  assert.strictEqual(this, receiver);
  return this.value + 1;
}, 'once without a code');
assert.strictEqual(once.call(receiver), 42);
assert.strictEqual(once.call(receiver), 42);

deprecate(() => 1, 'first independent wrapper')();
deprecate(() => 2, 'second independent wrapper')();

deprecate(() => 3, 'first coded wrapper', 'NTS_TEST_CODE')();
deprecate(() => 4, 'same code is suppressed', 'NTS_TEST_CODE')();

process.on('exit', () => {
  assert.deepStrictEqual(warnings, [
    { message: 'once without a code', code: undefined },
    { message: 'first independent wrapper', code: undefined },
    { message: 'second independent wrapper', code: undefined },
    { message: 'first coded wrapper', code: 'NTS_TEST_CODE' },
  ]);
});

