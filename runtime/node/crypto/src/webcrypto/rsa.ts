// Web Crypto's RSA -- RSASSA-PKCS1-v1_5, RSA-PSS and RSA-OAEP -- from node
// v24.20.0 `lib/internal/crypto/rsa.js`: key pairs through node's
// `RsaKeyPairGenJob` (here `keygen.c`), SPKI, PKCS#8 and JWK import and
// export, signatures through its `SignJob` (`sig.c`), and OAEP through its
// `RSACipherJob` (`rsa.c`).

import { domException, domExceptionWithCause } from "../../../internal/dom-exception.ts";
import { validateInt32 } from "../../../internal/validators.ts";
import { asymmetricHandle, asymmetricKeyTypeOfNative, keyDetailsOf, writeDerKey } from "../keys.ts";
import { digestId, jobError } from "../util.ts";
import {
  createCryptoKey,
  type CryptoKey,
  getCryptoKeyAlgorithm,
  getCryptoKeyHandle,
  getCryptoKeyType,
  type KeyAlgorithm,
} from "./key.ts";
import {
  bigIntArrayToUnsignedInt,
  bytesJob,
  bytesOfSource,
  getDigestSizeInBytes,
  type Job,
  jobPromise,
  nativeJob,
  type NormalizedAlgorithm,
  validateMaxBufferLength,
  webCryptoHashName,
} from "./util.ts";
import {
  createKeyUsages,
  type CryptoKeyPair,
  getKeyPairUsages,
  importDerKey,
  importJwkKey,
  type JsonWebKey,
  type KeyData,
  keyPairJob,
  type KeyUsageLists,
  type TypedHandle,
  validateJwk,
  validateKeyUsages,
  validateUsagesNotEmpty,
  verifyAcceptableKeyUse,
} from "./webcrypto-util.ts";

type BufferSource = ArrayBuffer | ArrayBufferView;

const kOaepUsages = createKeyUsages(["encrypt", "wrapKey"], ["decrypt", "unwrapKey"]);
const kSignVerifyUsages = createKeyUsages(["verify"], ["sign"]);

function usagesFor(name: string): KeyUsageLists {
  return name === "RSA-OAEP" ? kOaepUsages : kSignVerifyUsages;
}

/** `RSA_PKCS1_PSS_PADDING`, as `sig.c` takes it; NaN is "not given". */
const kPssPadding = 6;

/** Node's `normalizeHashName` for an RSA key's JWK `alg`: `RS*`, `PS*` or `RSA-OAEP*`. */
export function rsaJwkAlgorithm(name: string, hashName: string): string | undefined {
  const bits = hashName === "SHA-1" ? "1" : hashName.startsWith("SHA-") ? hashName.slice(4) : undefined;
  if (bits === undefined) return undefined;
  switch (name) {
    case "RSASSA-PKCS1-v1_5":
      return `RS${bits}`;
    case "RSA-PSS":
      return `PS${bits}`;
    case "RSA-OAEP":
      return bits === "1" ? "RSA-OAEP" : `RSA-OAEP-${bits}`;
    default:
      return undefined;
  }
}

/** Node's `rsaKeyGenerate`. */
export function rsaKeyGenerate(algorithm: NormalizedAlgorithm, extractable: boolean, usages: string[]): Job<CryptoKeyPair> {
  const publicExponent = algorithm.publicExponent!;
  const exponent = bigIntArrayToUnsignedInt(publicExponent);
  if (exponent === undefined) {
    throw domException("The publicExponent must be equivalent to an unsigned 32-bit value", "OperationError");
  }
  const { name } = algorithm;
  const modulusLength = algorithm.modulusLength!;
  const allowed = usagesFor(name);
  const usageSet = validateKeyUsages(usages, allowed.keygen, name);
  const keyAlgorithm: KeyAlgorithm = { name, modulusLength, publicExponent, hash: { name: algorithm.hash!.name } };
  if (exponent < 3 || exponent % 2 === 0) {
    throw domException("The operation failed for an operation-specific reason", "OperationError");
  }
  const keyUsages = getKeyPairUsages(usageSet, allowed);
  validateUsagesNotEmpty(keyUsages.private);
  // Node generates every Web Crypto RSA key as rsaEncryption -- its variant
  // is always RSASSA-PKCS1-v1_5 -- whatever the algorithm will use it for.
  return jobPromise(() => {
    const job = nts_crypto_keygen_rsa(false, modulusLength, exponent, -1, -1, -1);
    if (job === 0) throw jobError("Key generation job failed");
    return keyPairJob(job, keyAlgorithm, keyUsages.public, keyUsages.private, extractable);
  });
}

/** Node's `rsaExportKey`: SPKI or PKCS#8, a failure an `OperationError` caused by it. */
export function rsaExportKey(key: CryptoKey, format: "spki" | "pkcs8"): ArrayBuffer {
  try {
    return writeDerKey(getCryptoKeyHandle(key).native, format === "spki").slice().buffer;
  } catch (error) {
    throw domExceptionWithCause("The operation failed for an operation-specific reason", "OperationError", error);
  }
}

