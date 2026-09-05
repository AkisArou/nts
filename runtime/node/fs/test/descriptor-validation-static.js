'use strict';

// Upstream test-fs-write-no-fd.js accepts a generic TypeError, so the missing
// method produced by sabotage satisfies it. Assert the actual Node error
// contract while preserving its buffer and string call shapes.

const common = require('../common');
const assert = require('assert');
const fs = require('fs');

const expected = {
  code: 'ERR_INVALID_ARG_TYPE',
  name: 'TypeError',
  message: 'The "fd" argument must be of type number. Received null',
};

assert.throws(() => {
  fs.write(null, Buffer.allocUnsafe(1), 0, 1, common.mustNotCall());
}, expected);

assert.throws(() => {
  fs.write(null, '1', 0, 1, common.mustNotCall());
}, expected);
