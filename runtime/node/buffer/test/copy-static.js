'use strict';

// Typed cases from pinned Node v24.20.0 test-buffer-copy.js. Its remaining
// generic Function.call and Symbol.toPrimitive cases are §13 non-goals.

require('../common');
const assert = require('assert');

const source = Buffer.alloc(1024, 7);
const target = Buffer.alloc(512, 9);
assert.strictEqual(source.copy(target, 0, 0, 512), 512);
assert(target.every((value) => value === 7));
assert.strictEqual(source.copy(target, 0, 0, 512.5), 512);
assert.strictEqual(source.copy(target), 512);
assert.strictEqual(source.copy(target, target.length, 0, 10), 0);
assert.strictEqual(source.copy(target, 0, 100, 10), 0);
assert.throws(() => source.copy(target, -1), { code: 'ERR_OUT_OF_RANGE' });
assert.throws(() => source.copy(target, 0, source.length + 1), { code: 'ERR_OUT_OF_RANGE' });

const bytes = new Uint8Array(4);
assert.strictEqual(Buffer.from([1, 2, 3, 4]).copy(bytes), 4);
assert.deepStrictEqual([...bytes], [1, 2, 3, 4]);

const overlap = Buffer.from([1, 2, 3, 4]);
assert.strictEqual(overlap.copy(overlap, 0, 1), 3);
assert.deepStrictEqual([...overlap], [2, 3, 4, 4]);
