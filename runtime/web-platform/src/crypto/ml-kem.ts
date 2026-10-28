import { DOMException } from "../core/errors.ts";
import type { CryptoEncapsulation, CryptoKemParameters, CryptoProvider } from "../provider/crypto.ts";
import type { NormalizedAlgorithm } from "./algorithms.ts";
import type { CryptoKey, CryptoKeySlots } from "./crypto-key.ts";
import { getMlKemSharedKeyLength, isMlKemAlgorithm, mlCiphertextLength } from "./ml-parameters.ts";

/** Modern Algorithms §4: the public result dictionaries have ordinary members. */
export interface EncapsulatedBits {
  ciphertext: ArrayBuffer;
  sharedKey: ArrayBuffer;
}

export interface EncapsulatedKey {
  ciphertext: ArrayBuffer;
  sharedKey: CryptoKey;
}

function parameters(algorithm: NormalizedAlgorithm, key: CryptoKeySlots, type: "public" | "private"): CryptoKemParameters {
  if (!isMlKemAlgorithm(algorithm.name)) throw new DOMException("Expected ML-KEM parameters", "NotSupportedError");
  if (key.type !== type) throw new DOMException("The ML-KEM key has the wrong type", "InvalidAccessError");
  return { name: algorithm.name };
}

/** Modern Algorithms §6.4.1: FIPS 203 input checks and encapsulation stay native. */
export function encapsulateMlKem(provider: CryptoProvider, algorithm: NormalizedAlgorithm, key: CryptoKeySlots): CryptoEncapsulation {
  const normalized = parameters(algorithm, key, "public");
  const result = provider.encapsulate(normalized, key.handle);
  if ("failure" in result || result.sharedKey.byteLength !== getMlKemSharedKeyLength() / 8 ||
      result.ciphertext.byteLength !== mlCiphertextLength(normalized.name)) {
    throw new DOMException("The ML-KEM encapsulation operation failed", "OperationError");
  }
  return result;
}

/** Modern Algorithms §6.4.2: native decapsulation includes implicit rejection. */
export function decapsulateMlKem(provider: CryptoProvider, algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots, ciphertext: Uint8Array): Uint8Array {
  const normalized = parameters(algorithm, key, "private");
  if (ciphertext.byteLength !== mlCiphertextLength(normalized.name)) {
    throw new DOMException("The ML-KEM ciphertext has the wrong width", "OperationError");
  }
  const result = provider.decapsulate(normalized, key.handle, ciphertext);
  if ("failure" in result || result.byteLength !== getMlKemSharedKeyLength() / 8) {
    throw new DOMException("The ML-KEM decapsulation operation failed", "OperationError");
  }
  return result;
}
