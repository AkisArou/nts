'use strict';

// Applicable cases from pinned Node v24.20.0 test-buffer-concat.js; its final
// case installs a spoofing property descriptor on a typed array.

require('../common');
const assert = require('assert');

const one = Buffer.from('asdf');
const flattened = Buffer.concat([one]);
assert.strictEqual(flattened.toString(), 'asdf');
assert.notStrictEqual(flattened, one);
assert.strictEqual(Buffer.concat([one, one]).toString(), 'asdfasdf');
assert.deepStrictEqual(Buffer.concat([one, one], 6), Buffer.from('asdfas'));
assert.deepStrictEqual(Buffer.concat([one], 8), Buffer.from([97, 115, 100, 102, 0, 0, 0, 0]));
assert.strictEqual(Buffer.concat([], 100).length, 0);
assert.deepStrictEqual(
  Buffer.concat([new Uint8Array([65, 66]), new Uint8Array([67, 68])]),
  Buffer.from('ABCD'),
);
assert.throws(() => Buffer.concat(null), { code: 'ERR_INVALID_ARG_TYPE' });
assert.throws(() => Buffer.concat([Buffer.from('x'), 3]), { code: 'ERR_INVALID_ARG_TYPE' });
assert.throws(() => Buffer.concat([one], 3.5), { code: 'ERR_OUT_OF_RANGE' });
