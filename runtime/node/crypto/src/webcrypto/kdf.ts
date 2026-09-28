// Web Crypto's key derivations, HKDF and PBKDF2, from node v24.20.0
// `lib/internal/crypto/hkdf.js` and `pbkdf2.js`: node's `HKDFJob` and
// `PBKDF2Job` in their Web Crypto mode, here `crypto.c`'s jobs.

import { domException } from "../../../internal/dom-exception.ts";
import { ERR_CRYPTO_INVALID_KEYLEN } from "../../../internal/errors.ts";
import { digestId } from "../util.ts";
import { type CryptoKey, getCryptoKeyHandle } from "./key.ts";
import { bytesJob, type Job, jobPromise, type NormalizedAlgorithm, resolvedJob, webCryptoHashName } from "./util.ts";

/** Node's `validateHkdfDeriveBitsLength` and `validatePbkdf2DeriveBitsLength`: whole bytes, and some. */
export function validateDeriveBitsLength(length: number | null | undefined): asserts length is number {
  if (length === null || length === undefined) throw domException("length cannot be null", "OperationError");
  if (length % 8) throw domException("length must be a multiple of 8", "OperationError");
}

/** Node's `hkdfDeriveBits`. */
export function hkdfDeriveBits(algorithm: NormalizedAlgorithm, baseKey: CryptoKey, length: number | null | undefined): Job<ArrayBuffer> {
  validateDeriveBitsLength(length);
  if (length === 0) return resolvedJob(new ArrayBuffer(0));
  const id = digestId(webCryptoHashName(algorithm.hash!.name)!);
  const key = getCryptoKeyHandle(baseKey).bytes;
  return jobPromise(() => {
    // `HKDFTraits::AdditionalConfig`: at most 255 blocks of the digest.
    if (!nts_crypto_hkdf_length_ok(id, length / 8)) throw new ERR_CRYPTO_INVALID_KEYLEN();
    return bytesJob("Deriving bits failed", (done) =>
      nts_crypto_hkdf_job(id, key, algorithm.salt!, algorithm.info!, length / 8, done),
    );
  });
}

/** Node's `pbkdf2DeriveBits`. */
export function pbkdf2DeriveBits(algorithm: NormalizedAlgorithm, baseKey: CryptoKey, length: number | null | undefined): Job<ArrayBuffer> {
  validateDeriveBitsLength(length);
  if (length === 0) return resolvedJob(new ArrayBuffer(0));
  const id = digestId(webCryptoHashName(algorithm.hash!.name)!);
  const key = getCryptoKeyHandle(baseKey).bytes;
  return jobPromise(() =>
    bytesJob("Deriving bits failed", (done) =>
      nts_crypto_pbkdf2_job(key, algorithm.salt!, algorithm.iterations!, length / 8, id, done),
    ),
  );
}

/** Node's `validateArgon2DeriveBitsLength`: whole bytes, at least four of them. */
export function validateArgon2DeriveBitsLength(length: number | null | undefined): asserts length is number {
  validateDeriveBitsLength(length);
  if (length < 32) throw domException("length must be >= 32", "OperationError");
}

/** `argon2.c`'s types, which `kdf.ts`'s `ARGON2_ALGORITHMS` orders the same way. */
function argon2Type(name: string): number {
  return name === "Argon2d" ? 0 : name === "Argon2i" ? 1 : 2;
}

/** Node's `argon2DeriveBits`: the base key is the password, the nonce the salt. */
export function argon2DeriveBits(algorithm: NormalizedAlgorithm, baseKey: CryptoKey, length: number | null | undefined): Job<ArrayBuffer> {
  validateArgon2DeriveBitsLength(length);
  const password = getCryptoKeyHandle(baseKey).bytes;
  const noBytes = new Uint8Array(0);
  return jobPromise(() =>
    bytesJob("Deriving bits failed", (done) =>
      nts_crypto_argon2_job(
        argon2Type(algorithm.name),
        password,
        algorithm.nonce!,
        algorithm.parallelism!,
        length / 8,
        algorithm.memory!,
        algorithm.passes!,
        algorithm.secretValue ?? noBytes,
        algorithm.associatedData ?? noBytes,
        done,
      ),
    ),
  );
}
