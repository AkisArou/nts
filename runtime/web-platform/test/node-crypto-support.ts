// Test-only native availability metadata for the pinned Node 24.20 provider.
// No WebCrypto method or cryptographic operation is used to answer a query.
import { getCiphers, getCurves, getHashes } from "node:crypto";
import type { CryptoDigestName, CryptoFailure, CryptoSupportQuery } from "../src/provider/crypto.ts";
import { runNativeModernCrypto } from "./node-crypto-modern-jobs.ts";
import type { NativeModernCryptoCapability } from "./node-crypto-modern-jobs.ts";

const nativeHashes = new Set(getHashes());
const nativeCiphers = new Set(getCiphers());
const nativeCurves = new Set(getCurves());
const nativeCapabilities = new Map<NativeModernCryptoCapability, boolean>();

function hasCapability(capability: NativeModernCryptoCapability): boolean {
  const cached = nativeCapabilities.get(capability);
  if (cached !== undefined) return cached;
  const result = runNativeModernCrypto({ kind: "supports", capability });
  if (typeof result !== "boolean") return false;
  nativeCapabilities.set(capability, result);
  return result;
}

function hasHash(name: CryptoDigestName | undefined): boolean {
  if (name === undefined) return true;
  switch (name) {
    case "SHA-1": return nativeHashes.has("sha1");
    case "SHA-256": return nativeHashes.has("sha256");
    case "SHA-384": return nativeHashes.has("sha384");
    case "SHA-512": return nativeHashes.has("sha512");
    case "SHA3-256": return nativeHashes.has("sha3-256");
    case "SHA3-384": return nativeHashes.has("sha3-384");
    case "SHA3-512": return nativeHashes.has("sha3-512");
  }
}

function hasCurve(name: string | undefined): boolean {
  if (name === undefined) return true;
  return nativeCurves.has(name === "P-256" ? "prime256v1" : name === "P-384" ? "secp384r1" : "secp521r1");
}

function cipherName(name: string, keyBits: number): string {
  if (name === "AES-KW") return "id-aes" + keyBits + "-wrap";
  return "aes-" + keyBits + "-" + name.slice(4).toLowerCase();
}

function querySupport(query: CryptoSupportQuery): boolean {
  const p = query.parameters;
  switch (p.kind) {
    case "digest": return hasHash(p.name);
    case "cshake":
      // OpenSSL's custom-string limit is not the draft's shared policy. The
      // adapter rounds output to complete octets before its native job.
      if (p.customizationBytes > 512 || p.functionNameBytes > 0x7fff_ffff) return false;
      if (p.functionNameBytes === 0 && p.customizationBytes === 0) {
        return nativeHashes.has(p.name === "cSHAKE128" ? "shake128" : "shake256");
      }
      return p.outputBits <= 0xffff_fff8 && hasCapability("cshake");
    case "cipher": {
      // CipherBase::SetAAD applies CheckSizeInt32 to every native cipher.
      // https://github.com/nodejs/node/blob/v24.20.0/src/crypto/crypto_cipher.cc
      if (p.additionalDataBytes !== undefined && p.additionalDataBytes > 0x7fff_ffff) return false;
      if (p.name === "ChaCha20-Poly1305") return nativeCiphers.has("chacha20-poly1305");
      // Both native GCM and OCB reject an empty IV. OCB's draft permits it;
      // supports must still report a known all-input native failure (§3.3).
      if ((p.name === "AES-GCM" || p.name === "AES-OCB") && p.ivBytes === 0) return false;
      // Node 24.20/OpenSSL accepts at most 128 IV bytes for GCM, in both
      // directions and for every AES key width. The shared draft range stays.
      if (p.name === "AES-GCM" && p.ivBytes !== undefined && p.ivBytes > 128) return false;
      if (p.keyBits !== undefined) return nativeCiphers.has(cipherName(p.name, p.keyBits));
      return nativeCiphers.has(cipherName(p.name, 128)) || nativeCiphers.has(cipherName(p.name, 192))
        || nativeCiphers.has(cipherName(p.name, 256));
    }
    case "hmac": return hasHash(p.hash);
    case "kmac":
      if (p.customizationBytes !== undefined && p.customizationBytes > 512) return false;
      if (p.outputBits !== undefined && p.outputBits > 2_097_151 * 8) return false;
      // Secret handles themselves may be longer than KMAC's native signing
      // limit. This query has no signing key, so it must not reject those key
      // generation/import operations by pretending to know a future key.
      return hasCapability("kmac");
    case "rsa":
      if (!hasHash(p.hash) || !hasCapability("rsa")) return false;
      if (p.modulusBits !== undefined && p.modulusBits < 512) return false;
      // The provider's already documented generation API takes a uint32
      // exponent. Shared code supplies minimal unsigned big-endian bytes.
      if (p.publicExponent !== undefined && p.publicExponent.byteLength > 4) return false;
      if (p.saltBytes !== undefined && p.saltBytes > 0x7fff_ffff) return false;
      return p.labelBytes === undefined || p.labelBytes <= 0x7fff_ffff;
    case "ec": return hasHash(p.hash) && hasCurve(p.namedCurve) && hasCapability("ec");
    case "okp":
      if (p.contextBytes !== undefined && p.contextBytes > 255) return false;
      if (p.name === "X448" && query.length !== null && query.length > 448) return false;
      return hasCapability(p.name);
    case "kdf":
      // PBKDF2's zero-length operation returns before calling the native KDF.
      if (p.name === "PBKDF2" && query.operation === "deriveBits" && query.length === 0) return true;
      if (!hasHash(p.hash)) return false;
      if (p.saltBytes !== undefined && p.saltBytes > 0x7fff_ffff) return false;
      if (p.name === "HKDF") return p.infoBytes === undefined || p.infoBytes <= 1024;
      return p.iterations === undefined || p.iterations <= 0x7fff_ffff;
    case "argon2":
      if (p.nonceBytes !== undefined && (p.nonceBytes < 8 || p.nonceBytes > 0xffff_ffff)) return false;
      if (p.secretBytes !== undefined && p.secretBytes > 0xffff_ffff) return false;
      if (p.associatedDataBytes !== undefined && p.associatedDataBytes > 0xffff_ffff) return false;
      return hasCapability("argon2");
    case "ml":
      if (p.contextBytes !== undefined && p.contextBytes > 255) return false;
      return hasCapability(p.name);
  }
}

/** Native availability and explicit provider limits, returned as values. */
export function queryNodeCryptoSupport(query: CryptoSupportQuery): boolean | CryptoFailure {
  try { return querySupport(query); }
  catch { return { failure: "operation" }; }
}
