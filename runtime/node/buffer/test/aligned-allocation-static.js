// Node26 lib/internal/buffer.js:1118-1138, plus backing-extent/sentinel guards.
// Both lanes run the same typed observer over their native allocation result.
// Codes: 1 length, 2 offset bounds, 3 offset granularity, 4 extent, 5 sentinel.
'use strict';
require('../common');
const assert = require('assert');
const { internalBinding } = require('internal/test/binding');
const { checkAlignedAllocation } = internalBinding('buffer');
for (const size of [0, 0.5, 1, 1.5, 9, 65, 65.5, 65536]) {
  for (const alignment of [1, 8, 64, 4096]) {
    assert.strictEqual(checkAlignedAllocation(size, alignment), 0,
                       `size=${size}, alignment=${alignment}`);
  }
}
