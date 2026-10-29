import { DOMException } from "../core/errors.ts";
import { coerceToBoolean, requireArguments } from "../core/webidl.ts";
import type { CryptoProvider } from "../provider/crypto.ts";
import type { RandomSource, Scheduler } from "../provider/primitives.ts";
import { normalizeAlgorithm, supportsCryptoOperation, toAlgorithmIdentifier } from "./algorithms.ts";
import type { AlgorithmIdentifier, NormalizedAlgorithm } from "./algorithms.ts";
import { decryptAes, encryptAes } from "./aes.ts";
import { cryptoBytes, isCryptoBufferSource, toCryptoBufferSource } from "./buffer-source.ts";
import { getCryptoKeySlots } from "./crypto-key.ts";
import type { CryptoKey, CryptoKeyPair, CryptoKeySlots, KeyUsage } from "./crypto-key.ts";
import { deriveEcBits, signEc, verifyEc } from "./ec.ts";
import { exportEcKey, generateEcKey, importEcKey } from "./ec-key.ts";
import {
  JsonWebKey,
  parseWrappedJwk,
  serializeWrappedJwk,
  toJsonWebKey,
  toJsonWebKeyObject,
  toKeyFormat,
  toKeyUsages,
} from "./jwk.ts";
import type { JsonWebKeyObject, KeyFormat } from "./jwk.ts";
import { decryptRsa, encryptRsa, signRsa, verifyRsa } from "./rsa.ts";
import { exportRsaKey, generateRsaKey, importRsaKey } from "./rsa-key.ts";
import { exportSecretKey, generateSecretKey, getSecretKeyLength, importSecretKey, signHmac, verifyHmac } from "./secret-key.ts";
import { toCryptoUnsignedInteger } from "./webidl.ts";

/**
 * Execute the specification's parallel steps synchronously over native primitives,
 * then settle from one crypto task. Conversion/normalization stays outside this
 * boundary so early IDL errors do not become scheduled operation failures.
 */
function cryptoTask<T>(scheduler: Scheduler, operation: () => T): Promise<T> {
  const pending = Promise.withResolvers<T>();
  try {
    const result = operation();
    scheduler.enqueue(() => pending.resolve(result));
  } catch (error) {
    scheduler.enqueue(() => pending.reject(error));
  }
  return pending.promise;
}

function requireKeyUsage(key: CryptoKeySlots, algorithm: NormalizedAlgorithm, usage: KeyUsage): void {
  let permitted = false;
  for (let index = 0; index < key.usages.length; index++) {
    if (key.usages[index] === usage) permitted = true;
  }
  if (key.algorithm.name !== algorithm.name || !permitted) {
    throw new DOMException("The key does not permit this algorithm and operation", "InvalidAccessError");
  }
}

function requireExportableKey(key: CryptoKeySlots): void {
  if (!supportsCryptoOperation(key.algorithm.name, "exportKey")) {
    throw new DOMException("The key algorithm does not support export", "NotSupportedError");
  }
  if (!key.extractable) throw new DOMException("The key is not extractable", "InvalidAccessError");
}

function normalizeWrappingAlgorithm(identifier: AlgorithmIdentifier, unwrap: boolean): NormalizedAlgorithm {
  // §§14.3.11–12 retry after every normalization error, even an author getter's
  // exception. The fallback therefore performs its own observable dictionary reads.
  try {
    return normalizeAlgorithm(identifier, unwrap ? "unwrapKey" : "wrapKey", unwrap);
  } catch {
    return normalizeAlgorithm(identifier, unwrap ? "decrypt" : "encrypt", unwrap);
  }
}

function isRsaAlgorithm(name: string): boolean {
  return name === "RSASSA-PKCS1-v1_5" || name === "RSA-PSS" || name === "RSA-OAEP";
}

function isEcAlgorithm(name: string): boolean {
  return name === "ECDSA" || name === "ECDH";
}

function encryptBytes(provider: CryptoProvider, algorithm: NormalizedAlgorithm, key: CryptoKeySlots, bytes: Uint8Array): Uint8Array {
  return algorithm.name === "RSA-OAEP"
    ? encryptRsa(provider, algorithm, key, bytes)
    : encryptAes(provider, algorithm, key, bytes);
}

function decryptBytes(provider: CryptoProvider, algorithm: NormalizedAlgorithm, key: CryptoKeySlots, bytes: Uint8Array): Uint8Array {
  return algorithm.name === "RSA-OAEP"
    ? decryptRsa(provider, algorithm, key, bytes)
    : decryptAes(provider, algorithm, key, bytes);
}

