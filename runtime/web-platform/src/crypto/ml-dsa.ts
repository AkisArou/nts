import { DOMException } from "../core/errors.ts";
import type { CryptoMlDsaParameters, CryptoProvider } from "../provider/crypto.ts";
import { ContextParams } from "./algorithms.ts";
import type { NormalizedAlgorithm } from "./algorithms.ts";
import type { CryptoKeySlots } from "./crypto-key.ts";
import { mlSignatureLength } from "./ml-parameters.ts";

function parameters(algorithm: NormalizedAlgorithm, key: CryptoKeySlots, type: "public" | "private"): CryptoMlDsaParameters {
  if (!(algorithm instanceof ContextParams)) throw new DOMException("Expected ML-DSA parameters", "NotSupportedError");
  const context = algorithm.context ?? new Uint8Array(0);
  // Modern Algorithms §§8.4.1–2 deliberately check context before key type.
  if (context.byteLength > 255) throw new DOMException("The ML-DSA context is too long", "OperationError");
  if (key.type !== type) throw new DOMException("The ML-DSA key has the wrong type", "InvalidAccessError");
  return { name: algorithm.name, context };
}

/** Modern Algorithms §8.4.1: pure ML-DSA, one whole-message native operation. */
export function signMlDsa(provider: CryptoProvider, algorithm: NormalizedAlgorithm, key: CryptoKeySlots, bytes: Uint8Array): Uint8Array {
  const normalized = parameters(algorithm, key, "private");
  const signature = provider.sign(normalized, key.handle, bytes);
  if ("failure" in signature || signature.kind !== "bytes" || signature.bytes.byteLength !== mlSignatureLength(normalized.name)) {
    throw new DOMException("The ML-DSA signing operation failed", "OperationError");
  }
  return signature.bytes;
}

/** Modern Algorithms §8.4.2: false is an invalid signature, failures are errors. */
export function verifyMlDsa(provider: CryptoProvider, algorithm: NormalizedAlgorithm, key: CryptoKeySlots,
  signature: Uint8Array, bytes: Uint8Array): boolean {
  const normalized = parameters(algorithm, key, "public");
  const result = provider.verify(normalized, key.handle, { kind: "bytes", bytes: signature }, bytes);
  if (typeof result !== "boolean") throw new DOMException("The ML-DSA verification operation failed", "OperationError");
  return result;
}
