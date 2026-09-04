'use strict';

// Applicable behavior retained from pinned Node v24.20.0
// test-zlib-invalid-input.js. The omitted setup calls classes without `new`
// and installs spoofing accessors on a typed array.
const common = require('../common');
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
