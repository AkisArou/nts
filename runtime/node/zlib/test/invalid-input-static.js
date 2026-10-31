'use strict';

// Supported assertions from pinned Node v26.13.0
// test/parallel/test-zlib-invalid-input.js:36-46,119-126 and 92-117.
// The upstream file remains unchanged and excluded for its spoofed typed-array
// length/byteLength accessors. The block below is byte-for-byte lines 92-117.
// Exit condition: once that accessor gap closes, re-include the upstream file
// and delete this focused copy instead of maintaining a fork.
const common = require('../common');
const assert = require('assert');
const zlib = require('zlib');

const decompressors = [
  new zlib.Unzip(),
  new zlib.Gunzip(),
  new zlib.Inflate(),
  new zlib.InflateRaw(),
  new zlib.BrotliDecompress(),
  new zlib.ZstdDecompress(),
];

for (const decompressor of decompressors) {
  decompressor.on('error', common.mustCall());
  decompressor.on('end', common.mustNotCall());
  decompressor.end('this is not valid compressed data.');
}

{
  // A block switch is invalid when the stream declares only one block type.
  const invalidBlockSwitch = Buffer.from(
    '200010414141fcffff07002228f00b60f7f41f000000',
    'hex',
  );
  const expectedError = {
    code: 'ERR__ERROR_FORMAT_BLOCK_SWITCH',
    errno: zlib.constants.BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH,
  };

  assert.strictEqual(expectedError.errno, -17);
  assert.throws(
    () => zlib.brotliDecompressSync(invalidBlockSwitch),
    expectedError,
  );

  const brotli = zlib.createBrotliDecompress();
  brotli.resume();
  brotli.on('error', common.expectsError(expectedError));
  brotli.on('end', common.mustNotCall());
  for (let i = 0; i < invalidBlockSwitch.length; i++) {
    brotli.write(invalidBlockSwitch.subarray(i, i + 1));
  }
  brotli.end();
}
