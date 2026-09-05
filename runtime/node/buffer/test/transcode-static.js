'use strict';

// ICU edge behavior not covered by test-icu-transcode.js: malformed input,
// odd UTF-16 tails, source-ASCII substitutions, and default-ignorable code
// points. These cases were differential-checked against pinned Node v24.20.0.

require('../common');
const assert = require('assert');
const { transcode } = require('buffer');

assert.deepStrictEqual(
  transcode(Uint8Array.of(0x80), 'utf8', 'utf8'),
  Buffer.from('\ufffd'),
);
assert.deepStrictEqual(
  transcode(Uint8Array.of(0x80), 'utf8', 'latin1'),
  Buffer.from('?'),
);
assert.throws(
  () => transcode(Uint8Array.of(0x80), 'utf8', 'utf16le'),
  { code: 'U_INVALID_CHAR_FOUND', errno: 10 },
);
assert.throws(
  () => transcode(Uint8Array.of(0x61), 'unknown', 'utf8'),
  { code: 'U_ILLEGAL_ARGUMENT_ERROR', errno: 1 },
);

assert.deepStrictEqual(
  transcode(Uint8Array.of(97, 0, 98), 'utf16le', 'utf8'),
  Buffer.from('a'),
);
assert.deepStrictEqual(
  transcode(Uint8Array.of(1), 'utf16le', 'utf16le'),
  Buffer.from('\ufffd', 'utf16le'),
);
assert.throws(
  () => transcode(Uint8Array.of(1), 'utf16le', 'utf8'),
  { code: 'U_INVALID_CHAR_FOUND' },
);

assert.deepStrictEqual(
  transcode(Buffer.from('\u034f'), 'utf8', 'ascii'),
  Buffer.alloc(0),
);
assert.deepStrictEqual(
  transcode(Uint8Array.of(0x80), 'ascii', 'utf8'),
  Buffer.from('\ufffd'),
);
assert.deepStrictEqual(
  transcode(Uint8Array.of(0x80), 'ascii', 'utf16le'),
  Buffer.from([0x80, 0]),
);
