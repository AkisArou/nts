import { DOMException } from "../core/errors.ts";
import type { CryptoArgon2Parameters, CryptoHkdfParameters, CryptoPbkdf2Parameters, CryptoProvider } from "../provider/crypto.ts";
import { Argon2Params, HkdfParams, Pbkdf2Params } from "./algorithms.ts";
import type { NormalizedAlgorithm } from "./algorithms.ts";
import { createCryptoKey, KeyAlgorithm } from "./crypto-key.ts";
import type { CryptoKey, CryptoKeySlots, KeyUsage } from "./crypto-key.ts";
import { JsonWebKey, normalizeKeyUsages } from "./jwk.ts";
import type { KeyFormat } from "./jwk.ts";

const ByteArray = Uint8Array;

function operationError(): DOMException {
  return new DOMException("The key derivation operation failed", "OperationError");
}

/**
 * Web Cryptography §§33.4.2 and 34.4.2 and Modern Algorithms §17.4.2.
 * KDF material is raw, nonextractable
 * secret bytes; unlike HMAC it may be empty and has no visible length or hash.
 * https://w3c.github.io/webcrypto/#hkdf-operations-import-key
 * https://w3c.github.io/webcrypto/#pbkdf2-operations-import-key
 * https://wicg.github.io/webcrypto-modern-algos/#argon2-operations-import-key
 */
export function importKdfKey(
  provider: CryptoProvider,
  format: KeyFormat,
  data: Uint8Array | JsonWebKey,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: readonly KeyUsage[],
): CryptoKey {
  const argon2 = algorithm.name === "Argon2d" || algorithm.name === "Argon2i" || algorithm.name === "Argon2id";
  // Modern Algorithms §17.4.2 has no legacy raw alias for Argon2 material.
  if (format !== "raw-secret" && (format !== "raw" || argon2)) {
    throw new DOMException("The key format is not supported for this KDF", "NotSupportedError");
  }
  for (let index = 0; index < usages.length; index++) {
    if (usages[index] !== "deriveKey" && usages[index] !== "deriveBits") {
      throw new DOMException("A KDF key can only derive keys or bits", "SyntaxError");
    }
  }
  if (extractable) throw new DOMException("A KDF key cannot be extractable", "SyntaxError");
  if (data instanceof JsonWebKey) throw new DOMException("Expected raw key bytes", "DataError");
  const bitLength = data.byteLength * 8;
  const record = provider.importKey({ format: "raw", family: "secret", bytes: data });
  if ("failure" in record) {
    throw new DOMException("The KDF key could not be imported", record.failure === "invalid-key" ? "DataError" : "OperationError");
  }
  if (record.info.family !== "secret" || record.info.type !== "secret" || record.info.length !== bitLength) {
    throw new DOMException("The primitive returned inconsistent secret-key metadata", "OperationError");
  }
  // The common import/unwrap steps reject empty secret-key usages only after the
  // algorithm has produced the key; native failures retain their precedence.
  if (usages.length === 0) throw new DOMException("A secret key must have at least one usage", "SyntaxError");
  return createCryptoKey("secret", false, new KeyAlgorithm(algorithm.name), normalizeKeyUsages(usages), record.handle);
}

/** §§33.4.3, 34.4.3 and Modern Algorithms §17.4.3 request all key bits. */
export function getKdfKeyLength(): null {
  return null;
}

/**
 * Web Cryptography §§33.4.1 and 34.4.1 and Modern Algorithms §17.4.1.
 * Hashing, extraction, expansion, password iterations and memory-hard work
 * stay inside one synchronous native derivation call.
 * https://w3c.github.io/webcrypto/#hkdf-operations-derive-bits
 * https://w3c.github.io/webcrypto/#pbkdf2-operations-derive-bits
 * https://wicg.github.io/webcrypto-modern-algos/#argon2-operations-derive-bits
 */
export function deriveKdfBits(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots,
  length: number | null,
): Uint8Array {
  if (length === null || length % 8 !== 0) throw operationError();
  const byteLength = length / 8;
  let parameters: CryptoHkdfParameters | CryptoPbkdf2Parameters | CryptoArgon2Parameters;
  if (algorithm instanceof HkdfParams) {
    const hash = algorithm.hash.name;
    const hashLength = hash === "SHA-1" ? 160 : hash === "SHA-256" || hash === "SHA3-256" ? 256 : hash === "SHA-384" || hash === "SHA3-384" ? 384 : 512;
    if (length > 255 * hashLength) throw operationError();
    parameters = { name: "HKDF", hash, salt: algorithm.salt, info: algorithm.info, byteLength };
  } else if (algorithm instanceof Pbkdf2Params) {
    if (algorithm.iterations === 0) throw operationError();
    // PBKDF2 explicitly returns here; HKDF still performs its native operation
    // for zero length, so a native failure there remains observable.
    if (length === 0) return new ByteArray(0);
    parameters = { name: "PBKDF2", hash: algorithm.hash.name, salt: algorithm.salt, iterations: algorithm.iterations, byteLength };
  } else if (algorithm instanceof Argon2Params) {
    // Modern Algorithms §17.4.1. The nonce's RFC 9106 constraints and all
    // cryptographic work remain in the single native operation below.
    if (length < 32) throw operationError();
    if (algorithm.version !== undefined && algorithm.version !== 0x13) throw operationError();
    if (algorithm.parallelism === 0 || algorithm.parallelism > 0xff_ffff) throw operationError();
    if (algorithm.memory < 8 * algorithm.parallelism) throw operationError();
    if (algorithm.passes === 0) throw operationError();
    parameters = {
      name: algorithm.name,
      nonce: algorithm.nonce,
      parallelism: algorithm.parallelism,
      memory: algorithm.memory,
      passes: algorithm.passes,
      version: 0x13,
      secretValue: algorithm.secretValue,
      associatedData: algorithm.associatedData,
      byteLength,
    };
  } else {
    throw new DOMException("This algorithm cannot derive KDF bits", "NotSupportedError");
  }
  const result = provider.derive(parameters, key.handle);
  if ("failure" in result || result.byteLength !== byteLength) throw operationError();
  return result;
}
