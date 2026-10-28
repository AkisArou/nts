import { DOMException } from "../core/errors.ts";
import type { CryptoKeyInfo, CryptoProvider } from "../provider/crypto.ts";
import { createCryptoKey } from "./crypto-key.ts";
import type { CryptoKey, CryptoKeySlots, KeyUsage } from "./crypto-key.ts";
import { EcKeyAlgorithm } from "./ec-key.ts";
import { normalizeKeyUsages } from "./jwk.ts";
import { isMlAlgorithm, isMlKemAlgorithm } from "./ml-parameters.ts";
import { RsaHashedKeyAlgorithm } from "./rsa-key.ts";

export function supportsPublicKey(name: string): boolean {
  return name === "RSASSA-PKCS1-v1_5" || name === "RSA-PSS" || name === "RSA-OAEP" ||
    name === "ECDSA" || name === "ECDH" || name === "Ed25519" || name === "Ed448" ||
    name === "X25519" || name === "X448" || isMlAlgorithm(name);
}

function allowed(name: string, usage: KeyUsage): boolean {
  if (isMlKemAlgorithm(name)) return usage === "encapsulateKey" || usage === "encapsulateBits";
  if (name === "RSA-OAEP") return usage === "encrypt" || usage === "wrapKey";
  if (name === "ECDH" || name === "X25519" || name === "X448") return false;
  return usage === "verify";
}

function metadataMatches(info: CryptoKeyInfo, key: CryptoKeySlots): boolean {
  if (info.type !== "public") return false;
  const algorithm = key.algorithm;
  if (algorithm instanceof RsaHashedKeyAlgorithm) {
    if (info.family !== "RSA" || info.modulusLength !== algorithm.modulusLength ||
        info.publicExponent.byteLength !== algorithm.publicExponent.byteLength) return false;
    for (let index = 0; index < info.publicExponent.byteLength; index++) {
      if (info.publicExponent[index] !== algorithm.publicExponent[index]) return false;
    }
    return true;
  }
  if (algorithm instanceof EcKeyAlgorithm) return info.family === "EC" && info.namedCurve === algorithm.namedCurve;
  if (isMlAlgorithm(algorithm.name)) return info.family === "ML" && info.name === algorithm.name;
  return info.family === "OKP" && info.namedCurve === algorithm.name;
}

/** Modern Algorithms §3.2.5: no private export and no call through public methods. */
export function derivePublicKey(provider: CryptoProvider, key: CryptoKeySlots, usages: readonly KeyUsage[]): CryptoKey {
  if (key.type !== "private") throw new DOMException("Expected a private key", "InvalidAccessError");
  for (const usage of usages) {
    if (!allowed(key.algorithm.name, usage)) throw new DOMException("The public key does not support this usage", "SyntaxError");
  }
  const record = provider.getPublicKey(key.handle);
  if ("failure" in record || !metadataMatches(record.info, key)) {
    throw new DOMException("The public key could not be derived", "OperationError");
  }
  return createCryptoKey("public", true, key.algorithm, normalizeKeyUsages(usages), record.handle);
}
