// Key derivation: `pbkdf2`, `hkdf` and `scrypt`, from node v24.20.0
// `lib/internal/crypto/{pbkdf2,hkdf,scrypt}.js`, over
// `src/crypto/crypto_{pbkdf2,hkdf,scrypt}.cc`.
//
// Each is a job in node: validated in JavaScript, configured in C++ -- where a
// bad digest or length is thrown before any work is queued -- and then run
// either inline or on the thread pool. Here the C++ half's checks are the
// TypeScript's, made in the same order, so a program sees the same error for
// the same mistake whichever form it called.

import { Buffer, kMaxLength } from "../../buffer/src/main.ts";
import { getDefaultTriggerAsyncId } from "../../internal/async-hooks.ts";
import { AsyncRequest } from "../../internal/async-request.ts";
import type { RequestProvider } from "../../internal/async-request.ts";
import {
  ERR_CRYPTO_INVALID_DIGEST,
  ERR_CRYPTO_INVALID_KEYLEN,
  ERR_CRYPTO_INVALID_SCRYPT_PARAMS,
  ERR_INCOMPATIBLE_OPTION_PAIR,
  ERR_INVALID_ARG_TYPE,
  ERR_OUT_OF_RANGE,
} from "../../internal/errors.ts";
import {
  validateFunction,
  validateInt32,
  validateInteger,
  validateString,
  validateUint32,
} from "../../internal/validators.ts";
import { isAnyArrayBuffer, isArrayBufferView } from "../../util/src/types.ts";
import { isKeyObject, prepareSecretKey } from "./keys.ts";
import { asArrayBuffer, asBuffer, bytesOf, digestId, getArrayBufferOrView, jobError, toBuf, validateByteSource } from "./util.ts";
import type { ByteSource } from "./util.ts";

/** What node's `DeriveBitsJob` says when OpenSSL queued nothing to say instead. */
const DERIVE_FAILED = "Deriving bits failed";

type BufferCallback = (error: Error | null, derivedKey?: Buffer) => void;
type ArrayBufferCallback = (error: Error | null, derivedKey?: ArrayBuffer) => void;

/**
 * A job's completion as node's `CryptoJob` delivers it: once, in the request's
 * scope, with the key as a `Buffer` -- `pbkdf2` and `scrypt`.
 */
function bufferJob(type: RequestProvider, callback: BufferCallback): (ok: boolean, bytes: Uint8Array) => void {
  const request = new AsyncRequest(type, getDefaultTriggerAsyncId());
  return (ok, bytes) => {
    const error = ok ? null : jobError(DERIVE_FAILED);
    request.complete(() => {
      if (error !== null) callback(error);
      else callback(null, asBuffer(bytes));
    });
  };
}

/** As `bufferJob`, with the bits as an `ArrayBuffer` -- `hkdf`. */
function arrayBufferJob(
  type: RequestProvider,
  callback: ArrayBufferCallback,
): (ok: boolean, bytes: Uint8Array) => void {
  const request = new AsyncRequest(type, getDefaultTriggerAsyncId());
  return (ok, bytes) => {
    const error = ok ? null : jobError(DERIVE_FAILED);
    request.complete(() => {
      if (error !== null) callback(error);
      else callback(null, asArrayBuffer(bytes));
    });
  };
}

/** The synchronous form's result, or its failure thrown. */
function derived(bytes: Uint8Array | null): Uint8Array {
  if (bytes === null) throw jobError(DERIVE_FAILED);
  return bytes;
}


/** The digest a KDF names: `Digest::FromName`, refused in C++ as node refuses it. */
function kdfDigest(name: string): number {
  const id = digestId(name);
  if (id < 0) throw new ERR_CRYPTO_INVALID_DIGEST(name);
  return id;
}

// -- pbkdf2 -------------------------------------------------------------------

interface Pbkdf2Parameters {
  password: Uint8Array;
  salt: Uint8Array;
  iterations: number;
  keylen: number;
  digest: string;
}

function checkPbkdf2(
  password: unknown,
  salt: unknown,
  iterations: unknown,
  keylen: unknown,
  digest: unknown,
): Pbkdf2Parameters {
  validateString(digest, "digest");
  const passwordBytes = getArrayBufferOrView(password, "password");
  const saltBytes = getArrayBufferOrView(salt, "salt");
  // OpenSSL takes these as signed ints, which is plenty.
  validateInt32(iterations, "iterations", 1);
  validateInt32(keylen, "keylen", 0);
  return {
    password: bytesOf(passwordBytes),
    salt: bytesOf(saltBytes),
    iterations,
    keylen: keylen + 0,
    digest,
  };
}

