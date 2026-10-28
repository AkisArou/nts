import { DOMException } from "../core/errors.ts";
import type {
  CryptoDigestName,
  CryptoProvider,
  CryptoRsaOaepParameters,
  CryptoSignatureParameters,
} from "../provider/crypto.ts";
import type { NormalizedAlgorithm, RsaOaepParams, RsaPssParams } from "./algorithms.ts";
import { cryptoViewByteLength } from "./buffer-source.ts";
import type { CryptoKeySlots } from "./crypto-key.ts";
import type { RsaHashedKeyAlgorithm } from "./rsa-key.ts";

const emptyBytes = new Uint8Array(0);

function operationError(): DOMException {
  return new DOMException("The RSA operation failed", "OperationError");
}

function requireKeyType(key: CryptoKeySlots, type: "public" | "private"): void {
  if (key.type !== type) throw new DOMException("The RSA operation requires a " + type + " key", "InvalidAccessError");
}

function signatureParameters(algorithm: NormalizedAlgorithm, key: CryptoKeySlots): CryptoSignatureParameters {
  const hash = (key.algorithm as RsaHashedKeyAlgorithm).hash.name as CryptoDigestName;
  if (algorithm.name === "RSASSA-PKCS1-v1_5") return { name: "RSASSA-PKCS1-v1_5", hash };
  return { name: "RSA-PSS", hash, saltLength: (algorithm as RsaPssParams).saltLength };
}

function cipherParameters(algorithm: NormalizedAlgorithm, key: CryptoKeySlots): CryptoRsaOaepParameters {
  return {
    name: "RSA-OAEP",
    hash: (key.algorithm as RsaHashedKeyAlgorithm).hash.name as CryptoDigestName,
    label: (algorithm as RsaOaepParams).label ?? emptyBytes,
  };
}

function oaepMaximumPlaintext(key: CryptoKeySlots): number {
  const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
  const hash = algorithm.hash.name as CryptoDigestName;
  const hashLength = hash === "SHA-1" ? 20 : hash === "SHA-256" ? 32 : hash === "SHA-384" ? 48 : 64;
  return modulusByteLength(algorithm.modulusLength) - 2 * hashLength - 2;
}

function modulusByteLength(bits: number): number {
  return (bits - bits % 8) / 8 + (bits % 8 === 0 ? 0 : 1);
}

/**
 * Web Cryptography §§20.9.1 and 21.4.1. RFC 3447's complete signature operation
 * remains one native call; padding, hashing and PSS's MGF1 use the key's hash.
 * https://w3c.github.io/webcrypto/#rsa-pss-operations-sign
 */
export function signRsa(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots,
  bytes: Uint8Array,
): Uint8Array {
  requireKeyType(key, "private");
  const signature = provider.sign(signatureParameters(algorithm, key), key.handle, bytes);
  if ("failure" in signature || signature.kind !== "bytes") throw operationError();
  return signature.bytes;
}

/** §§20.9.2 and 21.4.2: every invalid signature returns false, including bad PSS salt. */
export function verifyRsa(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots,
  signature: Uint8Array,
  bytes: Uint8Array,
): boolean {
  requireKeyType(key, "public");
  // RFC 3447 §§8.1.2 and 8.2.2 require k octets. Native PSS verification can
  // otherwise accept a shorter encoding of the same integer after zero padding.
  if (cryptoViewByteLength(signature) !== modulusByteLength((key.algorithm as RsaHashedKeyAlgorithm).modulusLength)) {
    return false;
  }
  return provider.verify(signatureParameters(algorithm, key), key.handle, { kind: "bytes", bytes: signature }, bytes);
}

/**
 * Web Cryptography §22.4.1 and RFC 3447 §7.1. Shared code checks the byte bound
 * and chooses the hash and label. OAEP encoding remains one native operation.
 */
export function encryptRsa(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots,
  bytes: Uint8Array,
): Uint8Array {
  requireKeyType(key, "public");
  if (cryptoViewByteLength(bytes) > oaepMaximumPlaintext(key)) throw operationError();
  const result = provider.encrypt(cipherParameters(algorithm, key), key.handle, bytes);
  if ("failure" in result) throw operationError();
  return result.bytes;
}

/** §22.4.2: decoding or label mismatch never yields plaintext through a failure. */
export function decryptRsa(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots,
  bytes: Uint8Array,
): Uint8Array {
  requireKeyType(key, "private");
  // Some native RSA APIs accept shorter ciphertexts by left-padding with zeros.
  // RFC 3447 §7.1.2 explicitly requires k octets, even when the integer is valid.
  const modulusLength = (key.algorithm as RsaHashedKeyAlgorithm).modulusLength;
  if (cryptoViewByteLength(bytes) !== modulusByteLength(modulusLength) || oaepMaximumPlaintext(key) < 0) {
    throw operationError();
  }
  const result = provider.decrypt(cipherParameters(algorithm, key), key.handle, { bytes, tag: null });
  if ("failure" in result) throw operationError();
  return result;
}
