// `Hash`, `Hmac`, `hash()` and `getHashes()`, from node v24.20.0
// `lib/internal/crypto/hash.js`, over `src/crypto/crypto_hash.cc` and
// `crypto_hmac.cc`.
//
// # A stream from the start
//
// Node's two classes are `LazyTransform`s: the stream state is built on the
// first touch of a stream property, so `createHash(a).update(b).digest()`
// never pays for it. These extend `Transform` outright, which costs that
// construction on every hash; the behaviour a program sees is the same.
//
// # When the context is freed
//
// The native context is freed by the read that finishes it -- `digest()`, or
// `_flush` at the end of a piped stream -- and by `_destroy`. A `Hash` dropped
// before either keeps its context until the process exits: this runtime has
// no collection hook to free it from (`nts_crypto.h` says so at length).

import { Buffer } from "../../buffer/src/main.ts";
import {
  ERR_CRYPTO_HASH_FINALIZED,
  ERR_CRYPTO_HASH_UPDATE_FAILED,
  ERR_CRYPTO_INVALID_DIGEST,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
} from "../../internal/errors.ts";
import { isPendingDeprecation } from "../../internal/options.ts";
import { emitWarning } from "../../internal/process-warning.ts";
import { validateObject, validateString, validateUint32 } from "../../internal/validators.ts";
import { Transform } from "../../stream/src/main.ts";
import type { TransformCallback, TransformOptions } from "../../stream/src/transform.ts";
import { isArrayBufferView } from "../../util/src/types.ts";
import { prepareSecretKey } from "./keys.ts";
import {
  bytesOf,
  cryptoError,
  digestId,
  encodeOutput,
  filterDuplicateStrings,
  OpenSSLError,
  parseEncoding,
  validateEncoding,
} from "./util.ts";
import type { OutputEncoding } from "./util.ts";
import { normalizeEncodingName } from "../../buffer/src/encodings.ts";

export interface HashOptions extends TransformOptions {
  outputLength?: number;
}

/**
 * The stream's options, whose `encoding` is also the key's: node reads it for
 * the key and hands the same object to the stream, where it is the output's.
 */
export type HmacOptions = TransformOptions;

/**
 * Text or bytes into a live context. Text is written as node's `Decode`
 * writes it: an encoding it does not know is UTF-8, and so is `buffer`.
 */
function feed(handle: number, data: unknown, encoding: unknown): boolean {
  if (typeof data === "string") {
    const as = parseEncoding(encoding, "utf8");
    if (as === "utf8" || as === "buffer") return nts_crypto_update_utf8(handle, data);
    return nts_crypto_update(handle, Buffer.from(data, as));
  }
  return nts_crypto_update(handle, bytesOf(data as ArrayBufferView));
}

/** `update`'s argument checks, shared as node shares the method itself. */
function checkUpdate(data: unknown, encoding: unknown): void {
  if (typeof data === "string") {
    validateEncoding(data, encoding);
  } else if (!isArrayBufferView(data)) {
    throw new ERR_INVALID_ARG_TYPE("data", ["string", "Buffer", "TypedArray", "DataView"], data);
  }
}

/**
 * `digest(outputEncoding)`'s argument: a truthy value is coerced with a
 * template literal, as node does -- which calls a `toString` the caller
 * supplied, and lets it throw (nodejs/node#9819 pins that it does).
 */
function outputEncodingOf(outputEncoding: unknown): OutputEncoding {
  return parseEncoding(outputEncoding ? `${outputEncoding}` : undefined, "buffer");
}

let warnedDefaultShakeLength = false;

/**
 * DEP0198, once per process and only under `--pending-deprecation`: a SHAKE
 * digest made without a length gets OpenSSL 3.4's missing default filled in
 * by node, which node means to stop doing. Node normalises the name by
 * lowercasing it and dropping its first hyphen, so `SHAKE-128` counts.
 */
function maybeWarnDefaultShakeLength(algorithm: string): void {
  if (warnedDefaultShakeLength || !isPendingDeprecation()) return;
  const normalized = algorithm.toLowerCase().replace("-", "");
  if (normalized !== "shake128" && normalized !== "shake256") return;
  warnedDefaultShakeLength = true;
  emitWarning(
    "Creating SHAKE128/256 digests without an explicit options.outputLength is deprecated.",
    "DeprecationWarning",
    "DEP0198",
  );
}

/**
 * A hash in progress, to be copied: the one thing besides a name that the
 * constructor takes as its first argument. Never exported, so a program cannot
 * hand `createHash` one -- node's check is `instanceof` its native class, which
 * a program cannot reach either.
 */
class HashSource {
  readonly handle: number;

