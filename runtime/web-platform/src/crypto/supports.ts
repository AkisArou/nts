import type {
  CryptoDigestName, CryptoProvider, CryptoSupportOperation, CryptoSupportParameters,
} from "../provider/crypto.ts";
import {
  AeadParams, AesCbcParams, AesCtrParams, AesDerivedKeyParams, AesGcmParams, AesKeyGenParams,
  Argon2Params, ContextParams, CShakeParams, DigestAlgorithm, EcdhKeyDeriveParams, EcdsaParams,
  EcKeyGenParams, EcKeyImportParams, Ed448Params, HkdfParams, HmacImportParams, HmacKeyGenParams,
  KmacImportParams, KmacKeyGenParams, KmacParams, normalizeAlgorithm, Pbkdf2Params,
  RsaHashedImportParams, RsaHashedKeyGenParams, RsaOaepParams, RsaPssParams,
} from "./algorithms.ts";
import type { AlgorithmIdentifier, CryptoOperation, NormalizedAlgorithm } from "./algorithms.ts";
import { cryptoViewByteLength } from "./buffer-source.ts";
import { getCryptoKeySlots } from "./crypto-key.ts";
import { EcKeyAlgorithm } from "./ec-key.ts";
import { getKdfKeyLength } from "./kdf.ts";
import { getKmacKeyLength } from "./kmac.ts";
import { getMlKemSharedKeyLength } from "./ml-parameters.ts";
import { supportsPublicKey } from "./public-key.ts";
import { rsaGenerationExponent } from "./rsa-key.ts";
import { getSecretKeyLength, hmacDefaultLength } from "./secret-key.ts";

type SupportOperation = CryptoSupportOperation | "deriveKey" | "encapsulateKey" | "encapsulateBits"
  | "decapsulateKey" | "decapsulateBits";

function publicOperation(value: string): value is SupportOperation {
  switch (value) {
    case "encrypt": case "decrypt": case "sign": case "verify": case "digest":
    case "generateKey": case "deriveKey": case "deriveBits": case "importKey": case "exportKey":
    case "wrapKey": case "unwrapKey": case "encapsulateKey": case "encapsulateBits":
    case "decapsulateKey": case "decapsulateBits": case "getPublicKey": return true;
    default: return false;
  }
}

function optionalBytes(bytes: Uint8Array | undefined): number {
  return bytes === undefined ? 0 : cryptoViewByteLength(bytes);
}

function aesLength(length: number): boolean {
  return length === 128 || length === 192 || length === 256;
}

function hashBits(hash: CryptoDigestName): number {
  if (hash === "SHA-1") return 160;
  if (hash === "SHA-256" || hash === "SHA3-256") return 256;
  return hash === "SHA-384" || hash === "SHA3-384" ? 384 : 512;
}

/**
 * Modern Algorithms §3.3. Walk the parameter-only operation steps, stopping
 * before key/data-dependent work. The native query receives scalar metadata,
 * never author objects, CryptoKeys, messages, secrets or BufferSource copies.
 */
