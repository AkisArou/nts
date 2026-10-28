import assert from "node:assert/strict";
import test from "node:test";
import { deflateRawSync, deflateSync, gzipSync, gunzipSync, inflateRawSync, inflateSync } from "node:zlib";
import type {
  CompressionContext,
  CompressionFailure,
  CompressionFormat,
  CompressionResult,
} from "../src/provider/compression.ts";
import { NodeCompressionProvider } from "./node-compression-provider.ts";

// Original capability controls for Compression §§2–5 and RFC 7692 §7.2:
// https://compression.spec.whatwg.org/#supported-formats
// https://www.rfc-editor.org/rfc/rfc7692#section-7.2
// Format parsing, checksums, and DEFLATE work all remain in native node:zlib.

const formats: readonly CompressionFormat[] = ["gzip", "deflate", "deflate-raw"];
const empty = new Uint8Array(0);
const provider = new NodeCompressionProvider();

function context(value: CompressionContext | CompressionFailure): CompressionContext {
  assert.ok(!("failure" in value), "native context creation succeeds");
  return value;
}

function success(value: CompressionResult | CompressionFailure): CompressionResult {
  assert.ok(!("failure" in value), "native processing succeeds");
  return value;
}

function failure(
  value: CompressionResult | CompressionContext | CompressionFailure | void,
  expected: CompressionFailure["failure"],
): void {
  assert.ok(value !== undefined && "failure" in value, "native error is returned as a value");
  assert.equal(value.failure, expected);
}

function join(value: CompressionResult): Buffer {
  return Buffer.concat(value.chunks);
}

function encode(format: CompressionFormat, bytes: Uint8Array): Uint8Array {
  switch (format) {
    case "gzip": return gzipSync(bytes);
    case "deflate": return deflateSync(bytes);
    case "deflate-raw": return deflateRawSync(bytes);
  }
}

function decode(format: CompressionFormat, bytes: Uint8Array): Uint8Array {
  switch (format) {
    case "gzip": return gunzipSync(bytes);
    case "deflate": return inflateSync(bytes);
    case "deflate-raw": return inflateRawSync(bytes);
  }
}

function dictionaryMessage(): Uint8Array {
  const bytes = new Uint8Array(8192);
  for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 17 + (index >>> 4)) & 255;
  return bytes;
}

test("raw synchronous flush retains dictionary history until reset", () => {
  const compressor = context(provider.createCompressor("deflate-raw", 15));
  const decompressor = context(provider.createDecompressor("deflate-raw", 15));
  const message = dictionaryMessage();
  const first = join(success(compressor.process(message, "sync", Infinity)));
  assert.deepEqual(first.subarray(-4), Buffer.from([0, 0, 255, 255]));
  assert.deepEqual(join(success(decompressor.process(first, "sync", Infinity))), Buffer.from(message));

  const second = join(success(compressor.process(message, "sync", Infinity)));
  assert.deepEqual(second.subarray(-4), Buffer.from([0, 0, 255, 255]));
  assert.deepEqual(join(success(decompressor.process(second, "sync", Infinity))), Buffer.from(message));
  // The second message depends on the preceding native dictionary, rather than
  // each process call secretly starting a new independent DEFLATE stream.
  const independent = context(provider.createDecompressor("deflate-raw", 15));
  failure(independent.process(second, "sync", Infinity), "invalid-data");
  independent.close();

  assert.equal(compressor.reset(), undefined);
  assert.equal(decompressor.reset(), undefined);
  const reset = join(success(compressor.process(message, "sync", Infinity)));
  assert.deepEqual(reset, first);
  assert.deepEqual(join(success(decompressor.process(reset, "sync", Infinity))), Buffer.from(message));
  compressor.close();
  decompressor.close();
});

