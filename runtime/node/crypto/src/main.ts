// `node:crypto`, from node v24.20.0 `lib/crypto.js`, over OpenSSL 3.
//
// The digests, MACs, symmetric ciphers, key derivations and random numbers:
// `createHash` and `hash`, `createHmac` over secret keys, `createCipheriv`
// and `createDecipheriv`, `pbkdf2`, `hkdf` and `scrypt`, the random bytes,
// integers and UUIDs, and `timingSafeEqual`.
//
// Not yet: signatures, asymmetric keys and key generation,
// Diffie-Hellman and ECDH, primes, X.509, and Web Crypto's
// `subtle`. Each is its own part of OpenSSL, and
// `tooling/conformance/missing-exports` lists the names.

import {
  ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH,
  ERR_INVALID_ARG_TYPE_BINDING,
} from "../../internal/errors.ts";
import { isAnyArrayBuffer, isArrayBufferView } from "../../util/src/types.ts";
import { Hash, Hmac } from "./hash.ts";
import { bytesOf, OpenSSLError } from "./util.ts";

export { createHash, createHmac, getHashes, hash } from "./hash.ts";
export { Cipheriv, createCipheriv, createDecipheriv, Decipheriv, getCipherInfo, getCiphers } from "./cipher.ts";
export { createPrivateKey, createPublicKey, createSecretKey, KeyObject } from "./keys.ts";
export { hkdf, hkdfSync, pbkdf2, pbkdf2Sync, scrypt, scryptSync } from "./kdf.ts";
export {
  getRandomValues,
  randomBytes,
  randomFill,
  randomFillSync,
  randomInt,
  randomUUID,
  randomUUIDv7,
} from "./random.ts";
export { constants } from "./constants.ts";

/**
 * `crypto.timingSafeEqual(a, b)`, whose argument checks node keeps in C++
 * (nodejs/node#34073), which is why their messages are not the usual template.
 */
export function timingSafeEqual(buf1: unknown, buf2: unknown): boolean {
  if (!isAnyArrayBuffer(buf1) && !isArrayBufferView(buf1)) {
    throw new ERR_INVALID_ARG_TYPE_BINDING(
      'The "buf1" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.',
    );
  }
  if (!isAnyArrayBuffer(buf2) && !isArrayBufferView(buf2)) {
    throw new ERR_INVALID_ARG_TYPE_BINDING(
      'The "buf2" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.',
    );
  }
  const a = bytesOf(buf1);
  const b = bytesOf(buf2);
  if (a.byteLength !== b.byteLength) throw new ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH();
  return nts_crypto_timing_safe_equal(a, b);
}

export interface SecureHeapUsage {
  total: number;
  used: number;
  utilization: number;
  min: number;
}

/**
 * `crypto.secureHeapUsed()`. OpenSSL's secure heap exists only when node was
 * started with `--secure-heap`, which a compiled program cannot be, so this is
 * node's answer with the options at their defaults: `total` is
 * `--secure-heap` (0), `min` is `--secure-heap-min` (2), nothing is used, and
 * `utilization` is their quotient, 0 / 0.
 */
export function secureHeapUsed(): SecureHeapUsage {
  const used = 0;
  const total = 0;
  return { total, used, utilization: used / total, min: 2 };
}

/**
 * `crypto.getFips()`: 1 when OpenSSL's default properties ask for FIPS. Node
 * answers 1 unconditionally under `--force-fips`, which a compiled program
 * cannot be started with.
 */
export function getFips(): number {
  return nts_crypto_fips_enabled() ? 1 : 0;
}

/**
 * `crypto.setFips(enabled)`. A failure is reported as node's
 * `cryptoErrorListToException` reports one: the newest error is the message,
 * the rest are `opensslErrorStack`, and an empty list says `Ok`.
 */
export function setFips(enabled: unknown): void {
  if (nts_crypto_set_fips(Boolean(enabled))) return;
  const errors = nts_crypto_take_errors().slice(3);
  const error = new OpenSSLError(errors.length === 0 ? "Ok" : errors[errors.length - 1]!);
  if (errors.length > 1) error.opensslErrorStack = errors.slice(0, -1);
  throw error;
}

// `Hash` and `Hmac` as classes. Node exports them as deprecated functions
// that construct themselves without `new`; that calling convention, and the
// DEP0179/DEP0181 warning with it, is JavaScript's, and `shape.mjs` gives it.
export { Hash, Hmac };
