// What every part of `node:crypto` shares: byte sources, digest names,
// encodings, and OpenSSL's errors. From node v24.20.0
// `lib/internal/crypto/util.js`, and the C++ each piece stands in for.

import { byteLengthIn, decodeIn, writeIn } from "../../buffer/src/encodings.ts";
import { Buffer } from "../../buffer/src/main.ts";
import { normalizeEncodingName } from "../../buffer/src/encodings.ts";
import type { Encoding } from "../../buffer/src/encodings.ts";
import { ERR_INVALID_ARG_TYPE, ERR_INVALID_ARG_VALUE } from "../../internal/errors.ts";
import { isAnyArrayBuffer, isArrayBufferView } from "../../util/src/types.ts";

/** Anything node accepts as bytes: a buffer, a view onto one, or text. */
export type BinaryLike = string | ArrayBuffer | SharedArrayBuffer | ArrayBufferView;
/** `BinaryLike` after the text has been encoded. */
export type ByteSource = ArrayBuffer | SharedArrayBuffer | ArrayBufferView;

/** An output encoding, where `buffer` asks for the bytes themselves. */
export type OutputEncoding = Encoding | "buffer";

/**
 * The bytes a source names, as a `Uint8Array` over the same memory.
 *
 * Every native takes a `Uint8Array`, and a `Buffer` already is one, so the
 * common case costs nothing; any other view is re-viewed without a copy.
 */
export function bytesOf(source: ByteSource): Uint8Array {
  if (source instanceof Uint8Array) return source;
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  return new Uint8Array(source);
}

/** Bytes as a `Buffer` without copying: `Buffer.from(arrayBuffer)` in node. */
export function asBuffer(bytes: Uint8Array): Buffer {
  return new Buffer(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
}

/** Bytes as an `ArrayBuffer` of their own, copied only when they are a part of a larger one. */
export function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer as ArrayBuffer;
  return bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength
    ? buffer
    : buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Big-endian bytes as an unsigned bigint: node's `bigIntArrayToUnsignedBigInt`. */
export function unsignedBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let i = 0; i < bytes.length; i++) value = (value << 8n) | BigInt(bytes[i]!);
  return value;
}

/** Node's `toBuf`: text through `Buffer.from`, where `buffer` means UTF-8. */
export function toBuf(value: unknown, encoding?: string): unknown {
  if (typeof value === "string") {
    return Buffer.from(value, encoding === "buffer" ? "utf8" : encoding);
  }
  return value;
}

const BYTE_SOURCES = ["string", "ArrayBuffer", "Buffer", "TypedArray", "DataView"];

/** Node's `getArrayBufferOrView`: text encoded, anything else already bytes. */
export function getArrayBufferOrView(value: unknown, name: string, encoding?: string): ByteSource {
  if (isAnyArrayBuffer(value)) return value;
  if (typeof value === "string") {
    return Buffer.from(value, encoding === "buffer" ? "utf8" : encoding);
  }
  if (!isArrayBufferView(value)) {
    throw new ERR_INVALID_ARG_TYPE(name, BYTE_SOURCES, value);
  }
  return value;
}

/** Node's `validateByteSource`, whose list names `Buffer` last. */
export function validateByteSource(value: unknown, name: string): ByteSource {
  const bytes = toBuf(value);
  if (isAnyArrayBuffer(bytes) || isArrayBufferView(bytes)) return bytes;
  throw new ERR_INVALID_ARG_TYPE(
    name,
    ["string", "ArrayBuffer", "TypedArray", "DataView", "Buffer"],
    bytes,
  );
}

// -- digests ------------------------------------------------------------------

/**
 * Name to digest id, kept on this side as node keeps `getHashCache()` in
 * JavaScript: a `Map` hit is cheaper than taking a string across the seam. A
 * name OpenSSL does not know is not cached, so it is asked again -- node does
 * the same, and a program that repeats a bad name is not one to optimise.
 */
const digestIds = new Map<string, number>();

/** The digest a name resolves to, or -1. */
export function digestId(name: string): number {
  const cached = digestIds.get(name);
  if (cached !== undefined) return cached;
  const id = nts_crypto_digest_id(name);
  if (id >= 0) digestIds.set(name, id);
  return id;
}

/** Name to cipher id, kept as `digestIds` keeps digests. */
const cipherIds = new Map<string, number>();

/** The cipher a name resolves to, or -1. */
export function cipherId(name: string): number {
  const cached = cipherIds.get(name);
  if (cached !== undefined) return cached;
  const id = nts_crypto_cipher_id(name);
  if (id >= 0) cipherIds.set(name, id);
  return id;
}

// -- encodings ----------------------------------------------------------------

/**
 * Node's C++ `ParseEncoding`: an encoding it does not recognise is the
 * default, not an error. `hash.digest("nonsense")` is a `Buffer` and
 * `hash.update(text, "nonsense")` is UTF-8, because both are decided in C++
 * where an unknown name falls through to the caller's default.
 */
export function parseEncoding(encoding: unknown, fallback: OutputEncoding): OutputEncoding {
  if (typeof encoding !== "string") return fallback;
  if (encoding.toLowerCase() === "buffer") return "buffer";
  return normalizeEncodingName(encoding) ?? fallback;
}

