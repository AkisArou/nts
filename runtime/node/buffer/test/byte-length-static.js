'use strict';

// Applicable cases from pinned Node v24.20.0 test-buffer-bytelength.js; the
// upstream file also requires cross-realm ArrayBuffer recognition.

require('../common');
const assert = require('assert');

assert.strictEqual(Buffer.byteLength(Buffer.from([1, 2, 3])), 3);
assert.strictEqual(Buffer.byteLength(new ArrayBuffer(8)), 8);
assert.strictEqual(Buffer.byteLength(new Uint16Array(8)), 16);
assert.strictEqual(Buffer.byteLength(new DataView(new ArrayBuffer(2))), 2);
assert.strictEqual(Buffer.byteLength('∑éllö wørl∂!', 'utf-8'), 19);
assert.strictEqual(Buffer.byteLength('aGVsbG8gd29ybGQ=', 'base64'), 11);
assert.strictEqual(Buffer.byteLength('hello world', ''), 11);
assert.strictEqual(Buffer.byteLength('hello world', 'unknown'), 11);
assert.throws(() => Buffer.byteLength(32), { code: 'ERR_INVALID_ARG_TYPE' });
