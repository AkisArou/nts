// Web Crypto's elliptic curves -- ECDSA and ECDH over P-256, P-384 and P-521
// -- from node v24.20.0 `lib/internal/crypto/ec.js`: key pairs through
// node's `EcKeyPairGenJob` (here `keygen.c`), raw, SPKI, PKCS#8 and JWK
// import and export, and ECDSA through its `SignJob` with IEEE P1363
// signatures (`sig.c`).

import { domException, domExceptionWithCause } from "../../../internal/dom-exception.ts";
import { asymmetricHandle, asymmetricKeyTypeOfNative, keyDetailsOf, writeDerKey } from "../keys.ts";
import { toDer, toP1363 } from "../sig.ts";
import { digestId } from "../util.ts";
import { createCryptoKey, type CryptoKey, getCryptoKeyAlgorithm, getCryptoKeyHandle, getCryptoKeyType } from "./key.ts";
import {
  bytesJob,
  bytesOfSource,
  type Job,
  jobPromise,
  mapJob,
  nativeJob,
  type NormalizedAlgorithm,
  webCryptoHashName,
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
import { namedCurveAlias } from "./webidl.ts";
import { jobError } from "../util.ts";

type BufferSource = ArrayBuffer | ArrayBufferView;

const kSignVerifyUsages = createKeyUsages(["verify"], ["sign"]);
const kDeriveUsages = createKeyUsages([], ["deriveKey", "deriveBits"]);

function usagesFor(name: string) {
  return name === "ECDH" ? kDeriveUsages : kSignVerifyUsages;
}

/** Each curve's SPKI length with an uncompressed point, which Web Crypto requires. */
function uncompressedSpkiLength(namedCurve: string | undefined): number | undefined {
  switch (namedCurve) {
    case "P-256":
      return 91;
    case "P-384":
      return 120;
    case "P-521":
      return 158;
    default:
      return undefined;
  }
}

/** Node's `ecGenerateKey`. */
export function ecGenerateKey(algorithm: NormalizedAlgorithm, extractable: boolean, usages: string[]): Job<CryptoKeyPair> {
  const { name } = algorithm;
  const namedCurve = algorithm.namedCurve!;
  const allowed = usagesFor(name);
  const usageSet = validateKeyUsages(usages, allowed.keygen, name);
  const keyUsages = getKeyPairUsages(usageSet, allowed);
  validateUsagesNotEmpty(keyUsages.private);
  return jobPromise(() => {
    const job = nts_crypto_keygen_ec(namedCurve, false);
    if (job === 0) throw jobError("Key generation job failed");
    return keyPairJob(job, { name, namedCurve }, keyUsages.public, keyUsages.private, extractable);
  });
}

/** Node's `ecExportKey`: raw (an uncompressed point), SPKI and PKCS#8. */
export function ecExportKey(key: CryptoKey, format: "raw" | "spki" | "pkcs8"): ArrayBuffer {
  try {
    const native = getCryptoKeyHandle(key).native;
    switch (format) {
      case "raw":
        return uncompressedPoint(native).buffer;
      case "spki": {
        let spki = writeDerKey(native, true);
        // Web Crypto's SPKI has an uncompressed point; a key imported with a
        // compressed one is written again from its point.
        const { namedCurve } = getCryptoKeyAlgorithm(key);
        if (spki.byteLength !== uncompressedSpkiLength(namedCurve)) {
          const point = uncompressedPoint(native);
          spki = writeDerKey(importRawPublic("ec", namedCurve, point), true);
        }
        return spki.slice().buffer;
      }
      default:
        return writeDerKey(native, false).slice().buffer;
    }
  } catch (error) {
    throw domExceptionWithCause("The operation failed for an operation-specific reason", "OperationError", error);
  }
}

/** Node's `exportECPublicRaw` with an uncompressed point. */
function uncompressedPoint(native: number): Uint8Array<ArrayBuffer> {
  const point = nts_crypto_key_export_raw(native, false, false);
  if (point === null) throw new Error("Failed to get public key");
  return point.slice();
}

/** Node's `ecImportKey`. */
export function ecImportKey(
  format: string,
  keyData: KeyData,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: string[],
): CryptoKey | undefined {
  const { name } = algorithm;
  const namedCurve = algorithm.namedCurve!;
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
      validateJwk(jwk, "EC", extractable, usageSet, name === "ECDH" ? "enc" : "sig");
      if (jwk.crv !== namedCurve) throw domException('JWK "crv" does not match the requested algorithm', "DataError");
      if (name === "ECDSA" && jwk.alg !== undefined) {
        const curve = jwk.alg === "ES256" ? "P-256" : jwk.alg === "ES384" ? "P-384" : jwk.alg === "ES512" ? "P-521" : undefined;
        if (curve !== namedCurve) throw domException('JWK "alg" does not match the requested algorithm', "DataError");
      }
      isPublic = jwk.d === undefined;
      verifyAcceptableKeyUse(name, usageSet, isPublic ? allowed.public : allowed.private);
      native = importJwkKey(jwk);
      break;
    }
    case "raw":
      verifyAcceptableKeyUse(name, usageSet, allowed.public);
      native = importRawPublic("ec", namedCurve, keyData as Uint8Array);
      isPublic = true;
      break;
    default:
      return undefined;
  }
  if (asymmetricKeyTypeOfNative(native) !== "ec") throw domException("Invalid key type", "DataError");
  if (!nts_crypto_key_check(native, !isPublic)) throw domException("Invalid keyData", "DataError");
  if (namedCurveAlias(namedCurve) !== keyDetailsOf(native).namedCurve) {
    throw domException("Named curve mismatch", "DataError");
  }
  return createCryptoKey(isPublic ? "public" : "private", asymmetricHandle(native), { name, namedCurve }, usageSet, extractable);
}

/** Node's `ecdsaSignVerify`: an IEEE P1363 signature, or whether `signature` is one. */
export function ecdsaSignVerify(
  key: CryptoKey,
  data: BufferSource,
  algorithm: NormalizedAlgorithm,
  signature?: BufferSource,
): Job<ArrayBuffer | boolean> {
  const type = signature === undefined ? "private" : "public";
  if (getCryptoKeyType(key) !== type) throw domException(`Key must be a ${type} key`, "InvalidAccessError");
  const native = getCryptoKeyHandle(key).native;
  const digest = digestId(webCryptoHashName(algorithm.hash!.name)!);
  const input = bytesOfSource(data);
  const noBytes = new Uint8Array(0);
  if (signature === undefined) {
    const der = jobPromise(() =>
      bytesJob("Deriving bits failed", (done) =>
        nts_crypto_sign_job(false, native, input, digest, NaN, NaN, noBytes, noBytes, done),
      ),
    );
    return mapJob(der, (bytes) => (toP1363(native, new Uint8Array(bytes)) ?? noBytes).slice().buffer);
  }
  // A P1363 signature that will not convert verifies nothing, as node's
  // conversion leaves it empty.
  const expected = toDer(native, bytesOfSource(signature)) ?? noBytes;
  return jobPromise(() =>
    nativeJob<boolean>("Deriving bits failed", (succeed, fail) =>
      nts_crypto_sign_job(true, native, input, digest, NaN, NaN, noBytes, expected, (ok, answer) =>
        ok ? succeed(answer[0] === 1) : fail(),
      ),
    ),
  );
}
