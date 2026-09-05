'use strict';

// Statically representable behavior retained from pinned Node v24.20.0
// parallel/test-string-decoder.js. The broad fixture also calls the class as a
// function on an arbitrary receiver and reaches methods through `__proto__`.
const assert = require('assert');
const { StringDecoder } = require('string_decoder');

const defaultDecoder = new StringDecoder();
assert.strictEqual(defaultDecoder.encoding, 'utf8');

const utf8 = new StringDecoder('UTF-8');
assert.strictEqual(utf8.encoding, 'utf8');
assert.strictEqual(utf8.write(Buffer.from('e2', 'hex')), '');
assert.strictEqual(utf8.lastNeed, 2);
assert.strictEqual(utf8.lastTotal, 3);
assert.strictEqual(utf8.lastChar[0], 0xe2);
assert.strictEqual(utf8.write(Buffer.from('82', 'hex')), '');
assert.strictEqual(utf8.write(Buffer.from('ac', 'hex')), '€');
assert.strictEqual(utf8.lastNeed, 0);

assert.strictEqual(utf8.write(Buffer.from('f09f', 'hex')), '');
assert.strictEqual(utf8.end(), '�');
assert.strictEqual(utf8.lastNeed, 0);
assert.strictEqual(utf8.write(Buffer.from('$')), '$');
assert.strictEqual(utf8.end(), '');

const invalidUtf8 = new StringDecoder('utf8');
assert.strictEqual(invalidUtf8.write(Buffer.from('f0b841', 'hex')), '�A');
assert.strictEqual(invalidUtf8.end(), '');

const utf16 = new StringDecoder('utf16le');
assert.strictEqual(utf16.write(Buffer.from('3dd8', 'hex')), '');
assert.strictEqual(utf16.write(Buffer.from('4d', 'hex')), '');
assert.strictEqual(utf16.write(Buffer.from('dc', 'hex')), '👍');
assert.strictEqual(utf16.end(), '');

const base64 = new StringDecoder('base64');
assert.strictEqual(base64.write(Buffer.from([0x61])), '');
assert.strictEqual(base64.write(Buffer.from([0x62, 0x63])), 'YWJj');
assert.strictEqual(base64.end(), '');

const viewBytes = Uint8Array.from([0xe2, 0x82, 0xac]);
const view = new DataView(viewBytes.buffer);
assert.strictEqual(new StringDecoder('utf8').write(view), '€');

const text = new StringDecoder('utf8');
assert.strictEqual(text.text(Buffer.from([0x41]), 2), '');

assert.throws(
  () => new StringDecoder(1),
  { name: 'TypeError', code: 'ERR_UNKNOWN_ENCODING' },
);
assert.throws(
  () => new StringDecoder('not-an-encoding'),
  { name: 'TypeError', code: 'ERR_UNKNOWN_ENCODING' },
);
assert.throws(
  () => new StringDecoder('utf8').write(null),
  { name: 'TypeError', code: 'ERR_INVALID_ARG_TYPE' },
);
