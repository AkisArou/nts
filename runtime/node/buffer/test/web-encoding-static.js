'use strict';

// Typed string cases from test-btoa-atob.js. Its remaining cases require
// arbitrary ToString hooks and observable identity with host-global methods.

require('../common');
const assert = require('assert');
const buffer = require('buffer');

assert.strictEqual(buffer.atob(' '), '');
assert.strictEqual(buffer.atob('  Y\fW\tJ\njZ A=\r= '), 'abcd');
assert.strictEqual(buffer.btoa('abcd'), 'YWJjZA==');
assert.throws(() => buffer.atob('a'), {
  name: 'InvalidCharacterError',
  code: 5,
  message: 'The string to be decoded is not correctly encoded.',
});
assert.throws(() => buffer.atob('A=='), {
  name: 'InvalidCharacterError',
  code: 5,
  message: 'The string to be decoded is not correctly encoded.',
});
assert.throws(() => buffer.atob('***'), {
  name: 'InvalidCharacterError',
  code: 5,
  message: 'Invalid character',
});
assert.throws(() => buffer.btoa('\u0100'), { name: 'InvalidCharacterError', code: 5 });
