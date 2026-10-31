import type { Transform } from "../../../stream/src/main.ts";
import type { Buffer } from "../../../buffer/src/main.ts";
import type { ZipReadOptions, ZipMemberInfo, DecodeError } from "./types.ts";
// From Node v26.13.0 lib/internal/zip/compression.js.
/// <reference path="../native.d.ts" />
import { ERR_ZIP_ENTRY_CORRUPT, ERR_ZIP_ENTRY_TOO_LARGE, ERR_ZIP_UNSUPPORTED_FEATURE } from "../../../internal/errors.ts";
import { kMaxLength } from "../../../buffer/src/main.ts";
import { compose } from "../../../stream/src/main.ts";
import { FLAG_ENCRYPTED, METHOD_STORE, METHOD_DEFLATE, METHOD_ZSTD } from "./constants.ts";
import * as zlibFacade from "../main.ts";


// Compression/decompression plumbing over the lazily-required `zlib` facade:
// one-shot (async and sync) and streaming deflate/inflate/zstd helpers, plus
// the member decoders that add method dispatch, size bounding, and CRC-32
// verification on top.









// `internal/zip` is required from `lib/zlib.js`, so it must not require the
// public `zlib` facade at load time (its module.exports is not yet
// populated). Compression is only needed once an entry is actually read or
// written, well after `zlib.js` has finished loading, so a lazy reference is
// enough to break the cycle.
let zlib: typeof zlibFacade | undefined;
function lazyZlib() : typeof zlibFacade {
  zlib ??= zlibFacade;
  return zlib;
}

// -- compression plumbing ------------------------------------------------------

// The one-shot (async/sync) and streaming helpers below are thin adapters that
// promisify or stream-wrap the lazy `zlib` facade; individually trivial, they
// exist only so the rest of the module never touches `zlib` directly.

function deflateRawAsync(buffer: Buffer) : Promise<Buffer> {
  return new Promise((resolve, reject) => {
    lazyZlib().deflateRaw(buffer, (err, result) => {
      if (err) reject(err);
      else resolve(result as Buffer);
    });
  });
}

function inflateRawAsync(buffer: Buffer, options: { maxOutputLength: number }) : Promise<Buffer> {
  return new Promise((resolve, reject) => {
    lazyZlib().inflateRaw(buffer, options, (err, result) => {
      if (err) reject(err);
      else resolve(result as Buffer);
    });
  });
}

// Drive `source` through a zlib transform stream, returning an async-iterable
// stream of its output. `compose()` (pipeline-backed) wires error propagation
// both ways and tears the whole chain down when the consumer errors or stops
// early, so an abandoned iteration cannot leak the pipeline.
function pumpThroughTransform(source: AsyncIterable<Uint8Array>, transform: Transform) : AsyncIterable<Buffer> {
  return compose(source, transform) as AsyncIterable<Buffer>;
}

function deflateRawStream(source: AsyncIterable<Uint8Array>) : AsyncIterable<Buffer> {
  return pumpThroughTransform(source, lazyZlib().createDeflateRaw());
}

function inflateRawStream(source: AsyncIterable<Uint8Array>) : AsyncIterable<Buffer> {
  return pumpThroughTransform(source, lazyZlib().createInflateRaw());
}

function zstdCompressAsync(buffer: Buffer) : Promise<Buffer> {
  return new Promise((resolve, reject) => {
    lazyZlib().zstdCompress(buffer, (err, result) => {
      if (err) reject(err);
      else resolve(result as Buffer);
    });
  });
}

function zstdDecompressAsync(buffer: Buffer, options: { maxOutputLength: number }) : Promise<Buffer> {
  return new Promise((resolve, reject) => {
    lazyZlib().zstdDecompress(buffer, options, (err, result) => {
      if (err) reject(err);
      else resolve(result as Buffer);
    });
  });
}

function zstdCompressStream(source: AsyncIterable<Uint8Array>) : AsyncIterable<Buffer> {
  return pumpThroughTransform(source, lazyZlib().createZstdCompress());
}

function zstdDecompressStream(source: AsyncIterable<Uint8Array>) : AsyncIterable<Buffer> {
  return pumpThroughTransform(source, lazyZlib().createZstdDecompress());
}