function importKeyMaterial(
  provider: CryptoProvider,
  format: KeyFormat,
  data: Uint8Array | JsonWebKey,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: readonly KeyUsage[],
): CryptoKey {
  if (isEcAlgorithm(algorithm.name)) return importEcKey(provider, format, data, algorithm, extractable, usages);
  if (isRsaAlgorithm(algorithm.name)) return importRsaKey(provider, format, data, algorithm, extractable, usages);
  return importSecretKey(provider, format, data, algorithm, extractable, usages);
}

function exportKeyMaterial(provider: CryptoProvider, format: KeyFormat, key: CryptoKeySlots): Uint8Array | JsonWebKey {
  if (isEcAlgorithm(key.algorithm.name)) return exportEcKey(provider, format, key);
  if (isRsaAlgorithm(key.algorithm.name)) return exportRsaKey(provider, format, key);
  return exportSecretKey(provider, format, key);
}

/**
 * Web Cryptography §14. Digests, HMAC, AES, RSA, ECDSA and ECDH operations.
 * The remaining asymmetric algorithms and KDFs are separate handoff items.
 * Members are plain declarations; descriptor-only Web IDL shape is deferred.
 */
export class SubtleCrypto {
  readonly #provider: CryptoProvider;
  readonly #scheduler: Scheduler;
  readonly #random: RandomSource;

  /** Provider construction; runtime/global exposure is a separate integration change. */
  constructor(provider: CryptoProvider, scheduler: Scheduler, random: RandomSource) {
    this.#provider = provider;
    this.#scheduler = scheduler;
    this.#random = random;
  }