  constructor(handle: number) {
    this.handle = handle;
  }
}

export class Hash extends Transform {
  #handle: number;
  #finalized = false;
  /** The digest, once read: node caches it because SHA-3 cannot be finalised twice. */
  #digest: Uint8Array | undefined;

  constructor(algorithm: unknown, options?: HashOptions) {
    super(options);
    const isCopy = algorithm instanceof HashSource;
    if (!isCopy) validateString(algorithm, "algorithm");
    let xofLength = -1;
    const outputLength = typeof options === "object" && options !== null ? options.outputLength : undefined;
    if (outputLength !== undefined) {
      validateUint32(outputLength, "options.outputLength");
      xofLength = outputLength + 0;
    }
    if (isCopy) {
      this.#handle = nts_crypto_hash_copy(algorithm.handle, xofLength);
      if (this.#handle === 0) throw cryptoError("Digest copy error");
      return;
    }
    const id = digestId(algorithm as string);
    // An unknown name reaches OpenSSL as nothing, so nothing is queued and the
    // message is node's own.
    if (id < 0) throw new OpenSSLError("Digest method not supported");
    this.#handle = nts_crypto_hash_new(id, xofLength);
    if (this.#handle === 0) throw cryptoError("Digest method not supported");
    if (xofLength < 0) maybeWarnDefaultShakeLength(algorithm as string);
  }

  copy(options?: HashOptions): Hash {
    if (this.#finalized) throw new ERR_CRYPTO_HASH_FINALIZED();
    return new Hash(new HashSource(this.#handle), options);
  }

  update(data: string | ArrayBufferView, encoding?: string): this {
    if (this.#finalized) throw new ERR_CRYPTO_HASH_FINALIZED();
    checkUpdate(data, encoding);
    if (!feed(this.#handle, data, encoding)) throw new ERR_CRYPTO_HASH_UPDATE_FAILED();
    return this;
  }

  digest(): Buffer;
  digest(outputEncoding: string): string | Buffer;
  digest(outputEncoding?: unknown): string | Buffer {
    if (this.#finalized) throw new ERR_CRYPTO_HASH_FINALIZED();
    const bytes = this.#read();
    this.#finalized = true;
    return encodeOutput(bytes, outputEncodingOf(outputEncoding));
  }

  /** Node's `HashDigest`: the first read finalises, every read after answers the same. */
  #read(): Uint8Array {
    if (this.#digest === undefined) {
      const bytes = nts_crypto_final(this.#handle);
      this.#handle = 0;
      if (bytes === null) throw cryptoError("Digest method not supported");
      this.#digest = bytes;
    }
    return this.#digest;
  }

  override _transform(chunk: unknown, encoding: string | undefined, callback: TransformCallback): void {
    if (!feed(this.#handle, chunk, encoding)) {
      callback(new ERR_CRYPTO_HASH_UPDATE_FAILED());
      return;
    }
    callback();
  }

  override _flush(callback: TransformCallback): void {
    const bytes = this.#read();
    this.push(new Buffer(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength));
    callback();
  }

  override _destroy(error: unknown, callback: (error?: unknown) => void): void {
    if (this.#handle !== 0) {
      nts_crypto_release(this.#handle);
      this.#handle = 0;
    }
    super._destroy(error, callback);
  }
}

/** `getStringOption`: the option if it is there, and a string if it is. */
function stringOption(options: unknown, key: string): string | undefined {
  if (options === null || typeof options !== "object") return undefined;
  const value = (options as Record<string, unknown>)[key];
  if (value === undefined || value === null) return undefined;
  validateString(value, `options.${key}`);
  return value;
}

export class Hmac extends Transform {
  #handle: number;
  #finalized = false;

  constructor(hmac: unknown, key: unknown, options?: HmacOptions) {
    super(options);
    validateString(hmac, "hmac");
    const encoding = stringOption(options, "encoding");
    const bytes = prepareSecretKey(key, encoding);
    const id = digestId(hmac);
    if (id < 0) throw new ERR_CRYPTO_INVALID_DIGEST(hmac);
    this.#handle = nts_crypto_hmac_new(id, bytes);
    // `ThrowCryptoError` with no message of node's own: with nothing queued it
    // prints error zero, which is what these words are.
    if (this.#handle === 0) throw cryptoError("error:00000000:lib(0)::reason(0)");
  }

  update(data: string | ArrayBufferView, encoding?: string): this {
    if (this.#finalized) throw new ERR_CRYPTO_HASH_FINALIZED();
    checkUpdate(data, encoding);
    if (!feed(this.#handle, data, encoding)) throw new ERR_CRYPTO_HASH_UPDATE_FAILED();
    return this;
  }

  /**
   * Unlike a `Hash`, a finished `Hmac` answers empty rather than throwing, and
   * it does not remember its value: node's `HmacDigest` resets the context
   * when it reads it, so a stream's `_flush` and a later `digest()` do not
   * both see the MAC.
   */
  digest(): Buffer;
  digest(outputEncoding: string): string | Buffer;
  digest(outputEncoding?: unknown): string | Buffer {
    if (this.#finalized) {
      const empty = Buffer.from("");
      if (outputEncoding && outputEncoding !== "buffer") return empty.toString(outputEncoding as string);
      return empty;
    }
    const bytes = this.#read();
    this.#finalized = true;
    return encodeOutput(bytes, outputEncodingOf(outputEncoding));
  }

  #read(): Uint8Array {
    if (this.#handle === 0) return new Uint8Array(0);
    const bytes = nts_crypto_final(this.#handle);
    this.#handle = 0;
    if (bytes === null) throw cryptoError("error:00000000:lib(0)::reason(0)");
    return bytes;
  }

  override _transform(chunk: unknown, encoding: string | undefined, callback: TransformCallback): void {
    if (!feed(this.#handle, chunk, encoding)) {
      callback(new ERR_CRYPTO_HASH_UPDATE_FAILED());
      return;
    }
    callback();
  }

  override _flush(callback: TransformCallback): void {
    const bytes = this.#read();
    this.push(new Buffer(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength));
    callback();
  }

  override _destroy(error: unknown, callback: (error?: unknown) => void): void {
    if (this.#handle !== 0) {
      nts_crypto_release(this.#handle);
      this.#handle = 0;
    }
    super._destroy(error, callback);
  }
}

export function createHash(algorithm: string, options?: HashOptions): Hash {
  return new Hash(algorithm, options);
}

export function createHmac(hmac: string, key: unknown, options?: HmacOptions): Hmac {
  return new Hmac(hmac, key, options);
}

export interface OneShotOptions {
  outputEncoding?: string;
  outputLength?: number;
}

/** `crypto.hash(algorithm, input[, options])`, which is `hex` unless asked otherwise. */
export function hash(algorithm: unknown, input: unknown, options?: unknown): string | Buffer {
  validateString(algorithm, "algorithm");
  if (typeof input !== "string" && !isArrayBufferView(input)) {
    throw new ERR_INVALID_ARG_TYPE("input", ["Buffer", "TypedArray", "DataView", "string"], input);
  }
  let outputEncoding: unknown;
  let outputLength: unknown;
  if (typeof options === "string") {
    outputEncoding = options;
  } else if (options !== undefined) {
    validateObject(options, "options");
    outputLength = (options as OneShotOptions).outputLength;
    outputEncoding = (options as OneShotOptions).outputEncoding;
  }
  outputEncoding ??= "hex";

  let normalized: OutputEncoding = "hex";
  if (outputEncoding !== "hex") {
    validateString(outputEncoding, "outputEncoding");
    const known = normalizeEncodingName(outputEncoding);
    if (known !== undefined) {
      normalized = known;
    } else if (outputEncoding.toLowerCase() === "buffer") {
      normalized = "buffer";
    } else {
      throw new ERR_INVALID_ARG_VALUE("outputEncoding", outputEncoding);
    }
  }

  let length = -1;
  if (outputLength !== undefined) {
    validateUint32(outputLength, "outputLength");
    length = outputLength + 0;
  } else {
    maybeWarnDefaultShakeLength(algorithm);
  }

  const id = digestId(algorithm);
  if (id < 0) throw new OpenSSLError(`Digest method ${algorithm} is not supported`);
  if (length >= 0 && !nts_crypto_digest_is_xof(id) && length !== nts_crypto_digest_size(id)) {
    throw new OpenSSLError(`Output length ${length} is invalid for ${algorithm}, which does not support XOF`);
  }
  const bytes =
    typeof input === "string"
      ? nts_crypto_digest_utf8(id, input, length)
      : nts_crypto_digest(id, bytesOf(input as ArrayBufferView), length);
  if (bytes === null) throw cryptoError("Digest method not supported");
  return encodeOutput(bytes, normalized);
}

let hashNames: string[] | undefined;

/**
 * `crypto.getHashes()`: every digest an explicit fetch can reach, once per
 * name regardless of case, sorted -- node's `filterDuplicateStrings` over
 * `EVP_MD_do_all_sorted`. Computed once, and a fresh array each time, as
 * node's `cachedResult` hands out.
 */
export function getHashes(): string[] {
  hashNames ??= filterDuplicateStrings(nts_crypto_hash_names());
  return hashNames.slice();
}
