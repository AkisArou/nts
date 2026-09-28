// Web Crypto's Edwards and Montgomery curves -- Ed25519, Ed448, X25519 and
// X448 -- from node v24.20.0 `lib/internal/crypto/cfrg.js`, with ECDH's and
// theirs shared derivation from `diffiehellman.js` (`ecdhDeriveBits`).

import { domException, domExceptionWithCause } from "../../../internal/dom-exception.ts";
import { ERR_OUT_OF_RANGE_BINDING } from "../../../internal/errors.ts";
import { asymmetricHandle, asymmetricKeyTypeOfNative, writeDerKey } from "../keys.ts";
import { bytesOfBase64, jobError } from "../util.ts";
import { createCryptoKey, type CryptoKey, getCryptoKeyAlgorithm, getCryptoKeyHandle, getCryptoKeyType } from "./key.ts";
import {
  arrayBufferOf,
  bytesJob,
  bytesOfSource,
  type Job,
  jobPromise,
  mapJob,
  nativeJob,
  type NormalizedAlgorithm,
  numBitsToBytes,
  truncateToBitLength,
} from "./util.ts";
import {
  createKeyUsages,
  type CryptoKeyPair,
  getKeyPairUsages,
  importDerKey,
  importJwkKey,
  importRawPublic,
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

const kSignVerifyUsages = createKeyUsages(["verify"], ["sign"]);
const kDeriveUsages = createKeyUsages([], ["deriveKey", "deriveBits"]);

function isMontgomery(name: string): boolean {
  return name === "X25519" || name === "X448";
}

function usagesFor(name: string) {
  return isMontgomery(name) ? kDeriveUsages : kSignVerifyUsages;
}

/** Node's `cfrgGenerateKey`. */
export function cfrgGenerateKey(algorithm: NormalizedAlgorithm, extractable: boolean, usages: string[]): Job<CryptoKeyPair> {
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

/** Node's `cfrgExportKey`: raw, SPKI and PKCS#8. */
export function cfrgExportKey(key: CryptoKey, format: "raw" | "spki" | "pkcs8"): ArrayBuffer {
  try {
    const native = getCryptoKeyHandle(key).native;
    switch (format) {
      case "raw": {
        const bytes = nts_crypto_key_export_raw(native, getCryptoKeyType(key) === "private", false);
        if (bytes === null) throw new Error("Failed to get raw key");
        return arrayBufferOf(bytes);
      }
      case "spki":
        return writeDerKey(native, true).slice().buffer;
      default:
        return writeDerKey(native, false).slice().buffer;
    }
  } catch (error) {
    throw domExceptionWithCause("The operation failed for an operation-specific reason", "OperationError", error);
  }
}

/** Node's `cfrgImportKey`. */
export function cfrgImportKey(
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
    case "pkcs8":
      verifyAcceptableKeyUse(name, usageSet, allowed.private);
      native = importDerKey(keyData as Uint8Array, false);
      isPublic = false;
      break;
    case "jwk": {
      const jwk = keyData as JsonWebKey;
      validateJwk(jwk, "OKP", extractable, usageSet, isMontgomery(name) ? "enc" : "sig");
      if (jwk.crv !== name) throw domException('JWK "crv" Parameter and algorithm name mismatch', "DataError");
      if (jwk.alg !== undefined && !isMontgomery(name) && jwk.alg !== name && jwk.alg !== "EdDSA") {
        throw domException('JWK "alg" does not match the requested algorithm', "DataError");
      }
      isPublic = jwk.d === undefined;
      verifyAcceptableKeyUse(name, usageSet, isPublic ? allowed.public : allowed.private);
      native = importJwkKey(jwk);
      if (!isPublic) {
        // The private key's public half must be the `x` it came with.
        const derived = nts_crypto_key_export_raw(native, false, false);
        const given = bytesOfBase64(jwk.x!);
        if (derived === null || !sameBytes(derived, given)) throw domException("Invalid keyData", "DataError");
      }
      break;
    }
    case "raw":
      verifyAcceptableKeyUse(name, usageSet, allowed.public);
      native = importRawPublic(name, undefined, keyData as Uint8Array);
      isPublic = true;
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

/** Node's `eddsaSignVerify`: Ed448 with its context, Ed25519 without. */
export function eddsaSignVerify(
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
  const context = algorithm.name === "Ed448" ? (algorithm.context ?? noBytes) : noBytes;
  // `SignTraits::AdditionalConfig`, which throws inside `jobPromise`.
  const checkContext = (): void => {
    if (context.byteLength > 255) throw new ERR_OUT_OF_RANGE_BINDING("context string must be at most 255 bytes");
  };
  if (signature === undefined) {
    return jobPromise(() => {
      checkContext();
      return bytesJob("Deriving bits failed", (done) =>
        nts_crypto_sign_job(false, native, input, -1, NaN, NaN, context, noBytes, done),
      );
    });
  }
  const expected = bytesOfSource(signature);
  return jobPromise(() => {
    checkContext();
    return nativeJob<boolean>("Deriving bits failed", (succeed, fail) =>
      nts_crypto_sign_job(true, native, input, -1, NaN, NaN, context, expected, (ok, answer) =>
        ok ? succeed(answer[0] === 1) : fail(),
      ),
    );
  });
}

/**
 * Node's `ecdhDeriveBits`, for ECDH, X25519 and X448: the whole shared
 * secret, or its first `length` bits, the rest of the last byte cleared.
 */
export function ecdhDeriveBits(algorithm: NormalizedAlgorithm, baseKey: CryptoKey, length: number | null | undefined): Job<ArrayBuffer> {
  const publicKey = algorithm.public!;
  if (getCryptoKeyType(baseKey) !== "private") throw domException("baseKey must be a private key", "InvalidAccessError");
  const keyAlgorithm = getCryptoKeyAlgorithm(publicKey);
  const baseKeyAlgorithm = getCryptoKeyAlgorithm(baseKey);
  if (keyAlgorithm.name !== baseKeyAlgorithm.name) {
    throw domException("The public and private keys must be of the same type", "InvalidAccessError");
  }
  if (keyAlgorithm.name === "ECDH" && keyAlgorithm.namedCurve !== baseKeyAlgorithm.namedCurve) {
    throw domException("Named curve mismatch", "InvalidAccessError");
  }
  const privateNative = getCryptoKeyHandle(baseKey).native;
  const publicNative = getCryptoKeyHandle(publicKey).native;
  const bits = jobPromise(() =>
    bytesJob("Deriving bits failed", (done) => nts_crypto_dh_stateless_job(privateNative, publicNative, done)),
  );
  if (length === null || length === undefined) return bits;
  return mapJob(bits, (secret) => {
    const sliceLength = numBitsToBytes(length);
    if (secret.byteLength < sliceLength) throw domException("derived bit length is too small", "OperationError");
    if (length % 8 === 0) return secret.byteLength === sliceLength ? secret : secret.slice(0, sliceLength);
    return arrayBufferOf(truncateToBitLength(length, secret));
  });
}
