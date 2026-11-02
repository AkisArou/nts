import { NativeCompressionProvider } from "../../../../runtime/web-platform/providers/native/compression/provider.ts";
import type { CompressionContext, CompressionFailure, CompressionFormat, CompressionResult }
  from "../../../../runtime/web-platform/src/provider/compression.ts";

function context(result: CompressionContext | CompressionFailure): CompressionContext {
  if ("failure" in result) throw new Error(result.failure);
  return result;
}

function result(value: CompressionResult | CompressionFailure): CompressionResult {
  if ("failure" in value) throw new Error(value.failure);
  return value;
}

function bytes(chunks: readonly Uint8Array[]): Uint8Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const output = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) { output.set(chunk, at); at += chunk.length; }
  return output;
}

function check(ok: boolean): void { if (!ok) throw new Error("compression control"); }

export function roundTrip(format: CompressionFormat, size: number): number {
  const provider = new NativeCompressionProvider();
  const input = new Uint8Array(size);
  for (let i = 0; i < size; i++) input[i] = (i * 17 + (i >>> 7)) & 255;
  const compressor = context(provider.createCompressor(format, 15));
  const encoded = bytes(result(compressor.process(input, "finish", Infinity)).chunks);
  compressor.close(); compressor.close();
  const decoder = context(provider.createDecompressor(format, 15));
  const decoded = result(decoder.process(encoded, "finish", Infinity));
  check(decoded.consumed === encoded.length);
  const output = bytes(decoded.chunks);
  check(output.length === input.length);
  let checksum = 0;
  for (let i = 0; i < output.length; i++) {
    check(output[i] === input[i]);
    checksum = (checksum + (output[i] ?? 0)) | 0;
  }
  check(decoder.reset() === undefined);
  const again = result(decoder.process(encoded, "finish", Infinity));
  check(bytes(again.chunks).length === size);
  decoder.close(); decoder.close();
  return checksum;
}

console.log(roundTrip("brotli", 1024));
console.log(roundTrip("brotli", 1048576));
console.log(roundTrip("gzip", 1024));
console.log(roundTrip("deflate", 1024));
console.log(roundTrip("deflate-raw", 1024));

// Actual compiled value shape, separate from the copying Node test transport.
for (const size of [1, 16384]) {
  const provider = new NativeCompressionProvider();
  const encoder = context(provider.createCompressor("brotli", 15));
  const encoded = bytes(result(encoder.process(new Uint8Array(size).fill(65), "finish", Infinity)).chunks);
  const decoder = context(provider.createDecompressor("brotli", 15));
  const decoded = result(decoder.process(encoded, "finish", Infinity));
  check(decoded.chunks.length === 1);
  for (const chunk of decoded.chunks) {
    check(chunk.byteLength === size);
    check(chunk.byteOffset + chunk.byteLength <= chunk.buffer.byteLength);
    console.log(chunk.byteLength);
    console.log(chunk.buffer.byteLength);
  }
  encoder.close();
  decoder.close();
}