function supportParameters(
  algorithm: NormalizedAlgorithm, operation: CryptoSupportOperation, length: number | null,
): CryptoSupportParameters | undefined {
  const name = algorithm.name;
  if (algorithm instanceof DigestAlgorithm) return { kind: "digest", name: algorithm.name };
  if (algorithm instanceof CShakeParams) {
    return { kind: "cshake", name: algorithm.name, outputBits: algorithm.outputLength,
      functionNameBytes: optionalBytes(algorithm.functionName), customizationBytes: optionalBytes(algorithm.customization) };
  }
  if (name === "AES-CTR" || name === "AES-CBC" || name === "AES-GCM" || name === "AES-KW"
    || name === "AES-OCB" || name === "ChaCha20-Poly1305") {
    let keyBits: number | undefined;
    let ivBytes: number | undefined;
    let additionalDataBytes: number | undefined;
    let counterBits: number | undefined;
    let tagBits: number | undefined;
    if (algorithm instanceof AesKeyGenParams || algorithm instanceof AesDerivedKeyParams) {
      if (!aesLength(algorithm.length)) return undefined;
      keyBits = algorithm.length;
    } else if (name === "ChaCha20-Poly1305") keyBits = 256;
    if (algorithm instanceof AesCtrParams) {
      ivBytes = cryptoViewByteLength(algorithm.counter);
      counterBits = algorithm.length;
      if (ivBytes !== 16 || counterBits === 0 || counterBits > 128) return undefined;
    } else if (algorithm instanceof AesCbcParams) {
      ivBytes = cryptoViewByteLength(algorithm.iv);
      if (ivBytes !== 16) return undefined;
    } else if (algorithm instanceof AesGcmParams) {
      ivBytes = cryptoViewByteLength(algorithm.iv);
      additionalDataBytes = optionalBytes(algorithm.additionalData);
      tagBits = algorithm.tagLength ?? 128;
      if (ivBytes >= 2 ** 64 || additionalDataBytes >= 2 ** 64) return undefined;
      if (tagBits !== 32 && tagBits !== 64 && tagBits !== 96 && tagBits !== 104
        && tagBits !== 112 && tagBits !== 120 && tagBits !== 128) return undefined;
    } else if (algorithm instanceof AeadParams) {
      ivBytes = cryptoViewByteLength(algorithm.iv);
      additionalDataBytes = optionalBytes(algorithm.additionalData);
      tagBits = algorithm.tagLength ?? 128;
      if (name === "AES-OCB") {
        if (ivBytes > 15 || (tagBits !== 64 && tagBits !== 96 && tagBits !== 128)) return undefined;
      } else if (ivBytes !== 12 || tagBits !== 128) return undefined;
    }
    return { kind: "cipher", name, keyBits, ivBytes, additionalDataBytes, counterBits, tagBits };
  }
  if (name === "HMAC") {
    let hash: CryptoDigestName | undefined;
    let keyBits: number | undefined;
    if (algorithm instanceof HmacKeyGenParams || algorithm instanceof HmacImportParams) {
      hash = algorithm.hash.name;
      keyBits = algorithm.length;
      if (operation === "generateKey") {
        keyBits ??= hmacDefaultLength(hash);
        if (keyBits === 0) return undefined;
      }
    }
    return { kind: "hmac", name, hash, keyBits };
  }
  if (name === "KMAC128" || name === "KMAC256") {
    const keyBits = algorithm instanceof KmacKeyGenParams
      ? algorithm.length ?? (name === "KMAC128" ? 128 : 256)
      : algorithm instanceof KmacImportParams ? algorithm.length : undefined;
    const outputBits = algorithm instanceof KmacParams ? algorithm.outputLength : undefined;
    const customizationBytes = algorithm instanceof KmacParams ? optionalBytes(algorithm.customization) : undefined;
    // §16.6 permits a byte-oriented output profile. Key bit lengths are separate.
    if (outputBits !== undefined && outputBits % 8 !== 0) return undefined;
    return { kind: "kmac", name, keyBits, outputBits, customizationBytes };
  }
  if (name === "RSASSA-PKCS1-v1_5" || name === "RSA-PSS" || name === "RSA-OAEP") {
    const generation = algorithm instanceof RsaHashedKeyGenParams ? algorithm : undefined;
    return { kind: "rsa", name,
      hash: algorithm instanceof RsaHashedKeyGenParams || algorithm instanceof RsaHashedImportParams ? algorithm.hash.name : undefined,
      modulusBits: generation?.modulusLength,
      publicExponent: generation === undefined ? undefined : rsaGenerationExponent(generation),
      saltBytes: algorithm instanceof RsaPssParams ? algorithm.saltLength : undefined,
      labelBytes: algorithm instanceof RsaOaepParams ? optionalBytes(algorithm.label) : undefined };
  }
  if (name === "ECDSA" || name === "ECDH") {
    let namedCurve: string | undefined;
    if (algorithm instanceof EcKeyGenParams || algorithm instanceof EcKeyImportParams) {
      namedCurve = algorithm.namedCurve;
      if (namedCurve !== "P-256" && namedCurve !== "P-384" && namedCurve !== "P-521") return undefined;
    } else if (algorithm instanceof EcdhKeyDeriveParams) {
      const peer = getCryptoKeySlots(algorithm.public);
      if (peer.type !== "public" || peer.algorithm.name !== name || !(peer.algorithm instanceof EcKeyAlgorithm)) return undefined;
      namedCurve = peer.algorithm.namedCurve;
      const maximum = namedCurve === "P-256" ? 256 : namedCurve === "P-384" ? 384 : 528;
      if (length !== null && length > maximum) return undefined;
    }
    return { kind: "ec", name, namedCurve, hash: algorithm instanceof EcdsaParams ? algorithm.hash.name : undefined };
  }
  if (name === "Ed25519" || name === "Ed448" || name === "X25519" || name === "X448") {
    // X25519's peer and length checks precede the unavailable base key (§26.3.1).
    if (name === "X25519" && algorithm instanceof EcdhKeyDeriveParams) {
      const peer = getCryptoKeySlots(algorithm.public);
      if (peer.type !== "public" || peer.algorithm.name !== name || (length !== null && length > 256)) return undefined;
    }
    return { kind: "okp", name, contextBytes: algorithm instanceof Ed448Params ? optionalBytes(algorithm.context) : undefined };
  }
  if (name === "HKDF" || name === "PBKDF2") {
    if (operation === "deriveBits") {
      if (length === null || length % 8 !== 0) return undefined;
      if (algorithm instanceof HkdfParams && length > 255 * hashBits(algorithm.hash.name)) return undefined;
      if (algorithm instanceof Pbkdf2Params && algorithm.iterations === 0) return undefined;
    }
    return { kind: "kdf", name,
      hash: algorithm instanceof HkdfParams || algorithm instanceof Pbkdf2Params ? algorithm.hash.name : undefined,
      saltBytes: algorithm instanceof HkdfParams || algorithm instanceof Pbkdf2Params ? cryptoViewByteLength(algorithm.salt) : undefined,
      infoBytes: algorithm instanceof HkdfParams ? cryptoViewByteLength(algorithm.info) : undefined,
      iterations: algorithm instanceof Pbkdf2Params ? algorithm.iterations : undefined };
  }
  if (name === "Argon2d" || name === "Argon2i" || name === "Argon2id") {
    const parameters = algorithm instanceof Argon2Params ? algorithm : undefined;
    if (operation === "deriveBits" && parameters !== undefined) {
      if (length === null || length % 8 !== 0 || length < 32
        || (parameters.version !== undefined && parameters.version !== 0x13)
        || parameters.parallelism === 0 || parameters.parallelism > 0xff_ffff
        || parameters.memory < 8 * parameters.parallelism || parameters.passes === 0) return undefined;
    }
    return { kind: "argon2", name, nonceBytes: parameters === undefined ? undefined : cryptoViewByteLength(parameters.nonce),
      parallelism: parameters?.parallelism, memory: parameters?.memory, passes: parameters?.passes,
      secretBytes: parameters === undefined ? undefined : optionalBytes(parameters.secretValue),
      associatedDataBytes: parameters === undefined ? undefined : optionalBytes(parameters.associatedData) };
  }
  if (name === "ML-DSA-44" || name === "ML-DSA-65" || name === "ML-DSA-87"
    || name === "ML-KEM-512" || name === "ML-KEM-768" || name === "ML-KEM-1024") {
    const contextBytes = algorithm instanceof ContextParams ? optionalBytes(algorithm.context) : undefined;
    // §§8.4.1–2 check the context before the unavailable key. Section 3.3
    // therefore rejects this bound in shared policy, before native availability.
    if (contextBytes !== undefined && contextBytes > 255) return undefined;
    return { kind: "ml", name, contextBytes };
  }
  return undefined;
}

