import { DOMException } from "../core/errors.ts";
import type { CryptoDigestName, CryptoKeyRecord, CryptoProvider } from "../provider/crypto.ts";
import type { RandomSource } from "../provider/primitives.ts";
import { AesDerivedKeyParams, AesKeyGenParams, HmacImportParams, HmacKeyGenParams } from "./algorithms.ts";
import type { NormalizedAlgorithm } from "./algorithms.ts";
import { copyCryptoBytes, cryptoViewByteLength } from "./buffer-source.ts";
import { createCryptoKey, KeyAlgorithm } from "./crypto-key.ts";
import type { CryptoKey, CryptoKeySlots, KeyAlgorithmObject, KeyUsage } from "./crypto-key.ts";
import { checkJwkPolicy, decodeBase64Url, encodeBase64Url, JsonWebKey, normalizeKeyUsages } from "./jwk.ts";
import type { KeyFormat } from "./jwk.ts";


interface AesKeyAlgorithmObject extends KeyAlgorithmObject {
  length: number;
}

interface HmacKeyAlgorithmObject extends AesKeyAlgorithmObject {
  hash: KeyAlgorithmObject;
}

/** Web Cryptography §§27.4 and 31.4; public dictionaries never alias the slots. */
export class AesKeyAlgorithm extends KeyAlgorithm {
  readonly length: number;

  constructor(name: string, length: number) {
    super(name);
    this.length = length;
  }

  override copy(): AesKeyAlgorithm {
    return new AesKeyAlgorithm(this.name, this.length);
  }

  override toObject(): AesKeyAlgorithmObject {
    return { name: this.name, length: this.length };
  }
}

export class HmacKeyAlgorithm extends KeyAlgorithm {
  readonly length: number;
  readonly hash: KeyAlgorithm;

  constructor(hash: CryptoDigestName, length: number) {
    super("HMAC");
    this.length = length;
    this.hash = new KeyAlgorithm(hash);
  }

  override copy(): HmacKeyAlgorithm {
    return new HmacKeyAlgorithm(this.hash.name as CryptoDigestName, this.length);
  }

  override toObject(): HmacKeyAlgorithmObject {
    return { name: this.name, hash: this.hash.toObject(), length: this.length };
  }
}

function allowedUsage(name: string, usage: KeyUsage): boolean {
  if (name === "HMAC") return usage === "sign" || usage === "verify";
  if (name === "AES-KW") return usage === "wrapKey" || usage === "unwrapKey";
  return usage === "encrypt" || usage === "decrypt" || usage === "wrapKey" || usage === "unwrapKey";
}

function validateUsages(name: string, usages: readonly KeyUsage[]): void {
  for (let index = 0; index < usages.length; index++) {
    if (!allowedUsage(name, usages[index]!)) {
      throw new DOMException("The requested key usage is not supported by " + name, "SyntaxError");
    }
  }
}

function requireAesLength(length: number, error: "OperationError" | "DataError"): void {
  if (length !== 128 && length !== 192 && length !== 256) {
    throw new DOMException("An AES key must contain 128, 192 or 256 bits", error);
  }
}

function requireSecretLength(name: string, length: number, error: "OperationError" | "DataError"): void {
  if (name === "ChaCha20-Poly1305") {
    if (length !== 256) throw new DOMException("A ChaCha20-Poly1305 key must contain 256 bits", error);
  } else {
    requireAesLength(length, error);
  }
}

export function hmacDefaultLength(hash: CryptoDigestName): number {
  // This increment follows Node 24.20's public profile: SHA-3 HMAC is
  // supported with an explicit length, but has no supported omitted default.
  if (hash === "SHA3-256" || hash === "SHA3-384" || hash === "SHA3-512") {
    throw new DOMException("SHA-3 HMAC requires an explicit key length", "NotSupportedError");
  }
  return hash === "SHA-384" || hash === "SHA-512" ? 1024 : 512;
}

/** §§27–31 get-key-length operations, used before deriveKey derives any material. */
export function getSecretKeyLength(algorithm: NormalizedAlgorithm): number {
  if (algorithm.name === "ChaCha20-Poly1305") return 256;
  if (algorithm instanceof AesDerivedKeyParams) {
    requireAesLength(algorithm.length, "OperationError");
    return algorithm.length;
  }
  if (algorithm instanceof HmacImportParams) {
    // HMAC's get-key-length operation specifies TypeError for zero, unlike its
    // generate/import operations. The default is the hash block size, not digest size.
    if (algorithm.length === 0) throw new TypeError("An HMAC key cannot have zero length");
    return algorithm.length ?? hmacDefaultLength(algorithm.hash.name);
  }
  throw new DOMException("This algorithm has no derived key length", "NotSupportedError");
}

