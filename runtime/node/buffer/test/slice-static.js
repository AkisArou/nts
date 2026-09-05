'use strict';

// Applicable slice cases from pinned Node v24.20.0 test-buffer-slice.js. The
// upstream file also invokes the deprecated callable Buffer constructor.

require('../common');
const assert = require('assert');

const value = Buffer.from('0123456789');
const cases = [
  [value.slice(), '0123456789'],
  [value.slice(2), '23456789'],
  [value.slice(5, 8), '567'],
  [value.slice(-5, -3), '56'],
  [value.slice(-20, 10), '0123456789'],
  [value.slice(65536, 0), ''],
  [value.slice(-0.5), '0123456789'],
];

for (const [actual, expected] of cases) {
  assert.strictEqual(actual.toString(), expected);
}

const shared = value.slice(1, 3);
shared[0] = 120;
assert.strictEqual(value.toString(), '0x23456789');
assert.strictEqual(Buffer.alloc(0).slice(0, 1).length, 0);