function determineSupport(
  provider: CryptoProvider | undefined, operation: CryptoSupportOperation,
  algorithm: NormalizedAlgorithm, length: number | null,
): boolean {
  if (provider === undefined) return false;
  const parameters = supportParameters(algorithm, operation, length);
  if (parameters === undefined) return false;
  return provider.supports({ operation, parameters, length: operation === "deriveBits" ? length : null }) === true;
}

function checkSupport(
  provider: CryptoProvider | undefined, operation: SupportOperation,
  identifier: AlgorithmIdentifier, length: number | null = null,
): boolean {
  let normalizedOperation: CryptoOperation;
  if (operation === "encapsulateKey" || operation === "encapsulateBits") normalizedOperation = "encapsulate";
  else if (operation === "decapsulateKey" || operation === "decapsulateBits") normalizedOperation = "decapsulate";
  else normalizedOperation = operation === "getPublicKey" ? "exportKey" : operation;
  let algorithm: NormalizedAlgorithm;
  try {
    algorithm = normalizeAlgorithm(identifier, normalizedOperation);
  } catch {
    // §3.3 retries every normalization failure; the fallback reads the original
    // author dictionary anew and can therefore succeed after an earlier throw.
    if (operation === "wrapKey") return checkSupport(provider, "encrypt", identifier);
    if (operation === "unwrapKey") return checkSupport(provider, "decrypt", identifier);
    return false;
  }
  if (operation === "getPublicKey") {
    return supportsPublicKey(algorithm.name) && determineSupport(provider, operation, algorithm, null);
  }
  // No algorithm registers the public deriveKey operation; its additional-
  // algorithm overload below composes get-key-length and deriveBits instead.
  if (normalizedOperation === "deriveKey") return false;
  try {
    return determineSupport(provider, normalizedOperation, algorithm, length);
  } catch {
    // Parameter-only operation steps (including RSA mathematical bounds and
    // the supported HMAC default profile) turn their specified errors into false.
    return false;
  }
}