function secretRecord(record: CryptoKeyRecord, byteLength: number): void {
  if (record.info.family !== "secret" || record.info.type !== "secret" || record.info.length !== byteLength * 8) {
    throw new DOMException("The primitive returned inconsistent secret-key metadata", "OperationError");
  }
}

function finishSecretKey(
  record: CryptoKeyRecord,
  extractable: boolean,
  algorithm: KeyAlgorithm,
  usages: readonly KeyUsage[],
): CryptoKey {
  // The common generate/import/unwrap steps check this after the algorithm has
  // produced its key, rather than changing earlier algorithm error precedence.
  if (usages.length === 0) throw new DOMException("A secret key must have at least one usage", "SyntaxError");
  return createCryptoKey("secret", extractable, algorithm, normalizeKeyUsages(usages), record.handle);
}

/** §§27–31 generate-key operations, using the existing randomness capability. */
export function generateSecretKey(
  provider: CryptoProvider,
  random: RandomSource,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: readonly KeyUsage[],
): CryptoKey {
  validateUsages(algorithm.name, usages);
  let length: number;
  let keyAlgorithm: KeyAlgorithm;
  if (algorithm instanceof HmacKeyGenParams) {
    length = algorithm.length ?? hmacDefaultLength(algorithm.hash.name);
    if (length === 0) throw new DOMException("An HMAC key cannot have zero length", "OperationError");
    keyAlgorithm = new HmacKeyAlgorithm(algorithm.hash.name, length);
  } else if (algorithm.name === "ChaCha20-Poly1305") {
    length = 256;
    keyAlgorithm = new KeyAlgorithm(algorithm.name);
  } else if (algorithm instanceof AesKeyGenParams) {
    length = algorithm.length;
    requireAesLength(length, "OperationError");
    keyAlgorithm = new AesKeyAlgorithm(algorithm.name, length);
  } else {
    throw new DOMException("This algorithm cannot generate a secret key", "NotSupportedError");
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array((length - length % 8) / 8 + (length % 8 === 0 ? 0 : 1));
    random.fill(bytes);
  } catch {
    throw new DOMException("Secret key generation failed", "OperationError");
  }
  // The native seam uses octets. Keep the first logical bits and clear the unused
  // low bits, as Node v24.20's secret-key representation does. The logical length
  // remains in HmacKeyAlgorithm and is never inferred from rounded storage.
  const remainder = length % 8;
  if (remainder !== 0) bytes[bytes.length - 1]! &= 0xff << (8 - remainder);
  const record = provider.importKey({ format: "raw", family: "secret", bytes });
  if ("failure" in record) throw new DOMException("Secret key generation failed", "OperationError");
  secretRecord(record, bytes.length);
  return finishSecretKey(record, extractable, keyAlgorithm, usages);
}

function jwkAlgorithm(name: string, length: number, hash: CryptoDigestName | undefined): string {
  switch (name) {
    case "AES-CTR": return "A" + length + "CTR";
    case "AES-CBC": return "A" + length + "CBC";
    case "AES-GCM": return "A" + length + "GCM";
    case "AES-KW": return "A" + length + "KW";
    case "AES-OCB": return "A" + length + "OCB";
    case "ChaCha20-Poly1305": return "C20P";
  }
  switch (hash) {
    case "SHA-1": return "HS1";
    case "SHA-256": return "HS256";
    case "SHA-384": return "HS384";
    case "SHA-512": return "HS512";
    default: throw new DOMException("The key hash is not supported", "NotSupportedError");
  }
}

