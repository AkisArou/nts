// Web Crypto's HMAC and KMAC, from node v24.20.0 `lib/internal/crypto/mac.js`:
// key generation through node's `SecretKeyGenJob`, import, and signing and
// verifying through its `HmacJob` and `KmacJob` -- here `crypto.c`'s HMAC job
// and `keccak.c`'s KMAC.

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
const noBytes = new Uint8Array(0);

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

/** Node's `kmacGenerateKey`: a key of the variant's strength unless `length` says otherwise. */
export function kmacGenerateKey(algorithm: NormalizedAlgorithm, extractable: boolean, usages: string[]): Job<CryptoKey> {
  const name = algorithm.name;
  const length = algorithm.length ?? (name === "KMAC128" ? 128 : 256);
  const usageSet = validateUsagesNotEmpty(validateKeyUsages(usages, kUsages, name));
  return jobPromise(() => secretKeyGen(length, { name, length }, usageSet, extractable));
}

export function hmacGenerateKey(algorithm: NormalizedAlgorithm, extractable: boolean, usages: string[]): Job<CryptoKey> {
  const hash = algorithm.hash!;
  const name = algorithm.name;
  const length = algorithm.length ?? getBlockSize(hash.name);
  const usageSet = validateUsagesNotEmpty(validateKeyUsages(usages, kUsages, name));
  return jobPromise(() => secretKeyGen(length, { name, length, hash: { name: hash.name } }, usageSet, extractable));
}

/** Node's `macImportKey`: raw bytes (as "raw" for HMAC only), a JWK, or a handle a derivation made. */
export function macImportKey(
  format: string,
  keyData: KeyData,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: string[],
): CryptoKey | undefined {
  const isHmac = algorithm.name === "HMAC";
  const usageSet = validateKeyUsages(usages, kUsages, algorithm.name);
  let handle: KeyObjectHandle;
  switch (format) {
    case "KeyObjectHandle":
      handle = (keyData as TypedHandle).handle;
      break;
    case "raw-secret":
    case "raw":
      if (format === "raw" && !isHmac) return undefined;
      handle = importSecretKey(keyData as Uint8Array);
      break;
    case "jwk": {
      const jwk = keyData as JsonWebKey;
      validateJwk(jwk, "oct", extractable, usageSet, "sig");
      if (jwk.alg !== undefined) {
        const expected = isHmac ? hmacJwkAlgorithm(algorithm.hash!.name) : `K${algorithm.name.substring(4)}`;
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
  const keyAlgorithm: KeyAlgorithm = isHmac
    ? { name: algorithm.name, length: normalized.length, hash: { name: algorithm.hash!.name } }
    : { name: algorithm.name, length: normalized.length };
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

/** Node's `kmacSignVerify`: `keccak.c`'s KMAC, or whether `signature` is it -- never for an empty MAC. */
export function kmacSignVerify(
  key: CryptoKey,
  data: ArrayBuffer | ArrayBufferView,
  algorithm: NormalizedAlgorithm,
  signature?: ArrayBuffer | ArrayBufferView,
): Job<ArrayBuffer | boolean> {
  const variant = algorithm.name === "KMAC128" ? 128 : 256;
  const secret = getCryptoKeyHandle(key).bytes;
  const keyLength = getCryptoKeyAlgorithm(key).length!;
  const input = bytesOfSource(data);
  const customization = algorithm.customization ?? noBytes;
  const length = algorithm.outputLength!;
  if (signature === undefined) {
    return jobPromise(() =>
      bytesJob("Deriving bits failed", (done) =>
        nts_crypto_kmac_job(variant, secret, keyLength, input, customization, length, done),
      ),
    );
  }
  const expected = new Uint8Array(bytesOfSource(signature));
  return jobPromise(() =>
    nativeJob<boolean>("Deriving bits failed", (succeed, fail) =>
      nts_crypto_kmac_job(variant, secret, keyLength, input, customization, length, (ok, mac) => {
        if (!ok) fail();
        else {
          succeed(
            mac.byteLength > 0 &&
              mac.byteLength === expected.byteLength &&
              nts_crypto_timing_safe_equal(mac, expected),
          );
        }
      }),
    ),
  );
}