function deflateRawSync(buffer: Buffer) : Buffer {
  return lazyZlib().deflateRawSync(buffer) as Buffer;
}

function zstdCompressSync(buffer: Buffer) : Buffer {
  return lazyZlib().zstdCompressSync(buffer) as Buffer;
}

/**
 * @typedef {{
 *   name: string,
 *   flags: number,
 *   method: number,
 *   crc32: number,
 *   uncompressedSize: number,
 * }} ZipMemberInfo
 */

// Shared entry guards for the member decoders below: encryption and
// unsupported compression methods are rejected up front, and when the caller
// bounds the output, a declared size beyond that bound fails before anything
// is decompressed or allocated.
function assertDecodable(info: ZipMemberInfo, options?: ZipReadOptions) : void {
  if (info.flags & FLAG_ENCRYPTED) {
    throw new ERR_ZIP_UNSUPPORTED_FEATURE(
      `entry ${JSON.stringify(info.name)} is encrypted`);
  }
  if (info.method !== METHOD_STORE && info.method !== METHOD_DEFLATE && info.method !== METHOD_ZSTD) {
    throw new ERR_ZIP_UNSUPPORTED_FEATURE(
      `entry ${JSON.stringify(info.name)} uses compression method ${info.method}`);
  }
  if (options?.maxSize !== undefined && info.uncompressedSize > options.maxSize) {
    throw new ERR_ZIP_ENTRY_TOO_LARGE(
      `entry ${JSON.stringify(info.name)} declares ${info.uncompressedSize} bytes, ` +
      `exceeding the ${options.maxSize} byte limit`);
  }
}

// Bound one-shot decompression by the declared size, not just the caller's
// limit: a member that decompresses to more than it declares is corrupt by
// definition, so there is no reason to materialize more than `declared + 1`
// bytes (the +1 makes an overrun detectable) no matter how generous `maxSize`
// is. This keeps a tiny archive from forcing a `maxSize`-sized allocation.
function outputCap(info: ZipMemberInfo, options?: ZipReadOptions) : number {
  return Math.min(
    info.uncompressedSize + 1, options?.maxSize ?? kMaxLength, kMaxLength);
}

// Map a one-shot decompression failure to a corrupt-entry error.
// `assertDecodable()` has already ensured `declared <= maxSize`, so hitting
// the output cap always means the stream produced more than the member
// declared.
function rethrowDecodeFailure(err: DecodeError, info: ZipMemberInfo, method: number) : never {
  if (err?.code === 'ERR_BUFFER_TOO_LARGE') {
    throw new ERR_ZIP_ENTRY_CORRUPT(
      `entry ${JSON.stringify(info.name)} ` +
      `${method === METHOD_DEFLATE ? 'inflates' : 'decompresses'} beyond its ` +
      `declared size of ${info.uncompressedSize} bytes`);
  }
  throw new ERR_ZIP_ENTRY_CORRUPT(
    `entry ${JSON.stringify(info.name)} failed to ` +
    `${method === METHOD_DEFLATE ? 'inflate' : 'decompress'}: ${err.message}`);
}

// Enforce the declared size and (unless opted out) the CRC-32 on a fully
// decoded member.
function checkDecoded(data: Buffer, info: ZipMemberInfo, verify: boolean) : void {
  if (data.length !== info.uncompressedSize) {
    throw new ERR_ZIP_ENTRY_CORRUPT(
      `entry ${JSON.stringify(info.name)} produced ${data.length} bytes, expected ` +
      `${info.uncompressedSize}`);
  }
  if (verify && nts_crc32(data, 0) !== info.crc32) {
    throw new ERR_ZIP_ENTRY_CORRUPT(
      `entry ${JSON.stringify(info.name)} failed CRC-32 verification`);
  }
}

/**
 * Decodes one member's compressed byte stream: rejects encrypted entries and
 * unsupported compression methods, inflates method 8 or decompresses method
 * 93 (Zstandard), enforces the declared uncompressed size and verifies
 * CRC-32 (on by default).
 * @param {AsyncIterable<Buffer>} source
 * @param {ZipMemberInfo} info
 * @param {{ verify?: boolean, maxSize?: number }} [options]
 * @yields {Buffer}
 */
