import { DOMException } from "../core/errors.ts";
import type { CryptoProvider } from "../provider/crypto.ts";
import type { EcdhKeyDeriveParams, NormalizedAlgorithm } from "./algorithms.ts";
import { getCryptoKeySlots } from "./crypto-key.ts";
import type { CryptoKeySlots } from "./crypto-key.ts";
import { truncateDerivationBits } from "./derive-bits.ts";

function operationError(): DOMException {
  return new DOMException("The curve25519 operation failed", "OperationError");
}

function requireKeyType(key: CryptoKeySlots, type: "public" | "private"): void {
  if (key.type !== type) throw new DOMException("The operation requires a " + type + " key", "InvalidAccessError");
}

/**
 * Web Cryptography §25.3.1 / RFC 8032 §5.1.6. The complete Ed25519 operation,
 * including its internal SHA-512 processing, is one native primitive call.
 * https://w3c.github.io/webcrypto/#ed25519-operations-sign
 */
export function signOkp(
  provider: CryptoProvider,
  _algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots,
  bytes: Uint8Array,
): Uint8Array {
  requireKeyType(key, "private");
  const signature = provider.sign({ name: "Ed25519" }, key.handle, bytes);
  if ("failure" in signature || signature.kind !== "bytes" || signature.bytes.byteLength !== 64) throw operationError();
  return signature.bytes;
}

/**
 * §25.3.2 / RFC 8032 §5.1.7. Native verification checks point decoding,
 * small-order A/R rejection and the cofactorless equation. Public imports keep
 * their encoded bytes; accepting an import does not establish point validity.
 */
export function verifyOkp(
  provider: CryptoProvider,
  _algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots,
  signature: Uint8Array,
  bytes: Uint8Array,
): boolean {
  requireKeyType(key, "public");
  if (signature.byteLength !== 64) return false;
  return provider.verify({ name: "Ed25519" }, key.handle, { kind: "bytes", bytes: signature }, bytes);
}

/**
 * §26.3.1 / RFC 7748 §§5–6.1. Check all 32 secret octets before truncation,
 * including when zero bits were requested. The fixed-count OR scan has no
 * data-dependent early exit; no prefix of an all-zero result may be released.
 * https://w3c.github.io/webcrypto/#x25519-operations-derive-bits
 */
export function deriveOkpBits(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots,
  length: number | null,
): Uint8Array {
  const publicKey = getCryptoKeySlots((algorithm as EcdhKeyDeriveParams).public);
  requireKeyType(publicKey, "public");
  if (publicKey.algorithm.name !== algorithm.name) {
    throw new DOMException("The peer key algorithm does not match X25519", "InvalidAccessError");
  }
  if (length !== null && length > 256) throw operationError();
  requireKeyType(key, "private");
  if (publicKey.algorithm.name !== key.algorithm.name) {
    throw new DOMException("The agreement keys must use the same algorithm", "InvalidAccessError");
  }
  const secret = provider.derive({ name: "X25519", publicKey: publicKey.handle }, key.handle);
  if ("failure" in secret || secret.byteLength !== 32) throw operationError();
  let nonzero = 0;
  for (let index = 0; index < 32; index++) nonzero |= secret[index]!;
  if (nonzero === 0) throw operationError();
  return truncateDerivationBits(secret, length);
}
