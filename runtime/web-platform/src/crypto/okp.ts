import { DOMException } from "../core/errors.ts";
import type { CryptoEd25519Parameters, CryptoEd448Parameters, CryptoProvider } from "../provider/crypto.ts";
import type { EcdhKeyDeriveParams, Ed448Params, NormalizedAlgorithm } from "./algorithms.ts";
import { getCryptoKeySlots } from "./crypto-key.ts";
import type { CryptoKeySlots } from "./crypto-key.ts";
import { truncateDerivationBits } from "./derive-bits.ts";
import { okpCurveByteLength } from "./okp-curve.ts";

const emptyBytes = new Uint8Array(0);

function operationError(): DOMException {
  return new DOMException("The curve operation failed", "OperationError");
}

function requireKeyType(key: CryptoKeySlots, type: "public" | "private"): void {
  if (key.type !== type) throw new DOMException("The operation requires a " + type + " key", "InvalidAccessError");
}

function signatureParameters(algorithm: NormalizedAlgorithm): CryptoEd25519Parameters | CryptoEd448Parameters {
  if (algorithm.name !== "Ed448") return { name: "Ed25519" };
  const context = (algorithm as Ed448Params).context ?? emptyBytes;
  if (context.byteLength > 255) throw operationError();
  return { name: "Ed448", context };
}

/**
 * Web Cryptography §25.3.1 / Secure Curves §6.4 / RFC 8032 §§5.1.6, 5.2.6.
 * Each complete Edwards signature, including hashing and context processing,
 * is one native primitive call. Context length follows the private-key check.
 * https://w3c.github.io/webcrypto/#ed25519-operations-sign
 * https://wicg.github.io/webcrypto-secure-curves/#ed448-operations
 */
export function signOkp(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots,
  bytes: Uint8Array,
): Uint8Array {
  requireKeyType(key, "private");
  const parameters = signatureParameters(algorithm);
  const signature = provider.sign(parameters, key.handle, bytes);
  if ("failure" in signature || signature.kind !== "bytes" || signature.bytes.byteLength !== 2 * okpCurveByteLength(parameters.name)) {
    throw operationError();
  }
  return signature.bytes;
}

/**
 * §25.3.2 / Secure Curves §6.4 / RFC 8032 §§5.1.7, 5.2.7. Native verification checks point decoding,
 * small-order A/R rejection and the cofactorless equation. Public imports keep
 * their encoded bytes; accepting an import does not establish point validity.
 */
export function verifyOkp(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots,
  signature: Uint8Array,
  bytes: Uint8Array,
): boolean {
  requireKeyType(key, "public");
  const parameters = signatureParameters(algorithm);
  if (signature.byteLength !== 2 * okpCurveByteLength(parameters.name)) return false;
  const result = provider.verify(parameters, key.handle, { kind: "bytes", bytes: signature }, bytes);
  if (typeof result !== "boolean") throw new DOMException("The verification operation failed", "OperationError");
  return result;
}

/**
 * §26.3.1 / Secure Curves §4.3 / RFC 7748 §§5–6. Check every secret octet before truncation,
 * including when zero bits were requested. The fixed-count OR scan has no
 * data-dependent early exit; no prefix of an all-zero result may be released.
 * https://w3c.github.io/webcrypto/#x25519-operations-derive-bits
 * https://wicg.github.io/webcrypto-secure-curves/#x448-operations
 */
export function deriveOkpBits(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots,
  length: number | null,
): Uint8Array {
  const name = algorithm.name === "X448" ? "X448" : "X25519";
  // Secure Curves checks X448's base key first and its length after agreement.
  // Level 2's X25519 instead checks peer and length before the base key.
  if (name === "X448") requireKeyType(key, "private");
  const publicKey = getCryptoKeySlots((algorithm as EcdhKeyDeriveParams).public);
  requireKeyType(publicKey, "public");
  if (name === "X25519") {
    if (publicKey.algorithm.name !== name) {
      throw new DOMException("The peer key algorithm does not match X25519", "InvalidAccessError");
    }
    if (length !== null && length > 256) throw operationError();
    requireKeyType(key, "private");
  }
  if (publicKey.algorithm.name !== key.algorithm.name) {
    throw new DOMException("The agreement keys must use the same algorithm", "InvalidAccessError");
  }
  const width = okpCurveByteLength(name);
  const secret = provider.derive({ name, publicKey: publicKey.handle }, key.handle);
  if ("failure" in secret || secret.byteLength !== width) throw operationError();
  let nonzero = 0;
  for (let index = 0; index < width; index++) nonzero |= secret[index]!;
  if (nonzero === 0) throw operationError();
  if (length !== null && length > width * 8) throw operationError();
  return truncateDerivationBits(secret, length);
}
