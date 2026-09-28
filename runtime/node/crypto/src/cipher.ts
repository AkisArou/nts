// Symmetric ciphers: `Cipheriv`, `Decipheriv`, `getCiphers` and
// `getCipherInfo`, from node v24.20.0 `lib/internal/crypto/cipher.js`, over
// `src/crypto/crypto_cipher.cc` (here `cipher.c`).
//
// A cipher is a stream, as a `Hash` is: `update` and `final` for the direct
// form, `_transform` and `_flush` for the piped one, and both work on the same
// native context. Like `Hash`, these extend `Transform` outright where node's
// are `LazyTransform`s.
//
// RSA's `publicEncrypt` and relatives are in the same file in node and need
// asymmetric keys, which this module does not have yet.

import { Buffer } from "../../buffer/src/main.ts";
import {
  ERR_CRYPTO_INVALID_AUTH_TAG,
  ERR_CRYPTO_INVALID_IV,
  ERR_CRYPTO_INVALID_KEYLEN,
  ERR_CRYPTO_INVALID_MESSAGELEN,
  ERR_CRYPTO_INVALID_STATE,
  ERR_CRYPTO_INVALID_STATE_BINDING,
  ERR_CRYPTO_UNKNOWN_CIPHER,
  ERR_CRYPTO_UNSUPPORTED_OPERATION,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_MISSING_ARGS_BINDING,
  ERR_UNKNOWN_ENCODING,
} from "../../internal/errors.ts";
import { emitWarning } from "../../internal/process-warning.ts";
import { validateInt32, validateObject, validateString } from "../../internal/validators.ts";
import { normalizeEncoding } from "../../buffer/src/encodings.ts";
import type { Encoding } from "../../buffer/src/encodings.ts";
import { Transform } from "../../stream/src/main.ts";
import type { TransformCallback, TransformOptions } from "../../stream/src/transform.ts";
import { StringDecoder } from "../../string_decoder/src/main.ts";
import { isArrayBufferView } from "../../util/src/types.ts";
import { prepareSecretKey } from "./keys.ts";
import {
  asBuffer,
  bytesOf,
  cipherId,
  filterDuplicateStrings,
  getArrayBufferOrView,
  parseEncoding,
  peekedCryptoError,
  validateEncoding,
} from "./util.ts";

/** `cipher.c`'s statuses, each one of node's C++ refusals. */
const CipherStatus = {
  CryptoError: 0,
  InvalidIv: -1,
  InvalidKeyLength: -2,
  AuthTagRequired: -3,
  InvalidAuthTagLength: -4,
  CcmDecryptInFips: -5,
  InvalidMessageLength: -6,
  MissingPlaintextLength: -7,
  InvalidState: -8,
  ShortGcmTag: -9,
  Unauthenticated: -10,
} as const;

/** The key's `encoding`, `authTagLength`, and the stream's own options. */
export interface CipherOptions extends TransformOptions {
  authTagLength?: number;
}

export interface AADOptions {
  encoding?: string;
  plaintextLength?: number;
}

/** Node's `getUIntOption`: -1 for absent, and a refusal for anything not a uint32. */
function uintOption(options: unknown, key: string): number {
  if (options === null || typeof options !== "object") return -1;
  const value = (options as Record<string, unknown>)[key];
  if (value === undefined || value === null) return -1;
  if (typeof value !== "number" || value >>> 0 !== value) {
    throw new ERR_INVALID_ARG_VALUE(`options.${key}`, value);
  }
  return value + 0;
}

/** `getStringOption`, as `hash.ts` has it. */
function stringOption(options: unknown, key: string): string | undefined {
  if (options === null || typeof options !== "object") return undefined;
  const value = (options as Record<string, unknown>)[key];
  if (value === undefined || value === null) return undefined;
  validateString(value, `options.${key}`);
  return value;
}

/**
 * Node's `getDecoder`: one `StringDecoder` per cipher, so a character split
 * across two updates is decoded whole, and an output encoding that cannot
 * change once text has been produced in another.
 */
function decoderFor(decoder: StringDecoder | null, encoding: string): StringDecoder {
  const normalized = normalizeEncoding(encoding);
  const current = decoder ?? new StringDecoder(encoding as Encoding);
  if (current.encoding !== normalized) {
    if (normalized === undefined) throw new ERR_UNKNOWN_ENCODING(encoding);
    throw new ERR_INVALID_ARG_VALUE(
      "outputEncoding",
      encoding,
      `cannot be changed from '${current.encoding}'`,
    );
  }
  return current;
}


const noBytes = new Uint8Array(0);