  /** §14.3.5 and §32, https://w3c.github.io/webcrypto/#SubtleCrypto-method-digest. */
  digest(algorithm: unknown, data: unknown): Promise<ArrayBuffer> {
    try {
      const provider = this.#provider;
      const scheduler = this.#scheduler;
      requireArguments(arguments, 2, "SubtleCrypto.digest");
      const identifier = toAlgorithmIdentifier(algorithm);
      const source = toCryptoBufferSource(data);
      const normalized = normalizeAlgorithm(identifier, "digest");
      const bytes = cryptoBytes(source);
      return cryptoTask(scheduler, () => {
        const digest = provider.digest(normalized.name, bytes);
        if ("failure" in digest) throw new DOMException("The digest operation failed", "OperationError");
        return digest.buffer as ArrayBuffer;
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** §14.3.1. All IDL arguments convert before algorithm normalization. */
  encrypt(algorithm: unknown, key: unknown, data: unknown): Promise<ArrayBuffer> {
    try {
      const provider = this.#provider;
      const scheduler = this.#scheduler;
      requireArguments(arguments, 3, "SubtleCrypto.encrypt");
      const identifier = toAlgorithmIdentifier(algorithm);
      const slots = getCryptoKeySlots(key);
      const source = toCryptoBufferSource(data);
      const normalized = normalizeAlgorithm(identifier, "encrypt");
      const bytes = cryptoBytes(source);
      return cryptoTask(scheduler, () => {
        requireKeyUsage(slots, normalized, "encrypt");
        return encryptBytes(provider, normalized, slots, bytes).buffer as ArrayBuffer;
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** §14.3.2. */
  decrypt(algorithm: unknown, key: unknown, data: unknown): Promise<ArrayBuffer> {
    try {
      const provider = this.#provider;
      const scheduler = this.#scheduler;
      requireArguments(arguments, 3, "SubtleCrypto.decrypt");
      const identifier = toAlgorithmIdentifier(algorithm);
      const slots = getCryptoKeySlots(key);
      const source = toCryptoBufferSource(data);
      const normalized = normalizeAlgorithm(identifier, "decrypt");
      const bytes = cryptoBytes(source);
      return cryptoTask(scheduler, () => {
        requireKeyUsage(slots, normalized, "decrypt");
        return decryptBytes(provider, normalized, slots, bytes).buffer as ArrayBuffer;
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** §14.3.3 and the registered HMAC/RSA/ECDSA signing operation. */
  sign(algorithm: unknown, key: unknown, data: unknown): Promise<ArrayBuffer> {
    try {
      const provider = this.#provider;
      const scheduler = this.#scheduler;
      requireArguments(arguments, 3, "SubtleCrypto.sign");
      const identifier = toAlgorithmIdentifier(algorithm);
      const slots = getCryptoKeySlots(key);
      const source = toCryptoBufferSource(data);
      const normalized = normalizeAlgorithm(identifier, "sign");
      const bytes = cryptoBytes(source);
      return cryptoTask(scheduler, () => {
        requireKeyUsage(slots, normalized, "sign");
        const signature = normalized.name === "HMAC" ? signHmac(provider, slots, bytes)
          : normalized.name === "ECDSA" ? signEc(provider, normalized, slots, bytes)
          : signRsa(provider, normalized, slots, bytes);
        return signature.buffer as ArrayBuffer;
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** §14.3.4; the primitive checks signatures and performs constant-time MAC comparison. */
  verify(algorithm: unknown, key: unknown, signature: unknown, data: unknown): Promise<boolean> {
    try {
      const provider = this.#provider;
      const scheduler = this.#scheduler;
      requireArguments(arguments, 4, "SubtleCrypto.verify");
      const identifier = toAlgorithmIdentifier(algorithm);
      const slots = getCryptoKeySlots(key);
      const signatureSource = toCryptoBufferSource(signature);
      const dataSource = toCryptoBufferSource(data);
      const normalized = normalizeAlgorithm(identifier, "verify");
      const signatureBytes = cryptoBytes(signatureSource);
      const dataBytes = cryptoBytes(dataSource);
      return cryptoTask(scheduler, () => {
        requireKeyUsage(slots, normalized, "verify");
        return normalized.name === "HMAC"
          ? verifyHmac(provider, slots, signatureBytes, dataBytes)
          : normalized.name === "ECDSA" ? verifyEc(provider, normalized, slots, signatureBytes, dataBytes)
            : verifyRsa(provider, normalized, slots, signatureBytes, dataBytes);
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** §14.3.6. */
  generateKey(algorithm: unknown, extractable: unknown, keyUsages: unknown): Promise<CryptoKey | CryptoKeyPair> {
    try {
      const provider = this.#provider;
      const scheduler = this.#scheduler;
      const random = this.#random;
      requireArguments(arguments, 3, "SubtleCrypto.generateKey");
      const identifier = toAlgorithmIdentifier(algorithm);
      const canExport = coerceToBoolean(extractable);
      const usages = toKeyUsages(keyUsages);
      const normalized = normalizeAlgorithm(identifier, "generateKey");
      return cryptoTask<CryptoKey | CryptoKeyPair>(scheduler, () => {
        if (isEcAlgorithm(normalized.name)) return generateEcKey(provider, normalized, canExport, usages);
        if (isRsaAlgorithm(normalized.name)) return generateRsaKey(provider, normalized, canExport, usages);
        return generateSecretKey(provider, random, normalized, canExport, usages);
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** §14.3.7. Normalize import and key length separately, in the specified order. */
  deriveKey(algorithm: unknown, baseKey: unknown, derivedKeyType: unknown, extractable: unknown, keyUsages: unknown): Promise<CryptoKey> {
    try {
      const provider = this.#provider;
      const scheduler = this.#scheduler;
      requireArguments(arguments, 5, "SubtleCrypto.deriveKey");
      const identifier = toAlgorithmIdentifier(algorithm);
      const slots = getCryptoKeySlots(baseKey);
      const derivedIdentifier = toAlgorithmIdentifier(derivedKeyType);
      const canExport = coerceToBoolean(extractable);
      const usages = toKeyUsages(keyUsages);
      const normalized = normalizeAlgorithm(identifier, "deriveBits", true);
      const normalizedImport = normalizeAlgorithm(derivedIdentifier, "importKey", true);
      const normalizedLength = normalizeAlgorithm(derivedIdentifier, "get key length");
      return cryptoTask(scheduler, () => {
        requireKeyUsage(slots, normalized, "deriveKey");
        const length = getSecretKeyLength(normalizedLength);
        const secret = deriveEcBits(provider, normalized, slots, length);
        return importKeyMaterial(provider, "raw", secret, normalizedImport, canExport, usages);
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** §14.3.8. An omitted or null length requests the full encoded ECDH secret. */
  deriveBits(algorithm: unknown, baseKey: unknown, length: unknown = null): Promise<ArrayBuffer> {
    try {
      const provider = this.#provider;
      const scheduler = this.#scheduler;
      requireArguments(arguments, 2, "SubtleCrypto.deriveBits");
      const identifier = toAlgorithmIdentifier(algorithm);
      const slots = getCryptoKeySlots(baseKey);
      const bitLength = length === null || length === undefined ? null : toCryptoUnsignedInteger(length, 32);
      const normalized = normalizeAlgorithm(identifier, "deriveBits");
      return cryptoTask(scheduler, () => {
        requireKeyUsage(slots, normalized, "deriveBits");
        return deriveEcBits(provider, normalized, slots, bitLength).buffer as ArrayBuffer;
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** §14.3.9. The IDL key-data union is resolved before inspecting format. */
  importKey(format: unknown, keyData: unknown, algorithm: unknown, extractable: unknown, keyUsages: unknown): Promise<CryptoKey> {
    try {
      const provider = this.#provider;
      const scheduler = this.#scheduler;
      requireArguments(arguments, 5, "SubtleCrypto.importKey");
      const keyFormat = toKeyFormat(format);
      const source = isCryptoBufferSource(keyData) ? toCryptoBufferSource(keyData) : toJsonWebKey(keyData);
      const identifier = toAlgorithmIdentifier(algorithm);
      const canExport = coerceToBoolean(extractable);
      const usages = toKeyUsages(keyUsages);
      const normalized = normalizeAlgorithm(identifier, "importKey");
      const dictionary = source instanceof JsonWebKey;
      if ((keyFormat === "jwk") !== dictionary) throw new TypeError("The key data does not match its format");
      const data = dictionary ? source : cryptoBytes(source);
      return cryptoTask(scheduler, () => importKeyMaterial(provider, keyFormat, data, normalized, canExport, usages));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** §14.3.10. Algorithm support precedes extractability, then format policy. */
  exportKey(format: unknown, key: unknown): Promise<ArrayBuffer | JsonWebKeyObject> {
    try {
      const provider = this.#provider;
      const scheduler = this.#scheduler;
      requireArguments(arguments, 2, "SubtleCrypto.exportKey");
      const keyFormat = toKeyFormat(format);
      const slots = getCryptoKeySlots(key);
      return cryptoTask(scheduler, () => {
        requireExportableKey(slots);
        const result = exportKeyMaterial(provider, keyFormat, slots);
        return result instanceof JsonWebKey ? toJsonWebKeyObject(result) : result.buffer as ArrayBuffer;
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** §14.3.11. Wrapping requires wrapKey usage, independently of encrypt usage. */
  wrapKey(format: unknown, key: unknown, wrappingKey: unknown, wrapAlgorithm: unknown): Promise<ArrayBuffer> {
    try {
      const provider = this.#provider;
      const scheduler = this.#scheduler;
      requireArguments(arguments, 4, "SubtleCrypto.wrapKey");
      const keyFormat = toKeyFormat(format);
      const slots = getCryptoKeySlots(key);
      const wrappingSlots = getCryptoKeySlots(wrappingKey);
      const identifier = toAlgorithmIdentifier(wrapAlgorithm);
      const normalized = normalizeWrappingAlgorithm(identifier, false);
      return cryptoTask(scheduler, () => {
        requireKeyUsage(wrappingSlots, normalized, "wrapKey");
        requireExportableKey(slots);
        const exported = exportKeyMaterial(provider, keyFormat, slots);
        // Serializing our generated key dictionary invokes no author code, so
        // the normalized parameters can stay borrowed on this operation.
        const bytes = exported instanceof JsonWebKey
          ? serializeWrappedJwk(exported, normalized.name === "AES-KW") : exported;
        return encryptBytes(provider, normalized, wrappingSlots, bytes).buffer as ArrayBuffer;
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }

  /** §14.3.12. Unwrap parameters are snapshotted before the second normalization. */
  unwrapKey(
    format: unknown,
    wrappedKey: unknown,
    unwrappingKey: unknown,
    unwrapAlgorithm: unknown,
    unwrappedKeyAlgorithm: unknown,
    extractable: unknown,
    keyUsages: unknown,
  ): Promise<CryptoKey> {
    try {
      const provider = this.#provider;
      const scheduler = this.#scheduler;
      requireArguments(arguments, 7, "SubtleCrypto.unwrapKey");
      const keyFormat: KeyFormat = toKeyFormat(format);
      const source = toCryptoBufferSource(wrappedKey);
      const slots = getCryptoKeySlots(unwrappingKey);
      const identifier = toAlgorithmIdentifier(unwrapAlgorithm);
      const keyIdentifier = toAlgorithmIdentifier(unwrappedKeyAlgorithm);
      const canExport = coerceToBoolean(extractable);
      const usages = toKeyUsages(keyUsages);
      const normalized = normalizeWrappingAlgorithm(identifier, true);
      const normalizedKey = normalizeAlgorithm(keyIdentifier, "importKey");
      const wrappedBytes = cryptoBytes(source);
      return cryptoTask(scheduler, () => {
        requireKeyUsage(slots, normalized, "unwrapKey");
        const bytes = decryptBytes(provider, normalized, slots, wrappedBytes);
        const data = keyFormat === "jwk" ? parseWrappedJwk(bytes) : bytes;
        return importKeyMaterial(provider, keyFormat, data, normalizedKey, canExport, usages);
      });
    } catch (error) {
      return Promise.reject(error);
    }
  }
}
