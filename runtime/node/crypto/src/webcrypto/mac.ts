// Web Crypto's HMAC, from node v24.20.0 `lib/internal/crypto/mac.js`: key
// generation through node's `SecretKeyGenJob`, import, and signing and
// verifying through its `HmacJob` -- here `crypto.c`'s HMAC job.

import { domException } from "../../../internal/dom-exception.ts";
import { digestId } from "../util.ts";
import { createCryptoKey, type CryptoKey, getCryptoKeyAlgorithm, getCryptoKeyHandle, type KeyAlgorithm } from "./key.ts";
import {
  bytesJob,
  bytesOfSource,
  getBlockSize,
  type Job,
  jobPromise,
  nativeJob,
  type NormalizedAlgorithm,
  numBitsToBytes,
  truncateToBitLength,
  webCryptoHashName,
} from "./util.ts";
import {
  importJwkSecretKey,
  importSecretKey,
  type JsonWebKey,
  type KeyData,
  secretKeyGen,
  type TypedHandle,
  validateJwk,
  validateKeyUsages,
  validateUsagesNotEmpty,
} from "./webcrypto-util.ts";
import type { KeyObjectHandle } from "../keys.ts";

const kUsages = ["sign", "verify"];

/** An HMAC key's JWK `alg` for its hash: node's `kHashContextJwkHmac`, where one exists. */
export function hmacJwkAlgorithm(hashName: string): string | undefined {
  switch (hashName) {
    case "SHA-1":
      return "HS1";
    case "SHA-256":
      return "HS256";
    case "SHA-384":
      return "HS384";
    case "SHA-512":
      return "HS512";
    default:
      return undefined;
  }
}

/**
 * Node's `normalizeKeyLength`: the key's length in bits, which an explicit
 * `length` must agree with to the byte and may shorten within the last one.
 */
function normalizeKeyLength(
  handle: KeyObjectHandle,
  algorithm: NormalizedAlgorithm,
): { handle: KeyObjectHandle; length: number } {
  let length = handle.bytes.byteLength * 8;
  if (length === 0 && algorithm.name === "HMAC") throw domException("Zero-length key is not supported", "DataError");
  if (algorithm.length !== undefined) {
    if (numBitsToBytes(algorithm.length) !== handle.bytes.byteLength) {
      throw domException("Invalid key length", "DataError");
    }
    if (algorithm.length % 8 !== 0) handle = importSecretKey(truncateToBitLength(algorithm.length, handle.bytes));
    length = algorithm.length;
  }
  return { handle, length };
}

export function hmacGenerateKey(algorithm: NormalizedAlgorithm, extractable: boolean, usages: string[]): Job<CryptoKey> {
  const hash = algorithm.hash!;
  const name = algorithm.name;
  const length = algorithm.length ?? getBlockSize(hash.name);
  const usageSet = validateUsagesNotEmpty(validateKeyUsages(usages, kUsages, name));
  return jobPromise(() => secretKeyGen(length, { name, length, hash: { name: hash.name } }, usageSet, extractable));
}

/** Node's `macImportKey`, for HMAC: raw bytes, a JWK, or a handle a derivation made. */
export function macImportKey(
  format: string,
  keyData: KeyData,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: string[],
): CryptoKey | undefined {
  const usageSet = validateKeyUsages(usages, kUsages, algorithm.name);
  let handle: KeyObjectHandle;
  switch (format) {
    case "KeyObjectHandle":
      handle = (keyData as TypedHandle).handle;
      break;
    case "raw-secret":
    case "raw":
      handle = importSecretKey(keyData as Uint8Array);
      break;
    case "jwk": {
      const jwk = keyData as JsonWebKey;
      validateJwk(jwk, "oct", extractable, usageSet, "sig");
      if (jwk.alg !== undefined) {
        const expected = hmacJwkAlgorithm(algorithm.hash!.name);
        if (expected && jwk.alg !== expected) {
          throw domException('JWK "alg" does not match the requested algorithm', "DataError");
        }
      }
      handle = importJwkSecretKey(jwk);
      break;
    }
    default:
      return undefined;
  }
  const normalized = normalizeKeyLength(handle, algorithm);
  const keyAlgorithm: KeyAlgorithm = {
    name: algorithm.name,
    length: normalized.length,
    hash: { name: algorithm.hash!.name },
  };
  return createCryptoKey("secret", normalized.handle, keyAlgorithm, usageSet, extractable);
}

/** Node's `hmacSignVerify`: the MAC, or whether `signature` is it, compared in constant time. */
export function hmacSignVerify(
  key: CryptoKey,
  data: ArrayBuffer | ArrayBufferView,
  signature?: ArrayBuffer | ArrayBufferView,
): Job<ArrayBuffer | boolean> {
  const id = digestId(webCryptoHashName(getCryptoKeyAlgorithm(key).hash!.name)!);
  const secret = getCryptoKeyHandle(key).bytes;
  const input = bytesOfSource(data);
  if (signature === undefined) {
    return jobPromise(() => bytesJob("Deriving bits failed", (done) => nts_crypto_hmac_job(id, secret, input, done)));
  }
  // The job holds its own copy of what it verifies, as node's does.
  const expected = new Uint8Array(bytesOfSource(signature));
  return jobPromise(() =>
    nativeJob<boolean>("Deriving bits failed", (succeed, fail) =>
      nts_crypto_hmac_job(id, secret, input, (ok, mac) => {
        if (!ok) fail();
        else succeed(mac.byteLength === expected.byteLength && nts_crypto_timing_safe_equal(mac, expected));
      }),
    ),
  );
}
