'use strict';

// Applicable behavior retained from pinned Node v24.20.0
// test-buffer-fill.js. The upstream file irreducibly also calls extracted
// methods with Function.apply, reaches direct internal bindings, installs a
// Symbol.toPrimitive hook, and redefines a typed-array length property.

require('../common');
const assert = require('assert');

assert.deepStrictEqual([...Buffer.alloc(7, 'abc')], [97, 98, 99, 97, 98, 99, 97]);
assert.deepStrictEqual([...Buffer.alloc(5, '6102', 'hex')], [97, 2, 97, 2, 97]);
assert.deepStrictEqual([...Buffer.alloc(5, Buffer.from([1, 2]))], [1, 2, 1, 2, 1]);

{
  const value = Buffer.alloc(6);
  assert.strictEqual(value.fill('ab', 1, 5), value);
  assert.deepStrictEqual([...value], [0, 97, 98, 97, 98, 0]);
}

assert.deepStrictEqual([...Buffer.alloc(4).fill('a', 'latin1')], [97, 97, 97, 97]);
assert.deepStrictEqual([...Buffer.alloc(5).fill('ab', 1, 'utf8')], [0, 97, 98, 97, 98]);
assert.deepStrictEqual([...Buffer.alloc(4).fill('aazz', 'hex')], [170, 170, 170, 170]);
assert.deepStrictEqual([...Buffer.alloc(3, 9).fill('')], [0, 0, 0]);
assert.deepStrictEqual([...Buffer.alloc(3).fill(-1)], [255, 255, 255]);

assert.throws(() => Buffer.alloc(3).fill('zz', 'hex'), {
  code: 'ERR_INVALID_ARG_VALUE',
});
assert.throws(() => Buffer.alloc(3).fill(new Uint8Array(0)), {
  code: 'ERR_INVALID_ARG_VALUE',
});
assert.throws(() => Buffer.alloc(3).fill('a', -1), {
  code: 'ERR_OUT_OF_RANGE',
});
assert.throws(() => Buffer.alloc(3).fill('a', 0, 4), {
  code: 'ERR_OUT_OF_RANGE',
});
assert.throws(() => Buffer.alloc(3).fill('a', 0, 3, false), {
  code: 'ERR_INVALID_ARG_TYPE',
});
assert.throws(() => Buffer.alloc(3).fill('a', 'not-an-encoding'), {
  code: 'ERR_UNKNOWN_ENCODING',
});

{
  const value = Buffer.from([1, 2, 3]);
  assert.strictEqual(value.fill(9, 4), value);
  assert.deepStrictEqual([...value], [1, 2, 3]);
}
