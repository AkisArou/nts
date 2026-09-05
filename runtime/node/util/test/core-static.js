'use strict';

// Supported behavior retained from pinned Node v24.20.0 parallel/test-util.js.
// The upstream file also requires vm realms, forged prototypes, private
// internal errors, and `_extend`'s arbitrary dynamic property copying.
const assert = require('assert');
const util = require('util');

assert.strictEqual(util.isArray([]), true);
assert.strictEqual(util.isArray(new Array(4)), true);
assert.strictEqual(util.isArray({ length: 0 }), false);
assert.strictEqual(util.isArray(/regexp/), false);
assert.strictEqual(util.isArray(new Error('not an array')), false);

assert.strictEqual(util.toUSVString('plain'), 'plain');
assert.strictEqual(util.toUSVString('high\ud801'), 'high\ufffd');
assert.strictEqual(util.toUSVString('low\udc00'), 'low\ufffd');
assert.strictEqual(util.toUSVString('pair\ud83d\ude00'), 'pair😀');

assert.strictEqual(util.stripVTControlCharacters('plain'), 'plain');
assert.strictEqual(
  util.stripVTControlCharacters('\u001b[31mred\u001b[39m'),
  'red',
);