/**
 * The shared half of `Cipheriv` and `Decipheriv`, as functions over the
 * native handle. Node shares it by assigning the same functions to both
 * prototypes; a base class would put a class between each prototype and
 * `Transform`'s, and would have to expose the handle to its subclasses.
 */
function openCipher(
  encrypt: boolean,
  cipher: unknown,
  key: unknown,
  iv: unknown,
  options: CipherOptions | undefined,
): number {
  validateString(cipher, "cipher");
  const encoding = stringOption(options, "encoding");
  const keyBytes = prepareSecretKey(key, encoding);
  const ivBytes = iv === null ? noBytes : bytesOf(getArrayBufferOrView(iv, "iv"));
  const authTagLength = uintOption(options, "authTagLength");
  const id = cipherId(cipher);
  if (id < 0) throw new ERR_CRYPTO_UNKNOWN_CIPHER();
  const handle = nts_crypto_cipher_new(id, encrypt, keyBytes, ivBytes, authTagLength);
  if (handle <= 0) throw initializationError(handle, cipher, authTagLength);
  return handle;
}

/** The bytes an update produces, or node's error for the state it failed in. */
function updateBytes(handle: number, data: unknown, encoding: unknown): Buffer {
  let bytes: Uint8Array | null;
  if (typeof data === "string") {
    const as = parseEncoding(encoding, "utf8");
    bytes =
      as === "utf8" || as === "buffer"
        ? nts_crypto_cipher_update_utf8(handle, data)
        : nts_crypto_cipher_update(handle, Buffer.from(data, as));
  } else {
    bytes = nts_crypto_cipher_update(handle, bytesOf(data as ArrayBufferView));
  }
  if (bytes === null) {
    if (nts_crypto_cipher_status() === CipherStatus.InvalidMessageLength) {
      throw new ERR_CRYPTO_INVALID_MESSAGELEN();
    }
    throw peekedCryptoError("Trying to add data in unsupported state");
  }
  return asBuffer(bytes);
}

function finalBytes(handle: number): Buffer {
  const bytes = nts_crypto_cipher_final(handle);
  if (bytes === null) {
    const status = nts_crypto_cipher_status();
    if (status === CipherStatus.InvalidState) throw new ERR_CRYPTO_INVALID_STATE_BINDING();
    throw peekedCryptoError(
      status === CipherStatus.Unauthenticated
        ? "Unsupported state or unable to authenticate data"
        : "Unsupported state",
    );
  }
  return asBuffer(bytes);
}

function checkUpdateData(data: unknown, inputEncoding: unknown): void {
  if (typeof data === "string") {
    validateEncoding(data, inputEncoding);
  } else if (!isArrayBufferView(data)) {
    throw new ERR_INVALID_ARG_TYPE("data", ["string", "Buffer", "TypedArray", "DataView"], data);
  }
}

function setAutoPadding(handle: number, autoPadding: unknown): void {
  if (!nts_crypto_cipher_set_auto_padding(handle, !!autoPadding)) {
    throw new ERR_CRYPTO_INVALID_STATE("setAutoPadding");
  }
}

function setAAD(handle: number, buffer: unknown, options: unknown): void {
  const encoding = stringOption(options, "encoding");
  const plaintextLength = uintOption(options, "plaintextLength");
  const aad = bytesOf(getArrayBufferOrView(buffer, "aadbuf", encoding));
  const result = nts_crypto_cipher_set_aad(handle, aad, plaintextLength);
  if (result === CipherStatus.MissingPlaintextLength) {
    throw new ERR_MISSING_ARGS_BINDING("options.plaintextLength required for CCM mode with AAD");
  }
  if (result === CipherStatus.InvalidMessageLength) throw new ERR_CRYPTO_INVALID_MESSAGELEN();
  if (result !== 1) throw new ERR_CRYPTO_INVALID_STATE("setAAD");
}

/** `_flush`: the last block, or the error that ends the stream. */
function flushInto(stream: Transform, finish: () => Buffer, callback: TransformCallback): void {
  let bytes: Buffer;
  try {
    bytes = finish();
  } catch (error) {
    callback(error);
    return;
  }
  stream.push(bytes);
  callback();
}

/** Node's C++ refusal at construction, as the error it throws. */
function initializationError(status: number, cipher: string, authTagLength: number): Error {
  switch (status) {
    case CipherStatus.InvalidIv:
      return new ERR_CRYPTO_INVALID_IV();
    case CipherStatus.InvalidKeyLength:
      return new ERR_CRYPTO_INVALID_KEYLEN();
    case CipherStatus.AuthTagRequired:
      return new ERR_CRYPTO_INVALID_AUTH_TAG(`authTagLength required for ${cipher}`);
    case CipherStatus.InvalidAuthTagLength:
      return new ERR_CRYPTO_INVALID_AUTH_TAG(`Invalid authentication tag length: ${authTagLength}`);
    case CipherStatus.CcmDecryptInFips:
      return new ERR_CRYPTO_UNSUPPORTED_OPERATION("CCM encryption not supported in FIPS mode");
    default:
      return peekedCryptoError("Failed to initialize cipher");
  }
}

