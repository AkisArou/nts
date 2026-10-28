import { DOMException } from "../core/errors.ts";
import type { CryptoKeyRecord, CryptoKmacParameters, CryptoProvider } from "../provider/crypto.ts";
import type { RandomSource } from "../provider/primitives.ts";
import { KmacImportParams, KmacKeyGenParams, KmacParams } from "./algorithms.ts";
import type { KmacAlgorithmName, NormalizedAlgorithm } from "./algorithms.ts";
import { copyCryptoBytes } from "./buffer-source.ts";
import { createCryptoKey, KeyAlgorithm } from "./crypto-key.ts";
import type { CryptoKey, CryptoKeySlots, KeyAlgorithmObject, KeyUsage } from "./crypto-key.ts";
import { checkJwkPolicy, decodeBase64Url, encodeBase64Url, JsonWebKey, normalizeKeyUsages } from "./jwk.ts";
import type { KeyFormat } from "./jwk.ts";

interface KmacKeyAlgorithmObject extends KeyAlgorithmObject { length: number; }

/** Modern Algorithms §16.5. The logical key length need not fill the last octet. */
export class KmacKeyAlgorithm extends KeyAlgorithm {
  readonly length: number;

  constructor(name: KmacAlgorithmName, length: number) {
    super(name);
    this.length = length;
  }

  override copy(): KmacKeyAlgorithm {
    return new KmacKeyAlgorithm(this.name as KmacAlgorithmName, this.length);
  }

  override toObject(): KmacKeyAlgorithmObject {
    return { name: this.name, length: this.length };
  }
}

function validateUsages(usages: readonly KeyUsage[]): void {
  for (const usage of usages) {
    if (usage !== "sign" && usage !== "verify") throw new DOMException("KMAC keys only sign and verify", "SyntaxError");
  }
}

function finishKey(record: CryptoKeyRecord, name: KmacAlgorithmName, length: number, extractable: boolean, usages: readonly KeyUsage[]): CryptoKey {
  if (record.info.family !== "secret" || record.info.type !== "secret" || record.info.length !== Math.ceil(length / 8) * 8) {
    throw new DOMException("The primitive returned inconsistent KMAC key metadata", "OperationError");
  }
  if (usages.length === 0) throw new DOMException("A secret key must have at least one usage", "SyntaxError");
  return createCryptoKey("secret", extractable, new KmacKeyAlgorithm(name, length), normalizeKeyUsages(usages), record.handle);
}

/** Modern Algorithms §16.7.6. Zero is permitted, unlike HMAC. */
export function getKmacKeyLength(algorithm: NormalizedAlgorithm): number {
  if (!(algorithm instanceof KmacImportParams)) throw new DOMException("Expected KMAC key-length parameters", "NotSupportedError");
  return algorithm.length ?? (algorithm.name === "KMAC128" ? 128 : 256);
}

/** Modern Algorithms §16.7.3. RandomSource generates bytes; the codec keeps low bits. */
export function generateKmacKey(provider: CryptoProvider, random: RandomSource, algorithm: NormalizedAlgorithm, extractable: boolean, usages: readonly KeyUsage[]): CryptoKey {
  if (!(algorithm instanceof KmacKeyGenParams)) throw new DOMException("Expected KMAC generation parameters", "NotSupportedError");
  validateUsages(usages);
  const length = algorithm.length ?? (algorithm.name === "KMAC128" ? 128 : 256);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(Math.ceil(length / 8));
    random.fill(bytes);
  } catch {
    throw new DOMException("KMAC key generation failed", "OperationError");
  }
  // §2.1's Keccak encoding uses the least significant bits of the final octet.
  if (length % 8 !== 0) bytes[bytes.length - 1]! &= (1 << (length % 8)) - 1;
  const record = provider.importKey({ format: "raw", family: "secret", bytes });
  if ("failure" in record) throw new DOMException("KMAC key generation failed", "OperationError");
  return finishKey(record, algorithm.name, length, extractable, usages);
}

