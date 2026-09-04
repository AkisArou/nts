'use strict';

// Applicable behavior retained from pinned Node v24.20.0
// test-buffer-from.js. Its coercion-hook and realm cases are intentionally not
// part of the statically typed runtime profile.

require('../common');
const assert = require('assert');

assert.deepStrictEqual(Buffer.from([0, 255, 256, -1]), Buffer.from([0, 255, 0, 255]));
assert.deepStrictEqual(
  Buffer.from({ type: 'Buffer', data: [1, 2, 257] }),
  Buffer.from([1, 2, 1]),
);

{
  const source = new Uint8Array([1, 2, 3]);
  const copy = Buffer.from(source);
  source[0] = 9;
  assert.deepStrictEqual([...copy], [1, 2, 3]);
}

{
  const backing = new ArrayBuffer(4);
  const source = new Uint8Array(backing);
  const view = Buffer.from(backing, 1, 2);
  source[1] = 7;
  assert.deepStrictEqual([...view], [7, 0]);
  assert.throws(() => Buffer.from(backing, 5), { code: 'ERR_BUFFER_OUT_OF_BOUNDS' });
}

assert.strictEqual(Buffer.from(new DataView(new ArrayBuffer(4))).length, 0);

{
  const source = new Uint16Array([0x0102, 0x0304, 0x0506]);
  const copy = Buffer.copyBytesFrom(source, 1, 1);
  const expected = [...new Uint8Array(source.buffer, source.byteOffset + 2, 2)];
  assert.deepStrictEqual([...copy], expected);
  source[1] = 0;
  assert.deepStrictEqual([...copy], expected);
}

assert.deepStrictEqual([...Buffer.copyBytesFrom(new Uint8Array([1, 2, 3]), 2, 100)], [3]);
assert.strictEqual(Buffer.copyBytesFrom(new Uint8Array([1]), 2).length, 0);
assert.strictEqual(Buffer.copyBytesFrom(new Uint8Array(0)).length, 0);
assert.throws(() => Buffer.copyBytesFrom(new DataView(new ArrayBuffer(1))), {
  code: 'ERR_INVALID_ARG_TYPE',
});
assert.throws(() => Buffer.copyBytesFrom(new Uint8Array(1), 1.5), {
  code: 'ERR_OUT_OF_RANGE',
});
