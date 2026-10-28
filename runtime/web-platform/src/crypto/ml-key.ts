import { DOMException } from "../core/errors.ts";
import type { CryptoKeyRecord, CryptoMlAlgorithmName, CryptoMlComponents, CryptoProvider } from "../provider/crypto.ts";
import type { NormalizedAlgorithm } from "./algorithms.ts";
import { createCryptoKey, KeyAlgorithm } from "./crypto-key.ts";
import type { CryptoKey, CryptoKeyPair, CryptoKeySlots, KeyUsage } from "./crypto-key.ts";
import { parseMlDer } from "./der.ts";
import { checkJwkPolicy, decodeBase64Url, encodeBase64Url, JsonWebKey, normalizeKeyUsages } from "./jwk.ts";
import type { KeyFormat } from "./jwk.ts";
import { isMlAlgorithm, isMlKemAlgorithm, mlPublicKeyLength, mlSeedLength } from "./ml-parameters.ts";

function mlName(name: string): CryptoMlAlgorithmName {
  if (isMlAlgorithm(name)) return name;
  throw new DOMException("The module-lattice algorithm is not supported", "NotSupportedError");
}

function publicUsage(name: CryptoMlAlgorithmName, usage: KeyUsage): boolean {
  return isMlKemAlgorithm(name) ? usage === "encapsulateKey" || usage === "encapsulateBits" : usage === "verify";
}

function privateUsage(name: CryptoMlAlgorithmName, usage: KeyUsage): boolean {
  return isMlKemAlgorithm(name) ? usage === "decapsulateKey" || usage === "decapsulateBits" : usage === "sign";
}

function validateUsages(name: CryptoMlAlgorithmName, type: "public" | "private" | "pair", usages: readonly KeyUsage[]): void {
  for (const usage of usages) {
    if ((!privateUsage(name, usage) || type === "public") && (!publicUsage(name, usage) || type === "private")) {
      throw new DOMException("The requested usage is not supported by this key", "SyntaxError");
    }
  }
}

function recordShape(record: CryptoKeyRecord, name: CryptoMlAlgorithmName, type: "public" | "private"): void {
  if (record.info.family !== "ML" || record.info.name !== name || record.info.type !== type) {
    throw new DOMException("The native module-lattice key metadata is inconsistent", "OperationError");
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) if (left[index] !== right[index]) return false;
  return true;
}

function componentShape(components: CryptoMlComponents, name: CryptoMlAlgorithmName, privateKey: boolean): void {
  if (components.name !== name || components.pub.byteLength !== mlPublicKeyLength(name) ||
      (privateKey && (components.seed === undefined || components.seed.byteLength !== mlSeedLength(name)))) {
    throw new DOMException("The native module-lattice components are inconsistent", "OperationError");
  }
}

/** Modern Algorithms §§6.4.4, 8.4.3: generate natively, then install the specified slots. */
export function generateMlKey(provider: CryptoProvider, algorithm: NormalizedAlgorithm,
  extractable: boolean, usages: readonly KeyUsage[]): CryptoKeyPair {
  const name = mlName(algorithm.name);
  validateUsages(name, "pair", usages);
  const pair = provider.generateKeyPair({ family: "ML", name });
  if ("failure" in pair) throw new DOMException("Module-lattice key generation failed", "OperationError");
  recordShape(pair.publicKey, name, "public");
  recordShape(pair.privateKey, name, "private");
  const selected = normalizeKeyUsages(usages);
  const privateUsages = selected.filter(usage => privateUsage(name, usage));
  if (privateUsages.length === 0) throw new DOMException("A private key must have a usage", "SyntaxError");
  const keyAlgorithm = new KeyAlgorithm(name);
  return {
    privateKey: createCryptoKey("private", extractable, keyAlgorithm, privateUsages, pair.privateKey.handle),
    publicKey: createCryptoKey("public", true, keyAlgorithm, selected.filter(usage => publicUsage(name, usage)), pair.publicKey.handle),
  };
}

function jwkBytes(value: string | undefined, length: number): Uint8Array {
  if (value === undefined) throw new DOMException("A module-lattice JWK component is missing", "DataError");
  const bytes = decodeBase64Url(value);
  if (bytes.byteLength !== length) throw new DOMException("The module-lattice JWK component has the wrong width", "DataError");
  return bytes;
}

