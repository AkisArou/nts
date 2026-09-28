// Web Crypto's post-quantum algorithms, ML-DSA and ML-KEM, from node v24.20.0
// `lib/internal/crypto/ml_dsa.js` and `ml_kem.js`: key pairs by NID
// (`keygen.c`), raw public and seed, SPKI, seed-form PKCS#8 and AKP JWK
// import and export, ML-DSA signatures with a context (`sig.c`), and ML-KEM
// encapsulation (`kem.c`).
//
// The two families share everything but their usages, their PKCS#8 seed
// wrapper, and what they do with a key.

import { domException, domExceptionWithCause } from "../../../internal/dom-exception.ts";
import { ERR_CRYPTO_OPERATION_FAILED } from "../../../internal/errors.ts";
import { asymmetricHandle, asymmetricKeyTypeOfNative, writeDerKey } from "../keys.ts";
import { bytesOfBase64, jobError } from "../util.ts";
import { createCryptoKey, type CryptoKey, getCryptoKeyAlgorithm, getCryptoKeyHandle, getCryptoKeyType } from "./key.ts";
import { arrayBufferOf, bytesJob, bytesOfSource, type Job, jobPromise, nativeJob, type NormalizedAlgorithm } from "./util.ts";
import {
  createKeyUsages,
  type CryptoKeyPair,
  getKeyPairUsages,
  importDerKey,
  importJwkKey,
  importRawPublic,
  importRawSeed,
  type JsonWebKey,
  type KeyData,
  keyPairJob,
  type TypedHandle,
  validateJwk,
  validateKeyUsages,
  validateUsagesNotEmpty,
  verifyAcceptableKeyUse,
} from "./webcrypto-util.ts";

type BufferSource = ArrayBuffer | ArrayBufferView;

const kDsaUsages = createKeyUsages(["verify"], ["sign"]);
const kKemUsages = createKeyUsages(["encapsulateBits", "encapsulateKey"], ["decapsulateBits", "decapsulateKey"]);

function isKem(name: string): boolean {
  return name.startsWith("ML-KEM");
}

function usagesFor(name: string) {
  return isKem(name) ? kKemUsages : kDsaUsages;
}

/** A PKCS#8 of the private key alone, which node refuses: it wants the seed. */
function privateOnlyPkcs8Length(name: string): number | undefined {
  switch (name) {
    case "ML-DSA-44":
      return 2588;
    case "ML-DSA-65":
      return 4060;
    case "ML-DSA-87":
      return 4924;
    case "ML-KEM-512":
      return 1660;
    case "ML-KEM-768":
      return 2428;
    case "ML-KEM-1024":
      return 3196;
    default:
      return undefined;
  }
}

/**
 * Node's seed-form PKCS#8: the algorithm's OID (`2.16.840.1.101.3.4.3.x` for
 * ML-DSA, `.4.4.x` for ML-KEM) and the seed as a context-specific
 * `[0] IMPLICIT OCTET STRING`, the bytes node writes by hand.
 */
function seedPkcs8(name: string, seed: Uint8Array): Uint8Array<ArrayBuffer> {
  const kem = isKem(name);
  const oidArc = kem ? 0x04 : 0x03;
  const last = name.endsWith("-44") || name.endsWith("-512") ? 1 : name.endsWith("-65") || name.endsWith("-768") ? 2 : 3;
  const orc = kem ? last : 0x10 + last;
  const header = kem
    ? [0x30, 0x54, 0x02, 0x01, 0x00, 0x30, 0x0b, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, oidArc, orc, 0x04, 0x42, 0x80, 0x40]
    : [0x30, 0x34, 0x02, 0x01, 0x00, 0x30, 0x0b, 0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, oidArc, orc, 0x04, 0x22, 0x80, 0x20];
  const buffer = new Uint8Array(header.length + seed.byteLength);
  buffer.set(header, 0);
  buffer.set(seed, header.length);
  return buffer;
}

/** Node's `mlDsaGenerateKey` and `mlKemGenerateKey`. */
export function pqcGenerateKey(algorithm: NormalizedAlgorithm, extractable: boolean, usages: string[]): Job<CryptoKeyPair> {
  const { name } = algorithm;
  const allowed = usagesFor(name);
  const usageSet = validateKeyUsages(usages, allowed.keygen, name);
  const keyUsages = getKeyPairUsages(usageSet, allowed);
  validateUsagesNotEmpty(keyUsages.private);
  return jobPromise(() => {
    const job = nts_crypto_keygen_nid(name.toLowerCase());
    if (job === 0) throw jobError("Key generation job failed");
    return keyPairJob(job, { name }, keyUsages.public, keyUsages.private, extractable);
  });
}

/** Node's `mlDsaExportKey` and `mlKemExportKey`: raw (public key or seed), SPKI, and seed-form PKCS#8. */
export function pqcExportKey(key: CryptoKey, format: "raw" | "spki" | "pkcs8"): ArrayBuffer {
  try {
    const native = getCryptoKeyHandle(key).native;
    switch (format) {
      case "raw": {
        const bytes = getCryptoKeyType(key) === "private" ? seedOf(native) : nts_crypto_key_export_raw(native, false, false);
        if (bytes === null) throw new ERR_CRYPTO_OPERATION_FAILED("Failed to get raw public key");
        return arrayBufferOf(bytes);
      }
      case "spki":
        return writeDerKey(native, true).slice().buffer;
      default:
        return seedPkcs8(getCryptoKeyAlgorithm(key).name, seedOf(native)).buffer;
    }
  } catch (error) {
    throw domExceptionWithCause("The operation failed for an operation-specific reason", "OperationError", error);
  }
}