async function* decodeMemberStream(source: AsyncIterable<Buffer>, info: ZipMemberInfo, options?: ZipReadOptions) : AsyncGenerator<Buffer> {
  assertDecodable(info, options);
  const verify = options?.verify !== false;
  let produced = 0;
  let state = 0;
  const decoded = info.method === METHOD_DEFLATE ? inflateRawStream(source) :
    info.method === METHOD_ZSTD ? zstdDecompressStream(source) : source;
  for await (const chunk of decoded) {
    produced += chunk.length;
    if (produced > info.uncompressedSize) {
      throw new ERR_ZIP_ENTRY_CORRUPT(
        `entry ${JSON.stringify(info.name)} inflates beyond its declared size of ` +
        `${info.uncompressedSize} bytes`);
    }
    if (verify) state = nts_crc32(chunk, state);
    yield chunk;
  }
  if (produced !== info.uncompressedSize) {
    throw new ERR_ZIP_ENTRY_CORRUPT(
      `entry ${JSON.stringify(info.name)} is truncated: got ${produced} of ` +
      `${info.uncompressedSize} bytes`);
  }
  if (verify && state !== info.crc32) {
    throw new ERR_ZIP_ENTRY_CORRUPT(
      `entry ${JSON.stringify(info.name)} failed CRC-32 verification`);
  }
}

/**
 * Decodes one member held completely in `compressed`, in one shot: the same
 * guards, declared-size bounding, and CRC-32 verification as
 * `decodeMemberStream()`, returning the whole decoded member. For the store
 * method the input buffer itself is returned - callers that must hand out
 * caller-owned memory copy it (see `zipEntry.content()`).
 * @param {Buffer} compressed
 * @param {ZipMemberInfo} info
 * @param {{ verify?: boolean, maxSize?: number }} [options]
 * @returns {Promise<Buffer>}
 */
async function decodeMemberAsync(compressed: Buffer, info: ZipMemberInfo, options?: ZipReadOptions) : Promise<Buffer> {
  assertDecodable(info, options);
  const cap = outputCap(info, options);
  let data: Buffer;
  if (info.method === METHOD_DEFLATE) {
    try {
      data = await inflateRawAsync(compressed, { maxOutputLength: cap });
    } catch (err) {
      rethrowDecodeFailure(err as DecodeError, info, METHOD_DEFLATE);
    }
  } else if (info.method === METHOD_ZSTD) {
    try {
      data = await zstdDecompressAsync(compressed, { maxOutputLength: cap });
    } catch (err) {
      rethrowDecodeFailure(err as DecodeError, info, METHOD_ZSTD);
    }
  } else {
    data = compressed;
  }
  checkDecoded(data, info, options?.verify !== false);
  return data;
}

/**
 * The synchronous counterpart of `decodeMemberAsync()`. There is no public
 * synchronous incremental inflate API, so - unlike the streaming path -
 * `compressed` must already be the member's complete compressed byte
 * stream, and the whole result is produced (and verified) in one call
 * rather than yielded incrementally.
 * @param {Buffer} compressed
 * @param {ZipMemberInfo} info
 * @param {{ verify?: boolean, maxSize?: number }} [options]
 * @returns {Buffer}
 */
function decodeMemberSync(compressed: Buffer, info: ZipMemberInfo, options?: ZipReadOptions) : Buffer {
  assertDecodable(info, options);
  const cap = outputCap(info, options);
  let data: Buffer;
  if (info.method === METHOD_DEFLATE) {
    try {
      data = lazyZlib().inflateRawSync(compressed, { maxOutputLength: cap }) as Buffer;
    } catch (err) {
      rethrowDecodeFailure(err as DecodeError, info, METHOD_DEFLATE);
    }
  } else if (info.method === METHOD_ZSTD) {
    try {
      data = lazyZlib().zstdDecompressSync(compressed, { maxOutputLength: cap }) as Buffer;
    } catch (err) {
      rethrowDecodeFailure(err as DecodeError, info, METHOD_ZSTD);
    }
  } else {
    data = compressed;
  }
  checkDecoded(data, info, options?.verify !== false);
  return data;
}

export { deflateRawAsync, deflateRawSync, zstdCompressAsync, zstdCompressSync, deflateRawStream, zstdCompressStream, decodeMemberStream, decodeMemberAsync, decodeMemberSync };