/** Node's `rsaImportKey`. */
export function rsaImportKey(
  format: string,
  keyData: KeyData,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: string[],
): CryptoKey | undefined {
  const allowed = usagesFor(algorithm.name);
  const usageSet = new Set(usages);
  let native: number;
  let isPublic: boolean;
  switch (format) {
    case "KeyObjectHandle": {
      const { handle, type } = keyData as TypedHandle;
      isPublic = type === "public";
      verifyAcceptableKeyUse(algorithm.name, usageSet, isPublic ? allowed.public : allowed.private);
      native = handle.native;
      break;
    }
    case "spki":
      verifyAcceptableKeyUse(algorithm.name, usageSet, allowed.public);
      native = importDerKey(keyData as Uint8Array, true);
      isPublic = true;
      break;
    case "pkcs8":
      verifyAcceptableKeyUse(algorithm.name, usageSet, allowed.private);
      native = importDerKey(keyData as Uint8Array, false);
      isPublic = false;
      break;
    case "jwk": {
      const jwk = keyData as JsonWebKey;
      validateJwk(jwk, "RSA", extractable, usageSet, algorithm.name === "RSA-OAEP" ? "enc" : "sig");
      if (jwk.alg !== undefined) {
        const expected = rsaJwkAlgorithm(algorithm.name, algorithm.hash!.name);
        if (expected && jwk.alg !== expected) {
          throw domException('JWK "alg" does not match the requested algorithm', "DataError");
        }
      }
      isPublic = jwk.d === undefined;
      verifyAcceptableKeyUse(algorithm.name, usageSet, isPublic ? allowed.public : allowed.private);
      native = importJwkKey(jwk);
      break;
    }
    default:
      return undefined;
  }
  if (asymmetricKeyTypeOfNative(native) !== "rsa") throw domException("Invalid key type", "DataError");
  const keyAlgorithm: KeyAlgorithm = {
    name: algorithm.name,
    modulusLength: keyDetailsOf(native).modulusLength,
    publicExponent: nts_crypto_key_public_exponent(native).slice(),
    hash: { name: algorithm.hash!.name },
  };
  return createCryptoKey(isPublic ? "public" : "private", asymmetricHandle(native), keyAlgorithm, usageSet, extractable);
}

/** Node's `rsaSignVerify`: a signature, or whether `signature` is one. */
export function rsaSignVerify(
  key: CryptoKey,
  data: BufferSource,
  algorithm: NormalizedAlgorithm,
  signature?: BufferSource,
): Job<ArrayBuffer | boolean> {
  const type = signature === undefined ? "private" : "public";
  if (getCryptoKeyType(key) !== type) throw domException(`Key must be a ${type} key`, "InvalidAccessError");
  const keyAlgorithm = getCryptoKeyAlgorithm(key);
  const pss = keyAlgorithm.name === "RSA-PSS";
  if (pss) {
    try {
      validateInt32(
        algorithm.saltLength,
        "algorithm.saltLength",
        0,
        Math.ceil((keyAlgorithm.modulusLength! - 1) / 8) - getDigestSizeInBytes(keyAlgorithm.hash!.name)! - 2,
      );
    } catch (error) {
      throw domExceptionWithCause("The operation failed for an operation-specific reason", "OperationError", error);
    }
  }
  const native = getCryptoKeyHandle(key).native;
  const digest = digestId(webCryptoHashName(keyAlgorithm.hash!.name)!);
  const saltLength = pss ? algorithm.saltLength! : NaN;
  const padding = pss ? kPssPadding : NaN;
  const input = bytesOfSource(data);
  const noBytes = new Uint8Array(0);
  if (signature === undefined) {
    return jobPromise(() =>
      bytesJob("Deriving bits failed", (done) =>
        nts_crypto_sign_job(false, native, input, digest, saltLength, padding, noBytes, noBytes, done),
      ),
    );
  }
  const expected = bytesOfSource(signature);
  return jobPromise(() =>
    nativeJob<boolean>("Deriving bits failed", (succeed, fail) =>
      nts_crypto_sign_job(true, native, input, digest, saltLength, padding, noBytes, expected, (ok, answer) =>
        ok ? succeed(answer[0] === 1) : fail(),
      ),
    ),
  );
}

/** Node's `rsaOaepCipher`. */
export function rsaOaepCipher(
  mode: "encrypt" | "decrypt",
  key: CryptoKey,
  data: BufferSource,
  algorithm: NormalizedAlgorithm,
): Job<ArrayBuffer> {
  if (algorithm.label !== undefined) validateMaxBufferLength(algorithm.label, "algorithm.label");
  const type = mode === "encrypt" ? "public" : "private";
  if (getCryptoKeyType(key) !== type) {
    throw domException("The requested operation is not valid for the provided key", "InvalidAccessError");
  }
  const native = getCryptoKeyHandle(key).native;
  const digest = digestId(webCryptoHashName(getCryptoKeyAlgorithm(key).hash!.name)!);
  const label = algorithm.label ?? new Uint8Array(0);
  const input = bytesOfSource(data);
  return jobPromise(() =>
    bytesJob("Cipher job failed", (done) => nts_crypto_rsa_oaep_job(mode === "encrypt", native, digest, label, input, done)),
  );
}