/** Node's handle `rawSeed`. */
function seedOf(native: number): Uint8Array {
  const seed = nts_crypto_key_export_seed(native);
  if (seed === null) throw new ERR_CRYPTO_OPERATION_FAILED("Failed to get raw seed");
  return seed;
}

/** Node's `mlDsaImportKey` and `mlKemImportKey`. */
export function pqcImportKey(
  format: string,
  keyData: KeyData,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: string[],
): CryptoKey | undefined {
  const { name } = algorithm;
  const allowed = usagesFor(name);
  const usageSet = new Set(usages);
  let native: number;
  let isPublic: boolean;
  switch (format) {
    case "KeyObjectHandle": {
      const { handle, type } = keyData as TypedHandle;
      isPublic = type === "public";
      verifyAcceptableKeyUse(name, usageSet, isPublic ? allowed.public : allowed.private);
      native = handle.native;
      break;
    }
    case "spki":
      verifyAcceptableKeyUse(name, usageSet, allowed.public);
      native = importDerKey(keyData as Uint8Array, true);
      isPublic = true;
      break;
    case "pkcs8": {
      verifyAcceptableKeyUse(name, usageSet, allowed.private);
      if ((keyData as Uint8Array).byteLength === privateOnlyPkcs8Length(name)) {
        throw domException(
          `Importing an ${isKem(name) ? "ML-KEM" : "ML-DSA"} PKCS#8 key without a seed is not supported`,
          "NotSupportedError",
        );
      }
      native = importDerKey(keyData as Uint8Array, false);
      isPublic = false;
      break;
    }
    case "jwk": {
      const jwk = keyData as JsonWebKey;
      validateJwk(jwk, "AKP", extractable, usageSet, isKem(name) ? "enc" : "sig");
      if (jwk.alg !== name) throw domException('JWK "alg" Parameter and algorithm name mismatch', "DataError");
      isPublic = jwk.priv === undefined;
      verifyAcceptableKeyUse(name, usageSet, isPublic ? allowed.public : allowed.private);
      native = importJwkKey(jwk);
      if (!isPublic && !isKem(name)) {
        // ML-DSA's: the private key's public half must be the `pub` it came with.
        const derived = nts_crypto_key_export_raw(native, false, false);
        const given = bytesOfBase64(jwk.pub!);
        if (derived === null || !sameBytes(derived, given)) throw domException("Invalid keyData", "DataError");
      }
      break;
    }
    case "raw-public":
      verifyAcceptableKeyUse(name, usageSet, allowed.public);
      native = importRawPublic(name.toLowerCase(), undefined, keyData as Uint8Array);
      isPublic = true;
      break;
    case "raw-seed":
      verifyAcceptableKeyUse(name, usageSet, allowed.private);
      native = importRawSeed(name.toLowerCase(), keyData as Uint8Array);
      isPublic = false;
      break;
    default:
      return undefined;
  }
  if (asymmetricKeyTypeOfNative(native) !== name.toLowerCase()) throw domException("Invalid key type", "DataError");
  return createCryptoKey(isPublic ? "public" : "private", asymmetricHandle(native), { name }, usageSet, extractable);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Node's `mlDsaSignVerify`: always with the algorithm's context, empty if none. */
export function mlDsaSignVerify(
  key: CryptoKey,
  data: BufferSource,
  algorithm: NormalizedAlgorithm,
  signature?: BufferSource,
): Job<ArrayBuffer | boolean> {
  const type = signature === undefined ? "private" : "public";
  if (getCryptoKeyType(key) !== type) throw domException(`Key must be a ${type} key`, "InvalidAccessError");
  const native = getCryptoKeyHandle(key).native;
  const input = bytesOfSource(data);
  const noBytes = new Uint8Array(0);
  const context = algorithm.context ?? noBytes;
  if (signature === undefined) {
    return jobPromise(() =>
      bytesJob("Deriving bits failed", (done) => nts_crypto_sign_job(false, native, input, -1, NaN, NaN, context, noBytes, done)),
    );
  }
  const expected = bytesOfSource(signature);
  return jobPromise(() =>
    nativeJob<boolean>("Deriving bits failed", (succeed, fail) =>
      nts_crypto_sign_job(true, native, input, -1, NaN, NaN, context, expected, (ok, answer) =>
        ok ? succeed(answer[0] === 1) : fail(),
      ),
    ),
  );
}

/** What `encapsulateBits` answers. */
export interface EncapsulatedBits {
  sharedKey: ArrayBuffer;
  ciphertext: ArrayBuffer;
}

/** Node's `mlKemEncapsulate`: a shared key and its ciphertext, as node's job defines them, in that order. */
export function mlKemEncapsulate(key: CryptoKey): Job<EncapsulatedBits> {
  if (getCryptoKeyType(key) !== "public") throw domException("Key must be a public key", "InvalidAccessError");
  const native = getCryptoKeyHandle(key).native;
  return jobPromise(() =>
    nativeJob<EncapsulatedBits>("Deriving bits failed", (succeed, fail) =>
      nts_crypto_kem_encapsulate_job(native, (ok, sharedKey, ciphertext) =>
        ok ? succeed({ sharedKey: arrayBufferOf(sharedKey), ciphertext: arrayBufferOf(ciphertext) }) : fail(),
      ),
    ),
  );
}

/** Node's `mlKemDecapsulate`. */
export function mlKemDecapsulate(key: CryptoKey, ciphertext: BufferSource): Job<ArrayBuffer> {
  if (getCryptoKeyType(key) !== "private") throw domException("Key must be a private key", "InvalidAccessError");
  const native = getCryptoKeyHandle(key).native;
  const input = bytesOfSource(ciphertext);
  return jobPromise(() => bytesJob("Deriving bits failed", (done) => nts_crypto_kem_decapsulate_job(native, input, done)));
}
