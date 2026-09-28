// What Web Crypto's algorithms share, from node v24.20.0
// `lib/internal/crypto/webcrypto_util.js`: usage checks, JWK checks, and
// importing key material into handles.

import { Buffer } from "../../../buffer/src/main.ts";
import { domException, domExceptionWithCause } from "../../../internal/dom-exception.ts";
import { KeyObjectHandle } from "../keys.ts";
import { createCryptoKey, type CryptoKey, type KeyAlgorithm } from "./key.ts";
import { type Job, nativeJob, numBitsToBytes, truncateToBitLength, validateKeyOps } from "./util.ts";

/** A JSON Web Key as the `JsonWebKey` dictionary converts one: string members, and three others. */
export interface JsonWebKey {
  kty?: string;
  use?: string;
  key_ops?: string[];
  alg?: string;
  ext?: boolean;
  crv?: string;
  x?: string;
  y?: string;
  d?: string;
  n?: string;
  e?: string;
  p?: string;
  q?: string;
  dp?: string;
  dq?: string;
  qi?: string;
  oth?: { r?: string; d?: string; t?: string }[];
  k?: string;
  pub?: string;
  priv?: string;
}

/** Node's `verifyAcceptableKeyUse`. */
export function verifyAcceptableKeyUse(subject: string, usages: Set<string>, allowed: readonly string[]): void {
  for (const usage of usages) {
    if (!allowed.includes(usage)) throw domException(`Unsupported key usage for ${subject} key`, "SyntaxError");
  }
}

/** Node's `validateKeyUsages`: the usages as a set, each one allowed. */
export function validateKeyUsages(usages: readonly string[], allowed: readonly string[], subject: string): Set<string> {
  const set = new Set(usages);
  verifyAcceptableKeyUse(subject, set, allowed);
  return set;
}

/** Node's `validateUsagesNotEmpty`. */
export function validateUsagesNotEmpty(usages: Set<string>): Set<string> {
  if (usages.size === 0) throw domException("Usages cannot be empty when creating a key.", "SyntaxError");
  return usages;
}

/** Node's `validateJwk`: the members a key type needs, `use`, `key_ops` and `ext`. */
export function validateJwk(
  keyData: JsonWebKey,
  kty: string,
  extractable: boolean,
  usages: Set<string>,
  expectedUse: string,
): void {
  if (typeof keyData.kty !== "string") throw domException("Invalid keyData", "DataError");
  if (keyData.kty !== kty) throw domException('Invalid JWK "kty" Parameter', "DataError");
  const invalid = (): Error => domException("Invalid keyData", "DataError");
  switch (kty) {
    case "RSA":
      if (typeof keyData.n !== "string" || typeof keyData.e !== "string" || (keyData.d !== undefined && typeof keyData.d !== "string")) {
        throw invalid();
      }
      if (
        typeof keyData.d === "string" &&
        (typeof keyData.p !== "string" ||
          typeof keyData.q !== "string" ||
          typeof keyData.dp !== "string" ||
          typeof keyData.dq !== "string" ||
          typeof keyData.qi !== "string")
      ) {
        throw invalid();
      }
      break;
    case "EC":
      if (
        typeof keyData.crv !== "string" ||
        typeof keyData.x !== "string" ||
        typeof keyData.y !== "string" ||
        (keyData.d !== undefined && typeof keyData.d !== "string")
      ) {
        throw invalid();
      }
      break;
    case "OKP":
      if (typeof keyData.crv !== "string" || typeof keyData.x !== "string" || (keyData.d !== undefined && typeof keyData.d !== "string")) {
        throw invalid();
      }
      break;
    case "oct":
      if (typeof keyData.k !== "string") throw invalid();
      break;
    case "AKP":
      if (typeof keyData.alg !== "string" || typeof keyData.pub !== "string" || (keyData.priv !== undefined && typeof keyData.priv !== "string")) {
        throw invalid();
      }
      break;
  }
  if (usages.size > 0 && keyData.use !== undefined && keyData.use !== expectedUse) {
    throw domException('Invalid JWK "use" Parameter', "DataError");
  }
  validateKeyOps(keyData.key_ops, usages);
  if (keyData.ext !== undefined && keyData.ext === false && extractable === true) {
    throw domException('JWK "ext" Parameter and extractable mismatch', "DataError");
  }
}

/** Node's `importSecretKey`: a secret handle over a copy of the bytes. */
export function importSecretKey(keyData: Uint8Array): KeyObjectHandle {
  return new KeyObjectHandle(keyData.slice(), 0);
}

/**
 * Node's `importJwkSecretKey`: `k` decoded as `ByteSource::FromEncodedString`
 * decodes it, either base64 alphabet.
 */
export function importJwkSecretKey(keyData: JsonWebKey): KeyObjectHandle {
  if (typeof keyData.k !== "string") {
    throw domExceptionWithCause("Invalid keyData", "DataError", new TypeError("Invalid JWK secret key format"));
  }
  const bytes = Buffer.from(keyData.k, "base64");
  return new KeyObjectHandle(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), 0);
}


/**
 * Node's `SecretKeyGenJob` in its Web Crypto mode: random bytes for `bits`,
 * the unused low bits of the last byte cleared, made into a key on the loop
 * thread.
 */
export function secretKeyGen(
  bits: number,
  algorithm: KeyAlgorithm,
  usages: Set<string>,
  extractable: boolean,
): Job<CryptoKey> {
  const bytes = new Uint8Array(numBitsToBytes(bits));
  return nativeJob<CryptoKey>("Key generation job failed", (succeed, fail) =>
    nts_crypto_random_fill_job(bytes, 0, bytes.byteLength, (ok) => {
      if (!ok) {
        fail();
        return;
      }
      const material = bits % 8 === 0 ? bytes : truncateToBitLength(bits, bytes);
      succeed(createCryptoKey("secret", new KeyObjectHandle(material, 0), algorithm, usages, extractable));
    }),
  );
}
