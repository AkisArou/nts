// What Web Crypto's algorithms share, from node v24.20.0
// `lib/internal/crypto/webcrypto_util.js`: usage checks, JWK checks, and
// importing key material into handles.

import { domException, domExceptionWithCause } from "../../../internal/dom-exception.ts";
import { asymmetricHandle, importJwk, importRawPublicKey, importRawSeedKey, KeyObjectHandle, type KeyObjectType, parseDerKey } from "../keys.ts";
import { bytesOfBase64 } from "../util.ts";
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

/**
 * Node's `KeyObjectHandle` import format: key material already held, as
 * `KeyObject#toCryptoKey` and `getPublicKey` hand it over, with the type node's
 * handle carries in itself.
 */
export interface TypedHandle {
  handle: KeyObjectHandle;
  type: KeyObjectType;
}

/** What a family's import takes: bytes, a JWK, or a held key. */
export type KeyData = Uint8Array | JsonWebKey | TypedHandle;

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
  return new KeyObjectHandle(new Uint8Array(keyData), 0);
}

/**
 * Node's `importJwkSecretKey`: `k` decoded as `ByteSource::FromEncodedString`
 * decodes it, either base64 alphabet.
 */
export function importJwkSecretKey(keyData: JsonWebKey): KeyObjectHandle {
  if (typeof keyData.k !== "string") {
    throw domExceptionWithCause("Invalid keyData", "DataError", new TypeError("Invalid JWK secret key format"));
  }
  return new KeyObjectHandle(bytesOfBase64(keyData.k), 0);
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

/**
 * Node's `importGenericSecretKey` (`keys.js`), for the derivation keys --
 * HKDF, PBKDF2, Argon2: raw bytes only, and never extractable.
 */
export function importGenericSecretKey(
  algorithm: { name: string },
  format: string,
  keyData: KeyData,
  extractable: boolean,
  usages: readonly string[],
): CryptoKey | undefined {
  const usageSet = new Set(usages);
  const { name } = algorithm;
  if (extractable) throw domException(`${name} keys are not extractable`, "SyntaxError");
  for (const usage of usageSet) {
    if (usage !== "deriveKey" && usage !== "deriveBits") {
      throw domException(`Unsupported key usage for a ${name} key`, "SyntaxError");
    }
  }
  let handle: KeyObjectHandle;
  switch (format) {
    case "KeyObjectHandle":
      handle = (keyData as TypedHandle).handle;
      break;
    case "raw-secret":
    case "raw":
      handle = importSecretKey(keyData as Uint8Array);
      break;
    default:
      return undefined;
  }
  return createCryptoKey("secret", handle, { name }, usageSet, false);
}

/** The usages a key pair's family allows: its public key's, its private key's, and both, for generation. */
export interface KeyUsageLists {
  public: readonly string[];
  private: readonly string[];
  keygen: readonly string[];
}

/** Node's `createKeyUsages`. */
export function createKeyUsages(publicUsages: readonly string[], privateUsages: readonly string[]): KeyUsageLists {
  return { public: publicUsages, private: privateUsages, keygen: [...publicUsages, ...privateUsages] };
}

/** Node's `getKeyPairUsages`: the usages asked for, split between the pair in their allowed order. */
export function getKeyPairUsages(usages: Set<string>, allowed: KeyUsageLists): { public: Set<string>; private: Set<string> } {
  const union = (list: readonly string[]): Set<string> => {
    const set = new Set<string>();
    for (const usage of list) if (usages.has(usage)) set.add(usage);
    return set;
  };
  return { public: union(allowed.public), private: union(allowed.private) };
}

/** Node's `importDerKey`: SPKI or PKCS#8, a parse failure a `DataError` caused by it. */
export function importDerKey(keyData: Uint8Array, isPublic: boolean): number {
  try {
    return parseDerKey(keyData, isPublic);
  } catch (error) {
    throw domExceptionWithCause("Invalid keyData", "DataError", error);
  }
}

/** Node's `importJwkKey`. */
export function importJwkKey(keyData: JsonWebKey): number {
  try {
    return importJwk(keyData).native;
  } catch (error) {
    throw domExceptionWithCause("Invalid keyData", "DataError", error);
  }
}

/** A generated pair, as node's key pair jobs deliver it. */
export interface CryptoKeyPair {
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}

/**
 * Node's key pair jobs in their Web Crypto mode (`EncodeWebCryptoKey`): one
 * key behind two handles, the public one always extractable. `job` is a
 * `keygen.c` job, configured; the queue takes it.
 */
export function keyPairJob(
  job: number,
  algorithm: KeyAlgorithm,
  publicUsages: Set<string>,
  privateUsages: Set<string>,
  extractable: boolean,
): Job<CryptoKeyPair> {
  return nativeJob<CryptoKeyPair>("Key generation job failed", (succeed, fail) =>
    nts_crypto_keygen_queue(job, (ok, key) => {
      if (!ok) {
        fail();
        return;
      }
      succeed({
        publicKey: createCryptoKey("public", asymmetricHandle(key), algorithm, publicUsages, true),
        privateKey: createCryptoKey("private", asymmetricHandle(key), algorithm, privateUsages, extractable),
      });
    }),
  );
}

/** Node's `importRawKey` for a public key: a raw import failure a `DataError` caused by it. */
export function importRawPublic(keyType: string, namedCurve: string | undefined, keyData: Uint8Array): number {
  try {
    return importRawPublicKey(keyType, namedCurve, keyData);
  } catch (error) {
    throw domExceptionWithCause("Invalid keyData", "DataError", error);
  }
}

/** Node's `importRawKey` for a post-quantum key's seed. */
export function importRawSeed(keyType: string, keyData: Uint8Array): number {
  try {
    return importRawSeedKey(keyType, keyData);
  } catch (error) {
    throw domExceptionWithCause("Invalid keyData", "DataError", error);
  }
}
