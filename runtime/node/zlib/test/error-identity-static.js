"use strict";

// The identity of the error each decompressor family throws on corrupt input.
//
// **Two of node's sixty-five `zlib` test files assert an error's `code` at all.**
// That is not an oversight on their part: on node every one of these errors is
// constructed by the same C++ from the same library return, so `code`, `errno`
// and `message` cannot disagree with each other and there is nothing a test
// could catch. Here they are assembled in TypeScript from three separate native
// readings -- `nts_zlib_last_status`, `nts_zlib_last_error_code` and
// `nts_zlib_last_error_message` -- and any of the three can be wired to the
// wrong one without a single node test noticing.
//
// The three families disagree with each other in ways worth pinning:
//
//     zlib    Z_DATA_ERROR                  errno -3   negative
//     brotli  ERR__ERROR_FORMAT_PADDING_1   errno -14  negative
//     zstd    ZSTD_error_prefix_unknown     errno  10  POSITIVE
//
// The sign flip is the one to keep. An implementation that normalised every
// library's status into a single negative-errno convention would pass every
// round-trip test, every corrupt-input test that only checks *that* it threw,
// and `test-zlib-invalid-input.js` in full -- and would still hand callers a
// `-10` where node hands them `10`.
//
// Messages come from the compression libraries rather than from node, so they
// are asserted for the zlib family, where they are stable across versions and
// distinguish which decoder rejected the input. `inflateRaw` says something
// different from `inflate` on the same bytes, which is a real signal that the
// raw and framed paths are not silently the same call.

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