export function pbkdf2(
  password: unknown,
  salt: unknown,
  iterations: unknown,
  keylen: unknown,
  digest: unknown,
  callback?: unknown,
): void {
  if (typeof digest === "function") {
    callback = digest;
    digest = undefined;
  }
  const checked = checkPbkdf2(password, salt, iterations, keylen, digest);
  validateFunction(callback, "callback");
  const id = kdfDigest(checked.digest);
  nts_crypto_pbkdf2_job(
    checked.password,
    checked.salt,
    checked.iterations,
    checked.keylen,
    id,
    bufferJob("PBKDF2REQUEST", callback as BufferCallback),
  );
}

export function pbkdf2Sync(
  password: unknown,
  salt: unknown,
  iterations: unknown,
  keylen: unknown,
  digest: unknown,
): Buffer {
  const checked = checkPbkdf2(password, salt, iterations, keylen, digest);
  const id = kdfDigest(checked.digest);
  return asBuffer(derived(nts_crypto_pbkdf2(checked.password, checked.salt, checked.iterations, checked.keylen, id)));
}

// -- hkdf ---------------------------------------------------------------------

interface HkdfParameters {
  hash: string;
  key: Uint8Array;
  salt: Uint8Array;
  info: Uint8Array;
  length: number;
}

/** Node's `prepareKey`, which names the argument `ikm` in its error. */
function prepareKey(key: unknown): ByteSource {
  if (isKeyObject(key)) return prepareSecretKey(key, undefined);
  if (isAnyArrayBuffer(key)) return key;
  const bytes = toBuf(key);
  if (!isArrayBufferView(bytes)) {
    throw new ERR_INVALID_ARG_TYPE(
      "ikm",
      ["string", "SecretKeyObject", "ArrayBuffer", "TypedArray", "DataView", "Buffer"],
      bytes,
    );
  }
  return bytes;
}

function checkHkdf(hash: unknown, key: unknown, salt: unknown, info: unknown, length: unknown): HkdfParameters {
  validateString(hash, "digest");
  const keyBytes = prepareKey(key);
  const saltBytes = bytesOf(validateByteSource(salt, "salt"));
  const infoBytes = bytesOf(validateByteSource(info, "info"));
  validateInteger(length, "length", 0, kMaxLength);
  if (infoBytes.byteLength > 1024) {
    throw new ERR_OUT_OF_RANGE("info", "must not contain more than 1024 bytes", infoBytes.byteLength);
  }
  return {
    hash,
    key: bytesOf(keyBytes),
    salt: saltBytes,
    info: infoBytes,
    length: length + 0,
  };
}

/**
 * The C++ half's checks: the digest, then the RFC 5869 bound -- HKDF-Expand
 * makes at most 255 blocks of the digest's size, because its counter is one
 * byte starting at 1.
 */
function hkdfDigest(parameters: HkdfParameters): number {
  const id = kdfDigest(parameters.hash);
  if (!nts_crypto_hkdf_length_ok(id, parameters.length)) throw new ERR_CRYPTO_INVALID_KEYLEN();
  return id;
}


export function hkdf(
  digest: unknown,
  ikm: unknown,
  salt: unknown,
  info: unknown,
  keylen: unknown,
  callback: unknown,
): void {
  const checked = checkHkdf(digest, ikm, salt, info, keylen);
  validateFunction(callback, "callback");
  const id = hkdfDigest(checked);
  nts_crypto_hkdf_job(
    id,
    checked.key,
    checked.salt,
    checked.info,
    checked.length,
    arrayBufferJob("DERIVEBITSREQUEST", callback as ArrayBufferCallback),
  );
}

export function hkdfSync(digest: unknown, ikm: unknown, salt: unknown, info: unknown, keylen: unknown): ArrayBuffer {
  const checked = checkHkdf(digest, ikm, salt, info, keylen);
  const id = hkdfDigest(checked);
  return asArrayBuffer(derived(nts_crypto_hkdf(id, checked.key, checked.salt, checked.info, checked.length)));
}

// -- scrypt -------------------------------------------------------------------

