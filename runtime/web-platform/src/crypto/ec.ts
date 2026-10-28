import { DOMException } from "../core/errors.ts";
import type { CryptoProvider } from "../provider/crypto.ts";
import type { EcdhKeyDeriveParams, EcdsaParams, NormalizedAlgorithm } from "./algorithms.ts";
import { cryptoByteSubarray } from "./buffer-source.ts";
import { getCryptoKeySlots } from "./crypto-key.ts";
import type { CryptoKeySlots } from "./crypto-key.ts";
import { truncateDerivationBits } from "./derive-bits.ts";
import { ecCurveByteLength } from "./ec-curve.ts";
import type { EcKeyAlgorithm } from "./ec-key.ts";

const ByteArray = Uint8Array;

function operationError(): DOMException {
  return new DOMException("The elliptic-curve operation failed", "OperationError");
}

function requireKeyType(key: CryptoKeySlots, type: "public" | "private"): void {
  if (key.type !== type) throw new DOMException("The operation requires a " + type + " key", "InvalidAccessError");
}

/**
 * Web Cryptography §23.7.1: hashing and ECDSA are one native operation. Shared
 * code encodes the native integers as fixed-width r || s, never ASN.1 DER.
 * https://w3c.github.io/webcrypto/#ecdsa-operations-sign
 */
export function signEc(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots,
  bytes: Uint8Array,
): Uint8Array {
  requireKeyType(key, "private");
  const width = ecCurveByteLength((key.algorithm as EcKeyAlgorithm).namedCurve);
  const signature = provider.sign({ name: "ECDSA", hash: (algorithm as EcdsaParams).hash.name }, key.handle, bytes);
  if ("failure" in signature || signature.kind !== "ecdsa") throw operationError();
  const rLength = signature.r.byteLength;
  const sLength = signature.s.byteLength;
  if (rLength === 0 || rLength > width || sLength === 0 || sLength > width) throw operationError();
  const result = new ByteArray(width * 2);
  for (let index = 0; index < rLength; index++) result[width - rLength + index] = signature.r[index]!;
  for (let index = 0; index < sLength; index++) result[width * 2 - sLength + index] = signature.s[index]!;
  return result;
}

/** §23.7.2: incorrect encoding width is false; native verification checks r/s. */
export function verifyEc(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots,
  signature: Uint8Array,
  bytes: Uint8Array,
): boolean {
  requireKeyType(key, "public");
  const width = ecCurveByteLength((key.algorithm as EcKeyAlgorithm).namedCurve);
  if (signature.byteLength !== width * 2) return false;
  return provider.verify(
    { name: "ECDSA", hash: (algorithm as EcdsaParams).hash.name },
    key.handle,
    { kind: "ecdsa", r: cryptoByteSubarray(signature, 0, width), s: cryptoByteSubarray(signature, width, width * 2) },
    bytes,
  );
}

/**
 * Web Cryptography §24.4.2. Maximum output length is the peer curve's field
 * element octet encoding (528 bits for P-521), checked before the base key type.
 * A single native ECDH operation returns the complete secret; truncation keeps
 * the requested leading bits and clears the unused low bits of the last octet.
 * https://w3c.github.io/webcrypto/#ecdh-operations-derive-bits
 */
export function deriveEcBits(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  key: CryptoKeySlots,
  length: number | null,
): Uint8Array {
  const publicKey = getCryptoKeySlots((algorithm as EcdhKeyDeriveParams).public);
  requireKeyType(publicKey, "public");
  if (publicKey.algorithm.name !== algorithm.name) {
    throw new DOMException("The peer key algorithm does not match ECDH", "InvalidAccessError");
  }
  const publicAlgorithm = publicKey.algorithm as EcKeyAlgorithm;
  const width = ecCurveByteLength(publicAlgorithm.namedCurve);
  if (length !== null && length > width * 8) throw operationError();
  requireKeyType(key, "private");
  if (publicKey.algorithm.name !== key.algorithm.name || publicAlgorithm.namedCurve !== (key.algorithm as EcKeyAlgorithm).namedCurve) {
    throw new DOMException("The ECDH keys must use the same algorithm and curve", "InvalidAccessError");
  }
  const secret = provider.derive({ name: "ECDH", publicKey: publicKey.handle }, key.handle);
  if ("failure" in secret || secret.byteLength !== width) throw operationError();
  return truncateDerivationBits(secret, length);
}