/** §§27–31 raw/JWK imports. Policy checks precede the one native key import. */
export function importSecretKey(
  provider: CryptoProvider,
  format: KeyFormat,
  data: Uint8Array | JsonWebKey,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: readonly KeyUsage[],
): CryptoKey {
  const hmac = algorithm instanceof HmacImportParams ? algorithm : undefined;
  if (hmac?.length === 0) throw new DOMException("An HMAC key cannot have zero length", "DataError");
  validateUsages(algorithm.name, usages);
  let bytes: Uint8Array;
  if (format === "raw-secret" || (format === "raw" && algorithm.name !== "AES-OCB" && algorithm.name !== "ChaCha20-Poly1305")) {
    if (data instanceof JsonWebKey) throw new DOMException("Expected raw key bytes", "DataError");
    bytes = data;
  } else if (format === "jwk") {
    if (!(data instanceof JsonWebKey) || data.kty !== "oct" || data.k === undefined) {
      throw new DOMException("Expected an octet JWK with a k member", "DataError");
    }
    bytes = decodeBase64Url(data.k);
    const bits = cryptoViewByteLength(bytes) * 8;
    if (hmac === undefined) requireSecretLength(algorithm.name, bits, "DataError");
    if (data.alg !== undefined && data.alg !== jwkAlgorithm(algorithm.name, bits, hmac?.hash.name)) {
      throw new DOMException("The JWK algorithm does not match the requested key", "DataError");
    }
    checkJwkPolicy(data, algorithm.name === "HMAC" ? "sig" : "enc", extractable, usages);
  } else {
    throw new DOMException("This secret-key format is not supported", "NotSupportedError");
  }
  const byteLength = cryptoViewByteLength(bytes);
  let length = byteLength * 8;
  let keyAlgorithm: KeyAlgorithm;
  if (hmac !== undefined) {
    if (length === 0 || (hmac.length !== undefined && (hmac.length > length || hmac.length <= length - 8))) {
      throw new DOMException("The HMAC key length does not match its data", "DataError");
    }
    length = hmac.length ?? length;
    if (length % 8 !== 0) {
      bytes = copyCryptoBytes(bytes);
      bytes[byteLength - 1]! &= 0xff << (8 - length % 8);
    }
    keyAlgorithm = new HmacKeyAlgorithm(hmac.hash.name, length);
  } else {
    requireSecretLength(algorithm.name, length, "DataError");
    keyAlgorithm = algorithm.name === "ChaCha20-Poly1305" ? new KeyAlgorithm(algorithm.name) : new AesKeyAlgorithm(algorithm.name, length);
  }
  const record = provider.importKey(format === "jwk"
    ? { format: "components", components: { family: "secret", k: bytes } }
    : { format: "raw", family: "secret", bytes });
  if ("failure" in record) {
    throw new DOMException("The secret key could not be imported", record.failure === "invalid-key" ? "DataError" : "OperationError");
  }
  secretRecord(record, byteLength);
  return finishSecretKey(record, extractable, keyAlgorithm, usages);
}

/** §§27–31 exports. Components are decoded native bytes, never a provider JWK. */
export function exportSecretKey(provider: CryptoProvider, format: KeyFormat, key: CryptoKeySlots): Uint8Array | JsonWebKey {
  let bytes: Uint8Array;
  if (format === "jwk") {
    const components = provider.exportComponents(key.handle);
    if ("failure" in components || components.family !== "secret") {
      throw new DOMException("The secret key cannot be exported", "OperationError");
    }
    bytes = components.k;
  } else {
    const result = provider.exportKey(key.handle, "raw");
    if ("failure" in result) throw new DOMException("The secret key cannot be exported", "OperationError");
    bytes = result;
  }
  if (format === "raw-secret" || (format === "raw" && key.algorithm.name !== "AES-OCB" && key.algorithm.name !== "ChaCha20-Poly1305")) return bytes;
  if (format !== "jwk") throw new DOMException("This secret-key format is not supported", "NotSupportedError");
  const algorithm = key.algorithm;
  const hmac = algorithm instanceof HmacKeyAlgorithm ? algorithm : undefined;
  const jwk = new JsonWebKey();
  jwk.kty = "oct";
  jwk.k = encodeBase64Url(bytes);
  jwk.alg = jwkAlgorithm(algorithm.name, cryptoViewByteLength(bytes) * 8, hmac?.hash.name as CryptoDigestName | undefined);
  jwk.key_ops = [];
  for (let index = 0; index < key.usages.length; index++) jwk.key_ops[index] = key.usages[index]!;
  jwk.ext = key.extractable;
  return jwk;
}

/** HMAC hashes and constant-time verification remain native whole-input calls. */
export function signHmac(provider: CryptoProvider, key: CryptoKeySlots, bytes: Uint8Array): Uint8Array {
  const hash = (key.algorithm as HmacKeyAlgorithm).hash.name as CryptoDigestName;
  const signature = provider.sign({ name: "HMAC", hash }, key.handle, bytes);
  if ("failure" in signature || signature.kind !== "bytes") throw new DOMException("The HMAC operation failed", "OperationError");
  return signature.bytes;
}

export function verifyHmac(provider: CryptoProvider, key: CryptoKeySlots, signature: Uint8Array, bytes: Uint8Array): boolean {
  const hash = (key.algorithm as HmacKeyAlgorithm).hash.name as CryptoDigestName;
  const result = provider.verify({ name: "HMAC", hash }, key.handle, { kind: "bytes", bytes: signature }, bytes);
  if (typeof result !== "boolean") throw new DOMException("The verification operation failed", "OperationError");
  return result;
}