export class Cipheriv extends Transform {
  /** The native context, 0 once `final` has ended it -- so no later call can reach a slot another cipher reuses. */
  #handle: number;
  /** The tag, taken when `final` computed it: node's survives the stream's end, and the context does not. */
  #authTag: Buffer | null = null;
  /** Node's own `_decoder` property, made on the first text output. */
  _decoder: StringDecoder | null = null;

  constructor(cipher: string, key: unknown, iv: unknown, options?: CipherOptions) {
    super(options);
    this.#handle = openCipher(true, cipher, key, iv, options);
  }

  update(data: string | ArrayBufferView, inputEncoding?: string, outputEncoding?: string): Buffer | string {
    checkUpdateData(data, inputEncoding);
    const bytes = updateBytes(this.#handle, data, inputEncoding);
    if (outputEncoding && outputEncoding !== "buffer") {
      this._decoder = decoderFor(this._decoder, outputEncoding);
      return this._decoder.write(bytes);
    }
    return bytes;
  }

  final(outputEncoding?: string): Buffer | string {
    const bytes = this.#finish();
    if (outputEncoding && outputEncoding !== "buffer") {
      this._decoder = decoderFor(this._decoder, outputEncoding);
      return this._decoder.end(bytes);
    }
    return bytes;
  }

  setAutoPadding(autoPadding?: boolean): this {
    setAutoPadding(this.#handle, autoPadding);
    return this;
  }

  setAAD(buffer: string | ArrayBufferView, options?: AADOptions): this {
    setAAD(this.#handle, buffer, options);
    return this;
  }

  /** The tag an authenticated cipher computed, after `final`. */
  getAuthTag(): Buffer {
    if (this.#authTag === null) throw new ERR_CRYPTO_INVALID_STATE("getAuthTag");
    return Buffer.from(this.#authTag);
  }

  override _transform(chunk: unknown, encoding: string | undefined, callback: TransformCallback): void {
    this.push(updateBytes(this.#handle, chunk, encoding));
    callback();
  }

  override _flush(callback: TransformCallback): void {
    flushInto(this, () => this.#finish(), callback);
  }

  override _destroy(error: unknown, callback: (error?: unknown) => void): void {
    this.#release();
    super._destroy(error, callback);
  }

  /** Node's `final`: the context ends whether or not it succeeds. */
  #finish(): Buffer {
    try {
      return finalBytes(this.#handle);
    } finally {
      const tag = nts_crypto_cipher_auth_tag(this.#handle);
      if (tag !== null) this.#authTag = asBuffer(tag);
      this.#release();
    }
  }

  #release(): void {
    if (this.#handle === 0) return;
    nts_crypto_cipher_release(this.#handle);
    this.#handle = 0;
  }
}

export class Decipheriv extends Transform {
  /** The native context, 0 once `final` has ended it -- so no later call can reach a slot another cipher reuses. */
  #handle: number;
  /** Node's own `_decoder` property, made on the first text output. */
  _decoder: StringDecoder | null = null;

  constructor(cipher: string, key: unknown, iv: unknown, options?: CipherOptions) {
    super(options);
    this.#handle = openCipher(false, cipher, key, iv, options);
  }

  update(data: string | ArrayBufferView, inputEncoding?: string, outputEncoding?: string): Buffer | string {
    checkUpdateData(data, inputEncoding);
    const bytes = updateBytes(this.#handle, data, inputEncoding);
    if (outputEncoding && outputEncoding !== "buffer") {
      this._decoder = decoderFor(this._decoder, outputEncoding);
      return this._decoder.write(bytes);
    }
    return bytes;
  }

  final(outputEncoding?: string): Buffer | string {
    const bytes = this.#finish();
    if (outputEncoding && outputEncoding !== "buffer") {
      this._decoder = decoderFor(this._decoder, outputEncoding);
      return this._decoder.end(bytes);
    }
    return bytes;
  }

  setAutoPadding(autoPadding?: boolean): this {
    setAutoPadding(this.#handle, autoPadding);
    return this;
  }

  setAAD(buffer: string | ArrayBufferView, options?: AADOptions): this {
    setAAD(this.#handle, buffer, options);
    return this;
  }

  /** The tag to authenticate against, before `final`. */
  setAuthTag(buffer: string | ArrayBufferView, encoding?: string): this {
    const tag = bytesOf(getArrayBufferOrView(buffer, "buffer", encoding));
    const result = nts_crypto_cipher_set_auth_tag(this.#handle, tag);
    if (result === CipherStatus.InvalidAuthTagLength) {
      throw new ERR_CRYPTO_INVALID_AUTH_TAG(`Invalid authentication tag length: ${tag.byteLength}`);
    }
    if (nts_crypto_cipher_status() === CipherStatus.ShortGcmTag) {
      emitWarning(
        "Using AES-GCM authentication tags of less than 128 bits without " +
          "specifying the authTagLength option when initializing decryption " +
          "is deprecated.",
        "DeprecationWarning",
        "DEP0182",
      );
    }
    if (result !== 1) throw new ERR_CRYPTO_INVALID_STATE("setAuthTag");
    return this;
  }

  override _transform(chunk: unknown, encoding: string | undefined, callback: TransformCallback): void {
    this.push(updateBytes(this.#handle, chunk, encoding));
    callback();
  }

  override _flush(callback: TransformCallback): void {
    flushInto(this, () => this.#finish(), callback);
  }

  override _destroy(error: unknown, callback: (error?: unknown) => void): void {
    this.#release();
    super._destroy(error, callback);
  }

  /** Node's `final`: the context ends whether or not it succeeds. */
  #finish(): Buffer {
    try {
      return finalBytes(this.#handle);
    } finally {
      this.#release();
    }
  }

  #release(): void {
    if (this.#handle === 0) return;
    nts_crypto_cipher_release(this.#handle);
    this.#handle = 0;
  }
}

export function createCipheriv(cipher: string, key: unknown, iv: unknown, options?: CipherOptions): Cipheriv {
  return new Cipheriv(cipher, key, iv, options);
}

export function createDecipheriv(
  cipher: string,
  key: unknown,
  iv: unknown,
  options?: CipherOptions,
): Decipheriv {
  return new Decipheriv(cipher, key, iv, options);
}

let cipherNames: string[] | undefined;

/** `crypto.getCiphers()`: node's `cachedResult` over `filterDuplicateStrings`. */
export function getCiphers(): string[] {
  cipherNames ??= filterDuplicateStrings(nts_crypto_cipher_names());
  return cipherNames.slice();
}

export interface CipherInfo {
  mode?: string;
  name: string;
  nid: number;
  blockSize?: number;
  ivLength?: number;
  keyLength: number;
}

export interface CipherInfoOptions {
  keyLength?: number;
  ivLength?: number;
}

/**
 * `crypto.getCipherInfo(nameOrNid[, options])`: a cipher's description, or
 * `undefined` for one OpenSSL does not know or lengths it would not accept.
 * The fields node leaves out -- a mode it has no word for, a stream cipher's
 * block size, an IV length of 0 -- are left out.
 */
export function getCipherInfo(nameOrNid: unknown, options?: unknown): CipherInfo | undefined {
  if (typeof nameOrNid !== "string" && typeof nameOrNid !== "number") {
    throw new ERR_INVALID_ARG_TYPE("nameOrNid", ["string", "number"], nameOrNid);
  }
  if (typeof nameOrNid === "number") validateInt32(nameOrNid, "nameOrNid");
  let keyLength = -1;
  let ivLength = -1;
  if (options !== undefined) {
    validateObject(options, "options");
    const given = options as CipherInfoOptions;
    const key = given.keyLength;
    const iv = given.ivLength;
    if (key !== undefined) {
      validateInt32(key, "options.keyLength");
      keyLength = key + 0;
    }
    if (iv !== undefined) {
      validateInt32(iv, "options.ivLength");
      ivLength = iv + 0;
    }
  }
  const id = typeof nameOrNid === "string" ? cipherId(nameOrNid) : nts_crypto_cipher_id_of_nid(nameOrNid);
  if (id < 0) return undefined;
  const facts = nts_crypto_cipher_info(id, keyLength, ivLength);
  if (facts.length !== 4) return undefined;
  const info: CipherInfo = { name: "", nid: 0, keyLength: 0 };
  const mode = nts_crypto_cipher_mode(id);
  if (mode !== "") info.mode = mode;
  info.name = nts_crypto_cipher_name(id).toLowerCase();
  info.nid = facts[0]!;
  if (facts[1]! !== -1) info.blockSize = facts[1]!;
  if (facts[2]! !== 0) info.ivLength = facts[2]!;
  info.keyLength = facts[3]!;
  return info;
}
