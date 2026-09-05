'use strict';

// Numeric behavior retained from pinned Node v24.20.0
// test-buffer-writeuint.js. That file ends by requiring the UInt and Uint
// spellings to be the same observable function object, a §13 non-goal.

require('../common');
const assert = require('assert');

{
  const bytes = Buffer.alloc(8);
  assert.strictEqual(bytes.writeUInt8(0xff, 0), 1);
  assert.strictEqual(bytes.writeUint16BE(0x2343, 1), 3);
  assert.strictEqual(bytes.writeUInt16LE(0xff80, 3), 5);
  assert.strictEqual(bytes.writeUintBE(0x123456, 5, 3), 8);
  assert.deepStrictEqual([...bytes], [0xff, 0x23, 0x43, 0x80, 0xff, 0x12, 0x34, 0x56]);

  assert.strictEqual(bytes.readUint8(0), 0xff);
  assert.strictEqual(bytes.readUInt16BE(1), 0x2343);
  assert.strictEqual(bytes.readUint16LE(3), 0xff80);
  assert.strictEqual(bytes.readUIntBE(5, 3), 0x123456);
}

{
  const bytes = Buffer.alloc(8);
  assert.strictEqual(bytes.writeUint32LE(0xe7f90a6d, 0), 4);
  assert.strictEqual(bytes.readUInt32LE(0), 0xe7f90a6d);
  assert.strictEqual(bytes.writeBigUint64BE(0x0102030405060708n), 8);
  assert.strictEqual(bytes.readBigUInt64BE(), 0x0102030405060708n);
}

{
  const bytes = Buffer.alloc(8);
  assert.throws(() => bytes.writeUInt16BE(0x10000, 0), {
    code: 'ERR_OUT_OF_RANGE',
  });
  assert.throws(() => bytes.writeUIntBE(1, 0, 0), {
    code: 'ERR_OUT_OF_RANGE',
  });
  assert.throws(() => bytes.writeUIntBE(1, -1, 1), {
    code: 'ERR_OUT_OF_RANGE',
  });
  assert.throws(() => bytes.writeUInt8(1, '0'), {
    code: 'ERR_INVALID_ARG_TYPE',
  });
}

for (let width = 1; width <= 6; width++) {
  let value = 0;
  const expected = new Array(width);
  for (let index = 0; index < width; index++) {
    const byte = index + 1;
    value = value * 256 + byte;
    expected[index] = byte;
  }

  const bigEndian = Buffer.alloc(8);
  assert.strictEqual(bigEndian.writeUIntBE(value, 1, width), width + 1);
  assert.deepStrictEqual([...bigEndian.subarray(1, width + 1)], expected);
  assert.strictEqual(bigEndian.readUIntBE(1, width), value);

  const littleEndian = Buffer.alloc(8);
  assert.strictEqual(littleEndian.writeUintLE(value, 1, width), width + 1);
  assert.deepStrictEqual(
    [...littleEndian.subarray(1, width + 1)],
    expected.slice().reverse(),
  );
  assert.strictEqual(littleEndian.readUintLE(1, width), value);
}

{
  const bytes = Buffer.alloc(8);
  for (const byteLength of [NaN, 1.5, -1, 7, Infinity]) {
    assert.throws(() => bytes.writeUIntBE(1, 0, byteLength), {
      code: 'ERR_OUT_OF_RANGE',
    });
  }
  for (const offset of [NaN, 1.5, -1, Infinity]) {
    assert.throws(() => bytes.writeUintLE(1, offset, 1), {
      code: 'ERR_OUT_OF_RANGE',
    });
  }
}
