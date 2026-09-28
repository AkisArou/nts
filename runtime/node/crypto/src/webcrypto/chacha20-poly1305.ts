// Web Crypto's ChaCha20-Poly1305, from node v24.20.0
// `lib/internal/crypto/chacha20_poly1305.js`: node's
// `ChaCha20Poly1305CipherJob`, here `aes.c`'s sixth mode.

import { domException } from "../../../internal/dom-exception.ts";
import { ERR_CRYPTO_INVALID_IV, ERR_CRYPTO_UNKNOWN_CIPHER } from "../../../internal/errors.ts";
import type { KeyObjectHandle } from "../keys.ts";
import { createCryptoKey, type CryptoKey, getCryptoKeyHandle } from "./key.ts";
import { bytesJob, bytesOfSource, type Job, jobPromise, type NormalizedAlgorithm } from "./util.ts";
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

const kUsages = ["encrypt", "decrypt", "wrapKey", "unwrapKey"];

/** `aes.c`'s mode for it, and the tag length that mode fixes. */
const kMode = 5;
const kTagBytes = 16;

function validateKeyLength(length: number): void {
  if (length !== 256) throw domException("Invalid key length", "DataError");
}

/** Node's `c20pCipher`: the 12-byte nonce checked as `AdditionalConfig` checks it, inside `jobPromise`. */
export function c20pCipher(
  mode: "encrypt" | "decrypt",
  key: CryptoKey,
  data: ArrayBuffer | ArrayBufferView,
  algorithm: NormalizedAlgorithm,
): Job<ArrayBuffer> {
  const iv = algorithm.iv!;
  const additional = algorithm.additionalData ?? new Uint8Array(0);
  const input = bytesOfSource(data);
  return jobPromise(() => {
    const secret = getCryptoKeyHandle(key).bytes;
    const status = nts_crypto_aes_config(kMode, secret.byteLength, iv.byteLength, kTagBytes);
    if (status === -1) throw new ERR_CRYPTO_UNKNOWN_CIPHER();
    if (status === -2) throw new ERR_CRYPTO_INVALID_IV();
    return bytesJob("Cipher job failed", (done) =>
      nts_crypto_aes_job(kMode, mode === "encrypt", secret, input, iv, kTagBytes, additional, done),
    );
  });
}

/** Node's `c20pGenerateKey`: always 256 bits. */
export function c20pGenerateKey(algorithm: NormalizedAlgorithm, extractable: boolean, usages: string[]): Job<CryptoKey> {
  const { name } = algorithm;
  const usageSet = validateUsagesNotEmpty(validateKeyUsages(usages, kUsages, name));
  return jobPromise(() => secretKeyGen(256, { name }, usageSet, extractable));
}

/** Node's `c20pImportKey`: `raw-secret` or a JWK, never plain `raw`. */
export function c20pImportKey(
  algorithm: NormalizedAlgorithm,
  format: string,
  keyData: KeyData,
  extractable: boolean,
  usages: string[],
): CryptoKey | undefined {
  const { name } = algorithm;
  const usageSet = validateKeyUsages(usages, kUsages, name);
  let handle: KeyObjectHandle;
  switch (format) {
    case "KeyObjectHandle":
      handle = (keyData as TypedHandle).handle;
      break;
    case "raw-secret":
      handle = importSecretKey(keyData as Uint8Array);
      break;
    case "jwk": {
      const jwk = keyData as JsonWebKey;
      validateJwk(jwk, "oct", extractable, usageSet, "enc");
      handle = importJwkSecretKey(jwk);
      if (jwk.alg !== undefined && jwk.alg !== "C20P") {
        throw domException('JWK "alg" does not match the requested algorithm', "DataError");
      }
      break;
    }
    default:
      return undefined;
  }
  validateKeyLength(handle.bytes.byteLength * 8);
  return createCryptoKey("secret", handle, { name }, usageSet, extractable);
}