/** Modern Algorithms §16.7.4. The legacy raw alias does not apply to new algorithms. */
export function importKmacKey(provider: CryptoProvider, format: KeyFormat, data: Uint8Array | JsonWebKey, algorithm: NormalizedAlgorithm, extractable: boolean, usages: readonly KeyUsage[]): CryptoKey {
  if (!(algorithm instanceof KmacImportParams)) throw new DOMException("Expected KMAC import parameters", "NotSupportedError");
  validateUsages(usages);
  let bytes: Uint8Array;
  if (format === "raw-secret") {
    if (data instanceof JsonWebKey) throw new DOMException("Expected KMAC key bytes", "DataError");
    bytes = data;
  } else if (format === "jwk") {
    if (!(data instanceof JsonWebKey) || data.kty !== "oct" || data.k === undefined) {
      throw new DOMException("Expected an octet JWK with a k member", "DataError");
    }
    bytes = decodeBase64Url(data.k);
    if (data.alg !== undefined && data.alg !== (algorithm.name === "KMAC128" ? "K128" : "K256")) {
      throw new DOMException("The JWK algorithm does not match the KMAC key", "DataError");
    }
    checkJwkPolicy(data, "sig", extractable, usages);
  } else {
    throw new DOMException("KMAC keys require raw-secret or JWK", "NotSupportedError");
  }
  let length = bytes.byteLength * 8;
  if (algorithm.length !== undefined) {
    if (algorithm.length > length || algorithm.length <= length - 8) {
      throw new DOMException("The KMAC length does not match its key bytes", "DataError");
    }
    length = algorithm.length;
    if (length % 8 !== 0) {
      bytes = copyCryptoBytes(bytes);
      bytes[bytes.length - 1]! &= (1 << (length % 8)) - 1;
    }
  }
  const record = provider.importKey({ format: "raw", family: "secret", bytes });
  if ("failure" in record) throw new DOMException("The KMAC key could not be imported", record.failure === "invalid-key" ? "DataError" : "OperationError");
  return finishKey(record, algorithm.name, length, extractable, usages);
}

/** Modern Algorithms §16.7.5. Exported bytes and dictionaries never alias key slots. */
export function exportKmacKey(provider: CryptoProvider, format: KeyFormat, key: CryptoKeySlots): Uint8Array | JsonWebKey {
  const bytes = provider.exportKey(key.handle, "raw");
  if ("failure" in bytes) throw new DOMException("The KMAC key cannot be exported", "OperationError");
  if (format === "raw-secret") return bytes;
  if (format !== "jwk") throw new DOMException("KMAC keys require raw-secret or JWK", "NotSupportedError");
  const jwk = new JsonWebKey();
  jwk.kty = "oct";
  jwk.k = encodeBase64Url(bytes);
  jwk.alg = key.algorithm.name === "KMAC128" ? "K128" : "K256";
  jwk.key_ops = [];
  for (const usage of key.usages) jwk.key_ops.push(usage);
  jwk.ext = key.extractable;
  return jwk;
}

function parameters(algorithm: NormalizedAlgorithm, key: CryptoKeySlots): CryptoKmacParameters {
  if (!(algorithm instanceof KmacParams) || !(key.algorithm instanceof KmacKeyAlgorithm)) {
    throw new DOMException("Expected KMAC signing parameters", "NotSupportedError");
  }
  // §16.6 explicitly permits byte-oriented implementations. Node 24.20's native
  // non-octet KMAC output truncation does not implement §2.1's Keccak encoding.
  // The output length is part of KMAC's domain separation, so rounding it changes
  // the primitive and cannot serve as a fallback.
  if (algorithm.outputLength % 8 !== 0) throw new DOMException("Non-octet KMAC output is not supported", "NotSupportedError");
  return { name: algorithm.name, keyLength: key.algorithm.length, outputLength: algorithm.outputLength,
    customization: algorithm.customization ?? new Uint8Array(0) };
}

/** Modern Algorithms §16.7.1. KMAC framing, hashing and length separation stay native. */
export function signKmac(provider: CryptoProvider, algorithm: NormalizedAlgorithm, key: CryptoKeySlots, data: Uint8Array): Uint8Array {
  const normalized = parameters(algorithm, key);
  const result = provider.sign(normalized, key.handle, data);
  if ("failure" in result || result.kind !== "bytes" || result.bytes.byteLength !== normalized.outputLength / 8) {
    throw new DOMException("The KMAC operation failed", "OperationError");
  }
  return result.bytes;
}

/** Modern Algorithms §16.7.2. A native error differs from an invalid signature. */
export function verifyKmac(provider: CryptoProvider, algorithm: NormalizedAlgorithm, key: CryptoKeySlots, signature: Uint8Array, data: Uint8Array): boolean {
  const result = provider.verify(parameters(algorithm, key), key.handle, { kind: "bytes", bytes: signature }, data);
  if (typeof result !== "boolean") throw new DOMException("The KMAC operation failed", "OperationError");
  return result;
}
