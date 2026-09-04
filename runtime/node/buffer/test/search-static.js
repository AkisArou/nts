'use strict';

// Applicable cases from pinned Node v24.20.0 test-buffer-indexof.js. Its final
// assertion treats a prototype method as a constructor, a §13 non-goal.

require('../common');
const assert = require('assert');

const value = Buffer.from('abcdefabc');
assert.strictEqual(value.indexOf('bc'), 1);
assert.strictEqual(value.indexOf('bc', 2), 7);
assert.strictEqual(value.indexOf('a', -1), -1);
assert.strictEqual(value.indexOf('a', -value.length), 0);
assert.strictEqual(value.indexOf('a', -Infinity), 0);
assert.strictEqual(value.indexOf('a', Infinity), -1);
assert.strictEqual(value.lastIndexOf('bc'), 7);
assert.strictEqual(value.lastIndexOf('bc', 6), 1);
assert.strictEqual(value.lastIndexOf('a', -1), 6);
assert.strictEqual(value.lastIndexOf('a', -value.length - 1), -1);
assert.strictEqual(value.indexOf('c', 0, 2), -1);
assert.strictEqual(value.indexOf('c', 0, 3), 2);
assert.strictEqual(value.lastIndexOf('a', 8, 6), 0);
assert.strictEqual(Buffer.from('ff').indexOf(Buffer.from('f'), 1, 'ucs2'), -1);
assert.throws(() => value.indexOf('x', 'unknown'), /Unknown encoding: unknown/);