const scryptDefaults = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 << 20, // 32 MiB, matches SCRYPT_MAX_MEM.
};

export interface ScryptOptions {
  N?: number;
  cost?: number;
  r?: number;
  blockSize?: number;
  p?: number;
  parallelization?: number;
  maxmem?: number;
}

interface ScryptParameters {
  password: Uint8Array;
  salt: Uint8Array;
  keylen: number;
  N: number;
  r: number;
  p: number;
  maxmem: number;
}

function checkScrypt(password: unknown, salt: unknown, keylen: unknown, options: unknown): ScryptParameters {
  const passwordBytes = getArrayBufferOrView(password, "password");
  const saltBytes = getArrayBufferOrView(salt, "salt");
  validateInt32(keylen, "keylen", 0);

  let { N, r, p, maxmem } = scryptDefaults;
  if (options && options !== scryptDefaults) {
    // Each option read twice, as node reads it -- once to ask whether it is
    // there, once for the value that is then checked -- because a getter can
    // tell, and node's own test counts.
    const given = options as ScryptOptions;
    const hasN = given.N !== undefined;
    if (hasN) {
      const value = given.N;
      validateUint32(value, "N");
      N = value;
    }
    if (given.cost !== undefined) {
      if (hasN) throw new ERR_INCOMPATIBLE_OPTION_PAIR("N", "cost");
      const value = given.cost;
      validateUint32(value, "cost");
      N = value;
    }
    const hasR = given.r !== undefined;
    if (hasR) {
      const value = given.r;
      validateUint32(value, "r");
      r = value;
    }
    if (given.blockSize !== undefined) {
      if (hasR) throw new ERR_INCOMPATIBLE_OPTION_PAIR("r", "blockSize");
      const value = given.blockSize;
      validateUint32(value, "blockSize");
      r = value;
    }
    const hasP = given.p !== undefined;
    if (hasP) {
      const value = given.p;
      validateUint32(value, "p");
      p = value;
    }
    if (given.parallelization !== undefined) {
      if (hasP) throw new ERR_INCOMPATIBLE_OPTION_PAIR("p", "parallelization");
      const value = given.parallelization;
      validateUint32(value, "parallelization");
      p = value;
    }
    if (given.maxmem !== undefined) {
      const value = given.maxmem;
      validateInteger(value, "maxmem", 0);
      maxmem = value;
    }
    if (N === 0) N = scryptDefaults.N;
    if (r === 0) r = scryptDefaults.r;
    if (p === 0) p = scryptDefaults.p;
    if (maxmem === 0) maxmem = scryptDefaults.maxmem;
  }

  return {
    password: bytesOf(passwordBytes),
    salt: bytesOf(saltBytes),
    keylen: keylen + 0,
    N,
    r,
    p,
    maxmem,
  };
}

/**
 * The C++ half's check. Node keeps `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` here
 * rather than a decorated OpenSSL error, and appends OpenSSL's newest reason
 * when it has one.
 */
function checkScryptParameters(parameters: ScryptParameters): void {
  if (nts_crypto_scrypt_valid(parameters.N, parameters.r, parameters.p, parameters.maxmem)) return;
  const record = nts_crypto_take_errors();
  throw new ERR_CRYPTO_INVALID_SCRYPT_PARAMS(record.length > 3 ? record[record.length - 1] : undefined);
}

export function scrypt(password: unknown, salt: unknown, keylen: unknown, options: unknown, callback?: unknown): void {
  if (callback === undefined) {
    callback = options;
    options = scryptDefaults;
  }
  const checked = checkScrypt(password, salt, keylen, options);
  validateFunction(callback, "callback");
  checkScryptParameters(checked);
  nts_crypto_scrypt_job(
    checked.password,
    checked.salt,
    checked.N,
    checked.r,
    checked.p,
    checked.maxmem,
    checked.keylen,
    bufferJob("SCRYPTREQUEST", callback as BufferCallback),
  );
}

export function scryptSync(password: unknown, salt: unknown, keylen: unknown, options?: unknown): Buffer {
  const checked = checkScrypt(password, salt, keylen, options === undefined ? scryptDefaults : options);
  checkScryptParameters(checked);
  return asBuffer(
    derived(
      nts_crypto_scrypt(checked.password, checked.salt, checked.N, checked.r, checked.p, checked.maxmem, checked.keylen),
    ),
  );
}