function derivedKeyLength(algorithm: NormalizedAlgorithm): number | null {
  const name = algorithm.name;
  if (name === "HKDF" || name === "PBKDF2" || name === "Argon2d" || name === "Argon2i" || name === "Argon2id") return getKdfKeyLength();
  return name === "KMAC128" || name === "KMAC256" ? getKmacKeyLength(algorithm) : getSecretKeyLength(algorithm);
}

function checkKeyLength(identifier: AlgorithmIdentifier): boolean {
  try {
    derivedKeyLength(normalizeAlgorithm(identifier, "get key length"));
    return true;
  } catch { return false; }
}

/** §3.2.6 step 3.7: some complete shared secret must be importable as raw-secret. */
function acceptsSharedKey(algorithm: NormalizedAlgorithm, length: number): boolean {
  const name = algorithm.name;
  if (name === "AES-CTR" || name === "AES-CBC" || name === "AES-GCM" || name === "AES-KW" || name === "AES-OCB") return aesLength(length);
  if (name === "ChaCha20-Poly1305") return length === 256;
  if (algorithm instanceof HmacImportParams || algorithm instanceof KmacImportParams) {
    return algorithm.length === undefined || (algorithm.length <= length && algorithm.length > length - 8);
  }
  return name === "HKDF" || name === "PBKDF2" || name === "Argon2d" || name === "Argon2i" || name === "Argon2id";
}

/**
 * Modern Algorithms §§3.2.6–3.3, after Web IDL's overload/argument conversion.
 * Each native query is metadata only. A composed check queries the target first
 * and stops on false before any primary-algorithm getter or capability query.
 * https://wicg.github.io/webcrypto-modern-algos/#SubtleCrypto-method-supports
 */
export function cryptoSupports(
  provider: CryptoProvider | undefined, operation: string, identifier: AlgorithmIdentifier,
  length: number | null, additionalAlgorithm: AlgorithmIdentifier | undefined,
): boolean {
  if (!publicOperation(operation)) return false;
  if (additionalAlgorithm === undefined) return checkSupport(provider, operation, identifier, length);
  if (operation === "deriveKey" || operation === "unwrapKey") {
    if (!checkSupport(provider, "importKey", additionalAlgorithm)) return false;
  } else if (operation === "wrapKey") {
    if (!checkSupport(provider, "exportKey", additionalAlgorithm)) return false;
  } else if (operation === "encapsulateKey" || operation === "decapsulateKey") {
    try { normalizeAlgorithm(identifier, "get shared key length"); }
    catch { return false; }
    const sharedKeyLength = getMlKemSharedKeyLength();
    let additional: NormalizedAlgorithm;
    try { additional = normalizeAlgorithm(additionalAlgorithm, "importKey"); }
    catch { return false; }
    if (!determineSupport(provider, "importKey", additional, null) || !acceptsSharedKey(additional, sharedKeyLength)) return false;
  }
  if (operation === "deriveKey") {
    if (!checkKeyLength(additionalAlgorithm)) return false;
    // The final normalization is a distinct specified step, not the normalized
    // dictionary from the earlier support check. Its abrupt completion propagates.
    length = derivedKeyLength(normalizeAlgorithm(additionalAlgorithm, "get key length"));
    return checkSupport(provider, "deriveBits", identifier, length);
  }
  return checkSupport(provider, operation, identifier, null);
}
