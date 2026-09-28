// Web Crypto's AES, from node v24.20.0 `lib/internal/crypto/aes.js`: CBC,
// CTR, GCM, KW and OCB keys, and their ciphers over node's `AESCipherJob` --
// here `aes.c`.

import { domException } from "../../../internal/dom-exception.ts";
import {
  ERR_CRYPTO_INVALID_COUNTER,
  ERR_CRYPTO_INVALID_IV,
  ERR_CRYPTO_INVALID_TAG_LENGTH,
  ERR_CRYPTO_UNKNOWN_CIPHER,
} from "../../../internal/errors.ts";
import type { KeyObjectHandle } from "../keys.ts";
import { createCryptoKey, type CryptoKey, getCryptoKeyHandle } from "./key.ts";
import { bytesJob, bytesOfSource, type Job, jobPromise, type NormalizedAlgorithm } from "./util.ts";
import {
  importJwkSecretKey,
  importSecretKey,
  type JsonWebKey,
  secretKeyGen,
  validateJwk,
  validateKeyUsages,
  validateUsagesNotEmpty,
} from "./webcrypto-util.ts";

/** Web Crypto's cipher modes: `encrypt` and `decrypt`, and the wraps built on them. */
export type CipherMode = "encrypt" | "decrypt";

const kCipherUsages = ["encrypt", "decrypt", "wrapKey", "unwrapKey"];
const kWrapUsages = ["wrapKey", "unwrapKey"];

function usagesFor(name: string): string[] {
  return name === "AES-KW" ? kWrapUsages : kCipherUsages;
}

/** `aes.c`'s modes. */
const AesMode = { Cbc: 0, Ctr: 1, Gcm: 2, Kw: 3, Ocb: 4 } as const;

/** `aes.c`'s configuration refusals, which node throws before a job runs. */
const AesConfig = { Ok: 0, UnknownCipher: -1, InvalidIv: -2, InvalidCounter: -3, InvalidTagLength: -4 } as const;

function modeOf(name: string): number {
  switch (name) {
    case "AES-CBC":
      return AesMode.Cbc;
    case "AES-CTR":
      return AesMode.Ctr;
    case "AES-GCM":
      return AesMode.Gcm;
    case "AES-KW":
      return AesMode.Kw;
    default:
      return AesMode.Ocb;
  }
}

/** Node's `getAlgorithmName`: the JWK `alg` of an AES key. */
export function getAlgorithmName(name: string, length: number | undefined): string | undefined {
  switch (name) {
    case "AES-CBC":
      return `A${length}CBC`;
    case "AES-CTR":
      return `A${length}CTR`;
    case "AES-GCM":
      return `A${length}GCM`;
    case "AES-KW":
      return `A${length}KW`;
    case "AES-OCB":
      return `A${length}OCB`;
    default:
      return undefined;
  }
}

function validateKeyLength(length: number): void {
  if (length !== 128 && length !== 192 && length !== 256) throw domException("Invalid key length", "DataError");
}

/**
 * Node's `AESCipherTraits::AdditionalConfig`, which throws synchronously --
 * inside `jobPromise`, so a caller sees an `OperationError` caused by it.
 */
function checkConfig(mode: number, key: KeyObjectHandle, iv: Uint8Array, length: number): void {
  switch (nts_crypto_aes_config(mode, key.bytes.byteLength, iv.byteLength, length)) {
    case AesConfig.UnknownCipher:
      throw new ERR_CRYPTO_UNKNOWN_CIPHER();
    case AesConfig.InvalidIv:
      throw new ERR_CRYPTO_INVALID_IV();
    case AesConfig.InvalidCounter:
      throw new ERR_CRYPTO_INVALID_COUNTER();
    case AesConfig.InvalidTagLength:
      throw new ERR_CRYPTO_INVALID_TAG_LENGTH();
  }
}

const noBytes = new Uint8Array(0);

/** An `AESCipherJob`: `length` is CTR's counter bits or an AEAD's tag bytes. */
function aesJob(
  mode: number,
  cipherMode: CipherMode,
  key: CryptoKey,
  data: ArrayBuffer | ArrayBufferView,
  iv: Uint8Array,
  length: number,
  additional: Uint8Array,
): Job<ArrayBuffer> {
  return jobPromise(() => {
    const handle = getCryptoKeyHandle(key);
    checkConfig(mode, handle, iv, length);
    const input = bytesOfSource(data);
    return bytesJob("Cipher job failed", (done) =>
      nts_crypto_aes_job(mode, cipherMode === "encrypt", handle.bytes, input, iv, length, additional, done),
    );
  });
}

/** Node's `aesCipher`. */
export function aesCipher(
  cipherMode: CipherMode,
  key: CryptoKey,
  data: ArrayBuffer | ArrayBufferView,
  algorithm: NormalizedAlgorithm,
): Job<ArrayBuffer> {
  switch (algorithm.name) {
    case "AES-CTR":
      return aesJob(AesMode.Ctr, cipherMode, key, data, algorithm.counter!, algorithm.length!, noBytes);
    case "AES-CBC":
      return aesJob(AesMode.Cbc, cipherMode, key, data, algorithm.iv!, 0, noBytes);
    case "AES-KW":
      return aesJob(AesMode.Kw, cipherMode, key, data, noBytes, 0, noBytes);
    default: {
      const tagLength = algorithm.tagLength ?? 128;
      return aesJob(
        modeOf(algorithm.name),
        cipherMode,
        key,
        data,
        algorithm.iv!,
        tagLength / 8,
        algorithm.additionalData ?? noBytes,
      );
    }
  }
}

/** Node's `aesGenerateKey`. */
export function aesGenerateKey(algorithm: NormalizedAlgorithm, extractable: boolean, usages: string[]): Job<CryptoKey> {
  const { name } = algorithm;
  const length = algorithm.length!;
  const usageSet = validateUsagesNotEmpty(validateKeyUsages(usages, usagesFor(name), name));
  return jobPromise(() => secretKeyGen(length, { name, length }, usageSet, extractable));
}

/** Node's `aesImportKey`: raw bytes -- not for OCB, whose raw form is `raw-secret` -- or a JWK. */
export function aesImportKey(
  algorithm: NormalizedAlgorithm,
  format: string,
  keyData: Uint8Array | JsonWebKey,
  extractable: boolean,
  usages: string[],
): CryptoKey | undefined {
  const { name } = algorithm;
  const usageSet = validateKeyUsages(usages, usagesFor(name), name);
  let handle: KeyObjectHandle;
  let length: number;
  switch (format) {
    case "raw-secret":
    case "raw": {
      if (format === "raw" && name === "AES-OCB") return undefined;
      const bytes = keyData as Uint8Array;
      length = bytes.byteLength * 8;
      validateKeyLength(length);
      handle = importSecretKey(bytes);
      break;
    }
    case "jwk": {
      const jwk = keyData as JsonWebKey;
      validateJwk(jwk, "oct", extractable, usageSet, "enc");
      handle = importJwkSecretKey(jwk);
      length = handle.bytes.byteLength * 8;
      validateKeyLength(length);
      if (jwk.alg !== undefined && jwk.alg !== getAlgorithmName(name, length)) {
        throw domException('JWK "alg" does not match the requested algorithm', "DataError");
      }
      break;
    }
    default:
      return undefined;
  }
  return createCryptoKey("secret", handle, { name, length }, usageSet, extractable);
}