/** Modern Algorithms §§6.4.5, 8.4.4: raw seed/public, AKP JWK, exact SPKI and seed PKCS8. */
export function importMlKey(provider: CryptoProvider, format: KeyFormat, data: Uint8Array | JsonWebKey,
  algorithm: NormalizedAlgorithm, extractable: boolean, usages: readonly KeyUsage[]): CryptoKey {
  const name = mlName(algorithm.name);
  let type: "public" | "private";
  let bytes: Uint8Array;
  let expanded: Uint8Array | undefined;
  let expectedPublic: string | undefined;
  if (format === "jwk") {
    if (!(data instanceof JsonWebKey)) throw new DOMException("Expected a module-lattice JWK", "DataError");
    type = data.priv === undefined ? "public" : "private";
    validateUsages(name, type, usages);
    if (data.kty !== "AKP" || data.alg !== name) throw new DOMException("The JWK algorithm does not match the key", "DataError");
    checkJwkPolicy(data, isMlKemAlgorithm(name) ? "enc" : "sig", extractable, usages);
    if (type === "private") {
      bytes = jwkBytes(data.priv, mlSeedLength(name));
      expectedPublic = data.pub;
    } else bytes = jwkBytes(data.pub, mlPublicKeyLength(name));
  } else if (format === "spki" || format === "pkcs8" || format === "raw-public" || format === "raw-seed") {
    type = format === "pkcs8" || format === "raw-seed" ? "private" : "public";
    validateUsages(name, type, usages);
    if (data instanceof JsonWebKey) throw new DOMException("Expected module-lattice key bytes", "DataError");
    if (format === "spki" || format === "pkcs8") {
      const parsed = parseMlDer(format, data);
      if (parsed.name !== name) throw new DOMException("The encoded algorithm does not match the key", "DataError");
      if (format === "pkcs8" && parsed.seed === undefined) {
        throw new DOMException("Expanded-only module-lattice private keys are not supported", "NotSupportedError");
      }
      bytes = format === "spki" ? parsed.pub! : parsed.seed!;
      expanded = parsed.expanded;
    } else {
      bytes = data;
      const width = type === "public" ? mlPublicKeyLength(name) : mlSeedLength(name);
      if (bytes.byteLength !== width) throw new DOMException("The raw module-lattice key has the wrong width", "DataError");
    }
  } else throw new DOMException("The module-lattice key format is not supported", "NotSupportedError");

  const record = provider.importKey({ family: "ML", name, format: type === "public" ? "raw-public" : "raw-seed", bytes, expanded });
  if ("failure" in record) {
    throw new DOMException("The module-lattice key could not be imported", record.failure === "invalid-key" ? "DataError" : "OperationError");
  }
  recordShape(record, name, type);
  if (format === "jwk" && type === "private") {
    // §§6.4.5, 8.4.4 create the seed-backed key before validating its JWK public key.
    // A native import failure therefore precedes a missing or malformed `pub`.
    const publicBytes = jwkBytes(expectedPublic, mlPublicKeyLength(name));
    const components = provider.exportComponents(record.handle);
    if ("failure" in components || components.family !== "ML") throw new DOMException("The private key cannot be inspected", "OperationError");
    componentShape(components, name, true);
    if (!bytesEqual(components.pub, publicBytes)) throw new DOMException("The JWK public key does not correspond to its seed", "DataError");
  }
  if (type === "private" && usages.length === 0) throw new DOMException("A private key must have a usage", "SyntaxError");
  return createCryptoKey(type, extractable, new KeyAlgorithm(name), normalizeKeyUsages(usages), record.handle);
}

/** Modern Algorithms §§6.4.6, 8.4.5: PKCS8 exports are seed-only and never expanded-only. */
export function exportMlKey(provider: CryptoProvider, format: KeyFormat, key: CryptoKeySlots): Uint8Array | JsonWebKey {
  const name = mlName(key.algorithm.name);
  if (format === "jwk") {
    const components = provider.exportComponents(key.handle);
    if ("failure" in components || components.family !== "ML") throw new DOMException("The key cannot be exported", "OperationError");
    componentShape(components, name, key.type === "private");
    const jwk = new JsonWebKey();
    jwk.kty = "AKP";
    jwk.alg = name;
    jwk.pub = encodeBase64Url(components.pub);
    if (key.type === "private") jwk.priv = encodeBase64Url(components.seed!);
    jwk.key_ops = normalizeKeyUsages(key.usages);
    jwk.ext = key.extractable;
    return jwk;
  }
  // Access the actual material before reporting an unsupported or wrong-type format.
  const nativeFormat = key.type === "private" ? format === "raw-seed" ? "raw-seed" : "pkcs8"
    : format === "raw-public" ? "raw" : "spki";
  const result = provider.exportKey(key.handle, nativeFormat);
  if ("failure" in result) throw new DOMException("The key cannot be exported", "OperationError");
  if (format !== "spki" && format !== "pkcs8" && format !== "raw-public" && format !== "raw-seed") {
    throw new DOMException("The module-lattice key format is not supported", "NotSupportedError");
  }
  if ((format === "spki" || format === "raw-public") !== (key.type === "public")) {
    throw new DOMException("The key type does not match the export format", "InvalidAccessError");
  }
  try {
    if (format === "raw-public" || format === "raw-seed") {
      if (result.byteLength !== (format === "raw-public" ? mlPublicKeyLength(name) : mlSeedLength(name))) {
        throw new DOMException("The native key encoding has the wrong width", "OperationError");
      }
    } else {
      const parsed = parseMlDer(format, result);
      if (parsed.name !== name || (format === "pkcs8" && (parsed.seed === undefined || parsed.expanded !== undefined))) {
        throw new DOMException("The native key encoding does not match the export profile", "OperationError");
      }
    }
  } catch {
    throw new DOMException("The native key encoding is invalid", "OperationError");
  }
  return result;
}
