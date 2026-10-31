"use strict";

// Native error identities retained from Node v26.13.0 lib/zlib.js
// (zlibOnError and zlibBufferSync) and src/node_zlib.cc
// (ZlibContext::GetErrorInfo, BrotliDecoderContext::GetErrorInfo and
// ZstdDecompressContext::GetErrorInfo). The three libraries have different
// status domains: zlib/Brotli use negative errno values, Zstd positive values.
// Their messages/codes are assembled across the declared native boundary;
// these corrupt inputs check that those independent readings stay together.

const assert = require("node:assert");
const zlib = require("node:zlib");

const CORRUPT = Buffer.from("this is not valid compressed data.");

function thrown(fn) {
  try {
    fn(CORRUPT);
  } catch (error) {
    return error;
  }
  return null;
}

// ------------------------------------------------------- the zlib family
for (const [name, fn, message] of [
  ["inflateSync", zlib.inflateSync, "incorrect header check"],
  ["gunzipSync", zlib.gunzipSync, "incorrect header check"],
  ["unzipSync", zlib.unzipSync, "incorrect header check"],
  ["inflateRawSync", zlib.inflateRawSync, "invalid code lengths set"],
]) {
  const error = thrown(fn);
  assert.notStrictEqual(error, null, `${name} threw`);
  assert.strictEqual(error.code, "Z_DATA_ERROR", `${name} code`);
  assert.strictEqual(error.errno, -3, `${name} errno`);
  assert.strictEqual(error.message, message, `${name} message`);
  assert.strictEqual(error instanceof Error, true, `${name} is an Error`);
  assert.strictEqual(Object.getPrototypeOf(error), Error.prototype, `${name} is a plain Error`);
}

// --------------------------------------------------------------- brotli
{
  const error = thrown(zlib.brotliDecompressSync);
  assert.notStrictEqual(error, null, "brotliDecompressSync threw");
  assert.strictEqual(error.code, "ERR__ERROR_FORMAT_PADDING_1");
  assert.strictEqual(error.errno, -14);
  assert.strictEqual(error.message, "Decompression failed");
}

// ----------------------------------------------------------------- zstd
{
  const error = thrown(zlib.zstdDecompressSync);
  assert.notStrictEqual(error, null, "zstdDecompressSync threw");
  assert.strictEqual(error.code, "ZSTD_error_prefix_unknown");
  // Positive, unlike the other two families. See the header.
  assert.strictEqual(error.errno, 10);
  assert.strictEqual(error.message, "Unknown frame descriptor");
}

// The three families must not have been collapsed into one code.
{
  const codes = new Set([
    thrown(zlib.inflateSync).code,
    thrown(zlib.brotliDecompressSync).code,
    thrown(zlib.zstdDecompressSync).code,
  ]);
  assert.strictEqual(codes.size, 3, "each family reports its own code");
}
