import { DOMException } from "../core/errors.ts";
import type { CryptoHkdfParameters, CryptoPbkdf2Parameters, CryptoProvider } from "../provider/crypto.ts";
import { HkdfParams, Pbkdf2Params } from "./algorithms.ts";
import type { NormalizedAlgorithm } from "./algorithms.ts";
import { createCryptoKey, KeyAlgorithm } from "./crypto-key.ts";
import type { CryptoKey, CryptoKeySlots, KeyUsage } from "./crypto-key.ts";
import { JsonWebKey, normalizeKeyUsages } from "./jwk.ts";
import type { KeyFormat } from "./jwk.ts";


function operationError(): DOMException {
  return new DOMException("The key derivation operation failed", "OperationError");
}

/**
 * Web Cryptography §§33.4.2 and 34.4.2. KDF material is raw, nonextractable
 * secret bytes; unlike HMAC it may be empty and has no visible length or hash.
 * https://w3c.github.io/webcrypto/#hkdf-operations-import-key
 * https://w3c.github.io/webcrypto/#pbkdf2-operations-import-key
 */
export function importKdfKey(
  provider: CryptoProvider,
  format: KeyFormat,
  data: Uint8Array | JsonWebKey,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: readonly KeyUsage[],
): CryptoKey {
  if (format !== "raw") throw new DOMException("KDF keys require the raw format", "NotSupportedError");
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

/** §§33.4.3 and 34.4.3. A KDF used as deriveKey's target requests all key bits. */
export function getKdfKeyLength(): null {
  return null;
}

/**
 * Web Cryptography §§33.4.1 and 34.4.1. Hashing, extraction, expansion and
 * password iterations stay inside one synchronous native derivation call.
 * https://w3c.github.io/webcrypto/#hkdf-operations-derive-bits
 * https://w3c.github.io/webcrypto/#pbkdf2-operations-derive-bits
 */
export function deriveKdfBits(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots,
  length: number | null,
): Uint8Array {
  if (length === null || length % 8 !== 0) throw operationError();
  const byteLength = length / 8;
  let parameters: CryptoHkdfParameters | CryptoPbkdf2Parameters;
  if (algorithm instanceof HkdfParams) {
    const hash = algorithm.hash.name;
    const hashLength = hash === "SHA-1" ? 160 : hash === "SHA-256" ? 256 : hash === "SHA-384" ? 384 : 512;
    if (length > 255 * hashLength) throw operationError();
    parameters = { name: "HKDF", hash, salt: algorithm.salt, info: algorithm.info, byteLength };
  } else if (algorithm instanceof Pbkdf2Params) {
    if (algorithm.iterations === 0) throw operationError();
    // PBKDF2 explicitly returns here; HKDF still performs its native operation
    // for zero length, so a native failure there remains observable.
    if (length === 0) return new Uint8Array(0);
    parameters = { name: "PBKDF2", hash: algorithm.hash.name, salt: algorithm.salt, iterations: algorithm.iterations, byteLength };
  } else {
    throw new DOMException("This algorithm cannot derive KDF bits", "NotSupportedError");
  }
  const result = provider.derive(parameters, key.handle);
  if ("failure" in result || result.byteLength !== byteLength) throw operationError();
  return result;
}
