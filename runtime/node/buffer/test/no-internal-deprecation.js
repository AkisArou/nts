// Flags: --pending-deprecation
// Guard the native adapter boundary used by Node26's Buffer/crypto tests.
// The upstream reproducer is test/parallel/test-crypto-gcm-explicit-short-tag.js.
'use strict';
require('../common');
const assert = require('assert');
process.on('warning', (warning) => {
  assert.notStrictEqual(warning.name, 'DeprecationWarning', warning.stack);
});
const { Buffer } = require('buffer');
Buffer.allocUnsafe(65).fill(1);
Buffer.allocUnsafeSlow(9, 64).fill(2);