for (const format of formats) {
  test(`${format}: native output limits include exact and zero-byte boundaries`, () => {
    const bytes = new Uint8Array(64 * 1024).fill(65);
    const encoded = encode(format, bytes);
    for (const maximum of [0, 1, 16383, 16384, bytes.length - 1]) {
      const decoder = context(provider.createDecompressor(format, 15));
      failure(decoder.process(encoded, "finish", maximum), "output-limit");
      failure(decoder.process(empty, "none", Infinity), "operation");
      failure(decoder.reset(), "operation");
      decoder.close();
      decoder.close();
    }
    const exact = context(provider.createDecompressor(format, 15));
    const result = success(exact.process(encoded, "finish", bytes.length));
    assert.equal(result.consumed, encoded.length);
    assert.deepEqual(join(result), Buffer.from(bytes));
    exact.close();
    const zero = context(provider.createDecompressor(format, 15));
    assert.equal(success(zero.process(encode(format, empty), "finish", 0)).chunks.length, 0);
    zero.close();
  });

  test(`${format}: whole-chunk borrowing and output ownership survive later operations`, () => {
    const input = dictionaryMessage();
    const original = input.slice();
    const compressor = context(provider.createCompressor(format, 15));
    const first = success(compressor.process(input, "none", Infinity));
    assert.equal(first.consumed, input.length);
    input.fill(0);
    const last = success(compressor.process(empty, "finish", Infinity));
    const chunks = [...first.chunks, ...last.chunks];
    assert.deepEqual(decode(format, Buffer.concat(chunks)), Buffer.from(original));

    const saved = chunks.map((chunk) => chunk.slice());
    const buffers = new Set<ArrayBufferLike>();
    for (const chunk of chunks) {
      assert.ok(chunk instanceof Uint8Array);
      assert.equal(chunk.byteOffset, 0);
      assert.equal(chunk.buffer.byteLength, chunk.byteLength);
      assert.notEqual(chunk.buffer, input.buffer);
      assert.equal(buffers.has(chunk.buffer), false);
      buffers.add(chunk.buffer);
    }
    failure(compressor.process(empty, "none", Infinity), "operation");
    assert.equal(compressor.reset(), undefined);
    const next = success(compressor.process(original, "finish", Infinity));
    for (const chunk of next.chunks) assert.equal(buffers.has(chunk.buffer), false);
    compressor.close();
    assert.deepEqual(chunks, saved);
  });

  test(`${format}: unsupported window settings fail without changing them`, () => {
    for (const bits of [0, 7, 8, 16, 8.5, NaN, Infinity]) {
      failure(provider.createCompressor(format, bits), "unsupported");
    }
    for (const bits of [0, 7, 16, 8.5, NaN, Infinity]) {
      failure(provider.createDecompressor(format, bits), "unsupported");
    }
    for (const bits of [9, 15]) {
      const compressor = context(provider.createCompressor(format, bits));
      const decompressor = context(provider.createDecompressor(format, bits));
      const message = dictionaryMessage();
      const packed = join(success(compressor.process(message, "finish", Infinity)));
      assert.deepEqual(join(success(decompressor.process(packed, "finish", Infinity))), Buffer.from(message));
      compressor.close();
      decompressor.close();
    }
  });

  test(`${format}: invalid output budgets are terminal failure values`, () => {
    for (const limit of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER + 1, -Infinity]) {
      const compressor = context(provider.createCompressor(format, 15));
      failure(compressor.process(empty, "none", limit), "operation");
      failure(compressor.reset(), "operation");
      compressor.close();
    }
  });
}

// Original fixed fixture for "optional gzip fields": FTEXT, FEXTRA (an empty
// BC subfield), FNAME, FCOMMENT and FHCRC, with nondefault MTIME/XFL/OS. Payload
// and the 16 low header-CRC bits were produced using native gzipSync and crc32;
// no header parser, encoder, or checksum implementation runs in this test.
const optionalGzip = Buffer.from(
  "1f8b081f123456784dde0400424300006e616d6500636f6d6d656e740037e2" +
  "cb2f28c9cccf4bcc5148afca2c5048cb4ccd492906000100d1b514000000",
  "hex",
);

test("gzip validates optional fields across chunk boundaries and ignores metadata", () => {
  // Compression §3 and RFC 1952 §2.3.1.2 require validation without interpreting
  // optional field contents as application data.
  for (const split of [11, 13, 18, 24, 30]) {
    const decoder = context(provider.createDecompressor("gzip", 15));
    const first = success(decoder.process(optionalGzip.subarray(0, split), "none", Infinity));
    const last = success(decoder.process(optionalGzip.subarray(split), "finish", Infinity));
    assert.equal(Buffer.concat([...first.chunks, ...last.chunks]).toString(), "optional gzip fields");
    decoder.close();
  }
});

test("gzip rejects an incorrect optional FHCRC as a native failure", () => {
  const corrupt = Buffer.from(optionalGzip);
  corrupt[29] = corrupt[29]! ^ 1;
  const decoder = context(provider.createDecompressor("gzip", 15));
  failure(decoder.process(corrupt, "finish", Infinity), "invalid-data");
  failure(decoder.process(empty, "none", Infinity), "operation");
  decoder.close();
});

test("gzip rejects truncated optional fields at finish", () => {
  for (const end of [10, 11, 12, 15, 20, 28, 29, 30]) {
    const decoder = context(provider.createDecompressor("gzip", 15));
    const result = decoder.process(optionalGzip.subarray(0, end), "finish", Infinity);
    failure(result, "incomplete");
    assert.ok("failure" in result && result.failure === "incomplete");
    assert.deepEqual(result.chunks, []);
    decoder.close();
  }
});