/** Bytes as a caller asked for them: the bytes, or text in an encoding. */
export function encodeOutput(bytes: Uint8Array, encoding: OutputEncoding): Buffer | string {
  const buffer = new Buffer(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
  return encoding === "buffer" ? buffer : buffer.toString(encoding);
}

/**
 * Node's `validateEncoding`: text given in `hex` must have an even length. The
 * only encoding checked, because it is the only one where a length alone says
 * the text cannot be what it claims.
 */
export function validateEncoding(data: string, encoding: unknown): void {
  if (encoding === undefined || typeof encoding !== "string") return;
  if (normalizeEncodingName(encoding) === "hex" && data.length % 2 !== 0) {
    throw new ERR_INVALID_ARG_VALUE("encoding", encoding, `is invalid for data of length ${data.length}`);
  }
}

// -- OpenSSL's errors ---------------------------------------------------------

/**
 * An error OpenSSL reported, shaped as node shapes it.
 *
 * A plain `Error` to anyone who asks its constructor. Its four extra
 * properties exist only when OpenSSL supplied them, which is why they are
 * declared rather than initialised: a field would be an own `undefined`
 * property on every instance, and `assert.deepStrictEqual` sees those.
 */
export class OpenSSLError extends Error {
  declare opensslErrorStack?: string[];
  declare library?: string;
  declare reason?: string;
  declare code?: string;

  override get ["constructor"](): unknown {
    return Error;
  }
}

/**
 * What node's `ThrowCryptoError` throws for the failure just recorded.
 *
 * The oldest queued error is the message and the decoration -- `library`,
 * `reason`, and a `code` built from both -- and the rest, newest first, are
 * `opensslErrorStack`. With nothing queued the message is node's own words for
 * the operation, and the error carries nothing else.
 */
export function cryptoError(fallback: string): OpenSSLError {
  return queuedCryptoError() ?? new OpenSSLError(fallback);
}

/**
 * `cryptoError` when OpenSSL queued something, and null when it did not -- for
 * the callers that, like node's `CheckThrow`, throw an error of their own then.
 */
export function queuedCryptoError(): OpenSSLError | null {
  const record = nts_crypto_take_errors();
  if (record.length === 3) return null;
  const error = new OpenSSLError(record[3]);
  if (record.length > 4) error.opensslErrorStack = record.slice(4).reverse();
  if (record[0] !== "") error.library = record[0];
  if (record[1] !== "") error.reason = record[1];
  if (record[2] !== "") error.code = record[2];
  return error;
}

/**
 * What node's `CryptoJob` reports for a derivation that failed.
 *
 * The same message and stack as `cryptoError`, read through
 * `CryptoErrorStore`, which does not decorate: a job's error has no `library`,
 * `reason` or `code`, and with nothing queued its message is node's generic
 * one for the job.
 */
export function jobError(fallback: string): OpenSSLError {
  const record = nts_crypto_take_errors();
  if (record.length === 3) return new OpenSSLError(fallback);
  const error = new OpenSSLError(record[3]);
  if (record.length > 4) error.opensslErrorStack = record.slice(4).reverse();
  return error;
}

/**
 * What `ThrowCryptoError` throws when node *peeks* at the queue rather than
 * taking from it -- the cipher paths, under `MarkPopErrorOnReturn`. The
 * oldest error is the message and the decoration, as in `cryptoError`, and
 * because it was never taken it is also on `opensslErrorStack`, with the rest,
 * newest first.
 */
export function peekedCryptoError(fallback: string): OpenSSLError {
  const record = nts_crypto_take_errors();
  if (record.length === 3) return new OpenSSLError(fallback);
  const error = new OpenSSLError(record[3]!);
  error.opensslErrorStack = record.slice(3).reverse();
  if (record[0] !== "") error.library = record[0];
  if (record[1] !== "") error.reason = record[1];
  if (record[2] !== "") error.code = record[2];
  return error;
}

/**
 * What `ThrowCryptoError` throws for an error ncrypto peeked inside a mark it
 * then popped -- a key's encoding: the oldest error as the message and the
 * decoration, and no `opensslErrorStack`, because nothing is left on the
 * queue to capture.
 */
export function markedCryptoError(fallback: string): OpenSSLError {
  const record = nts_crypto_take_errors();
  if (record.length === 3) return new OpenSSLError(fallback);
  const error = new OpenSSLError(record[3]!);
  if (record[0] !== "") error.library = record[0];
  if (record[1] !== "") error.reason = record[1];
  if (record[2] !== "") error.code = record[2];
  return error;
}

/**
 * Node's `filterDuplicateStrings`: one entry per name regardless of case, the
 * last spelling of each kept in the place of the first, sorted.
 */
export function filterDuplicateStrings(names: readonly string[]): string[] {
  const at = new Map<string, number>();
  const kept: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    const index = at.get(key);
    if (index === undefined) {
      at.set(key, kept.length);
      kept.push(name);
    } else {
      kept[index] = name;
    }
  }
  return kept.sort();
}

let curveNames: string[] | undefined;

/**
 * `crypto.getCurves()`: OpenSSL's built-in elliptic curves, once per name
 * regardless of case, sorted. Computed once, and a fresh array each time, as
 * node's `cachedResult` hands out.
 */
export function getCurves(): string[] {
  curveNames ??= filterDuplicateStrings(nts_crypto_curve_names());
  return curveNames.slice();
}

/**
 * A JWK member's bytes: base64 of either alphabet, as node's C++
 * `ByteSource::FromEncodedString` decodes it -- through the codec itself,
 * not a `Buffer` method a program can replace.
 */
export function bytesOfBase64(text: string): Uint8Array {
  const bytes = new Uint8Array(byteLengthIn(text, "base64"));
  const written = writeIn(bytes, text, 0, bytes.byteLength, "base64");
  return written === bytes.byteLength ? bytes : bytes.subarray(0, written);
}

/** Bytes as base64url, as node's C++ writes a JWK member. */
export function base64urlOf(bytes: Uint8Array): string {
  return decodeIn(bytes, 0, bytes.byteLength, "base64url");
}
