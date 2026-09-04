'use strict';

// Applicable primitive range cases from pinned Node v24.20.0
// test-buffer-tostring-range.js. Arbitrary object conversion is excluded.

require('../common');
const assert = require('assert');

const value = Buffer.from('abc');
assert.strictEqual(value.toString('ascii', 3), '');
assert.strictEqual(value.toString('ascii', -1, 3), 'abc');
assert.strictEqual(value.toString('ascii', 1.99, 3), 'bc');
assert.strictEqual(value.toString('ascii', '1', 3), 'bc');
assert.strictEqual(value.toString('ascii', NaN, 3), 'abc');
assert.strictEqual(value.toString('ascii', 0, 1.99), 'a');
assert.strictEqual(value.toString('ascii', 0, 'node.js'), '');
assert.strictEqual(value.toString('ascii', 0, Infinity), 'abc');
assert.strictEqual(Buffer.from([0xde, 0xad, 0xbe]).toString('hex', 1), 'adbe');
assert.strictEqual(Buffer.from('Hello').toString('base64'), 'SGVsbG8=');
