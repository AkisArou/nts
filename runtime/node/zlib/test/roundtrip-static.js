'use strict';

// Applicable stream behavior retained from pinned Node v24.20.0 test-zlib.js.
// Its final block invokes Gzip without `new` and observes the resulting
// call-site deprecation warning, both outside the static runtime profile.
const common = require('../common');
const assert = require('assert');
const zlib = require('zlib');

function roundTrip(compressor, decompressor, input) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    compressor.on('error', reject);
    decompressor.on('error', reject);
    compressor.on('data', (chunk) => decompressor.write(chunk));
    compressor.on('end', () => decompressor.end());
    decompressor.on('data', (chunk) => chunks.push(chunk));
    decompressor.on('end', () => {
      assert.deepStrictEqual(Buffer.concat(chunks), input);
      resolve();
    });
    compressor.end(input);
  });
}

const input = Buffer.from('static zlib stream round trip '.repeat(4096));
Promise.all([
  roundTrip(new zlib.Deflate(), new zlib.Inflate(), input),
  roundTrip(new zlib.Gzip(), new zlib.Gunzip(), input),
  roundTrip(new zlib.Deflate(), new zlib.Unzip(), input),
  roundTrip(new zlib.Gzip(), new zlib.Unzip(), input),
  roundTrip(new zlib.DeflateRaw(), new zlib.InflateRaw(), input),
  roundTrip(new zlib.BrotliCompress(), new zlib.BrotliDecompress(), input),
  roundTrip(new zlib.ZstdCompress(), new zlib.ZstdDecompress(), input),
]).then(common.mustCall());
