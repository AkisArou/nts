'use strict';

// Static class inheritance is supported. The upstream test builds the same
// relationship by mutating three prototype chains at runtime.

require('../common');
const assert = require('assert');

class SummingBuffer extends Buffer {
  sum() {
    let total = 0;
    for (const byte of this) total += byte;
    return total;
  }
}

const value = new SummingBuffer([1, 2, 3]);
assert(value instanceof Buffer);
assert(value instanceof Uint8Array);
assert.strictEqual(value.sum(), 6);
assert.strictEqual(value.toString('hex'), '010203');
