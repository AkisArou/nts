'use strict';

// Applicable behavior retained from pinned Node v24.20.0
// test-buffer-alloc.js. That upstream file also exercises realms, prototype
// objects, coercion hooks, and function identity, all §13 non-goals.

require('../common');
const assert = require('assert');

{
  const bytes = Buffer.alloc(4);
  assert.strictEqual(bytes.length, 4);
  assert.strictEqual(bytes.byteOffset, 0);
  assert.strictEqual(bytes.offset, 0);
  assert(bytes.parent instanceof ArrayBuffer);
  assert.deepStrictEqual([...bytes], [0, 0, 0, 0]);
}

assert.strictEqual(Buffer.allocUnsafe(3.3).length, 3);
assert.strictEqual(Buffer.alloc(3.3).length, 3);
assert.throws(() => Buffer.alloc(-1), { code: 'ERR_OUT_OF_RANGE' });
assert.throws(() => Buffer.alloc('4'), { code: 'ERR_INVALID_ARG_TYPE' });

assert.deepStrictEqual([...Buffer.from('über')], [195, 188, 98, 101, 114]);
assert.deepStrictEqual([...Buffer.from('über', 'ascii')], [252, 98, 101, 114]);
assert.deepStrictEqual([...Buffer.alloc(5, '800A', 'hex')], [128, 10, 128, 10, 128]);
assert.throws(() => Buffer.alloc(2).write('x', 0, 1, 'invalid'), /Unknown encoding: invalid/);

assert.strictEqual(Buffer.from('=bad'.repeat(100), 'base64').length, 0);
assert.deepStrictEqual(Buffer.from('w0  ', 'base64'), Buffer.from('w0', 'base64'));
assert.strictEqual(Buffer.from('YW55=======', 'base64').toString(), 'any');

{
  const source = Buffer.from([0, 1, 2, 3, 4]);
  const view = source.slice(1, 4);
  view[1] = 9;
  assert.deepStrictEqual([...source], [0, 1, 9, 3, 4]);

  const empty = Buffer.alloc(0);
  assert.strictEqual(source.copy(empty, 1, 1, 1), 0);
  assert.throws(() => source.copy(Buffer.alloc(1), 0, 0x100000000), {
    code: 'ERR_OUT_OF_RANGE',
  });
}

assert.strictEqual(Buffer.from([0x81, 0xa3, 0x66]).inspect(), '<Buffer 81 a3 66>');
