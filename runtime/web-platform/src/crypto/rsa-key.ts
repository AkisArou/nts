import { DOMException } from "../core/errors.ts";
import type {
  CryptoDigestName, CryptoKeyRecord, CryptoProvider, CryptoRsaComponents,
  CryptoRsaKeyInfo, CryptoRsaOtherPrime,
} from "../provider/crypto.ts";
import { RsaHashedImportParams, RsaHashedKeyGenParams } from "./algorithms.ts";
import type { NormalizedAlgorithm, RsaAlgorithmName } from "./algorithms.ts";
import { copyCryptoBytes, cryptoByteSubarray, cryptoViewByteLength } from "./buffer-source.ts";
import { createCryptoKey, KeyAlgorithm } from "./crypto-key.ts";
import type { CryptoKey, CryptoKeyPair, CryptoKeySlots, KeyAlgorithmObject, KeyUsage } from "./crypto-key.ts";
import { parseRsaDer } from "./der.ts";
import { checkJwkPolicy, decodeBase64Url, encodeBase64Url, JsonWebKey, normalizeKeyUsages, RsaOtherPrimesInfo } from "./jwk.ts";
import type { KeyFormat } from "./jwk.ts";

interface RsaHashedKeyAlgorithmObject extends KeyAlgorithmObject {
  modulusLength: number;
  publicExponent: Uint8Array;
  hash: KeyAlgorithmObject;
}

/** §§20.6–7: slots and both cached public dictionaries own separate nested values. */
export class RsaHashedKeyAlgorithm extends KeyAlgorithm {
  readonly modulusLength: number;
  readonly publicExponent: Uint8Array;
  readonly hash: KeyAlgorithm;

  constructor(name: RsaAlgorithmName, modulusLength: number, publicExponent: Uint8Array, hash: CryptoDigestName) {
    super(name);
    this.modulusLength = modulusLength;
    this.publicExponent = copyCryptoBytes(minimalUnsigned(publicExponent));
    this.hash = new KeyAlgorithm(hash);
  }

  override copy(): RsaHashedKeyAlgorithm {
    return new RsaHashedKeyAlgorithm(this.name as RsaAlgorithmName, this.modulusLength, this.publicExponent, this.hash.name as CryptoDigestName);
  }

  override toObject(): RsaHashedKeyAlgorithmObject {
    return {
      name: this.name,
      modulusLength: this.modulusLength,
      publicExponent: copyCryptoBytes(this.publicExponent),
      hash: this.hash.toObject(),
    };
  }
}

function minimalUnsigned(bytes: Uint8Array): Uint8Array {
  const length = cryptoViewByteLength(bytes);
  let start = 0;
  while (start < length - 1 && bytes[start] === 0) start++;
  return start === 0 ? bytes : cryptoByteSubarray(bytes, start, length);
}

function bitLength(bytes: Uint8Array): number {
  const length = cryptoViewByteLength(bytes);
  if (length === 0) return 0;
  let leading = 0;
  const first = bytes[0]!;
  while (leading < 8 && (first & (0x80 >>> leading)) === 0) leading++;
  return length * 8 - leading;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  const length = cryptoViewByteLength(left);
  if (length !== cryptoViewByteLength(right)) return false;
  for (let index = 0; index < length; index++) if (left[index] !== right[index]) return false;
  return true;
}

function lessThan(left: Uint8Array, right: Uint8Array): boolean {
  const leftLength = cryptoViewByteLength(left);
  const rightLength = cryptoViewByteLength(right);
  if (leftLength !== rightLength) return leftLength < rightLength;
  for (let index = 0; index < leftLength; index++) {
    if (left[index] !== right[index]) return left[index]! < right[index]!;
  }
  return false;
}

function usageAllowed(name: string, type: "public" | "private" | "pair", usage: KeyUsage): boolean {
  if (name === "RSA-OAEP") {
    return (type !== "private" && (usage === "encrypt" || usage === "wrapKey"))
      || (type !== "public" && (usage === "decrypt" || usage === "unwrapKey"));
  }
  return (type !== "private" && usage === "verify") || (type !== "public" && usage === "sign");
}

function validateUsages(name: string, type: "public" | "private" | "pair", usages: readonly KeyUsage[]): void {
  for (let index = 0; index < usages.length; index++) {
    if (!usageAllowed(name, type, usages[index]!)) {
      throw new DOMException("The requested usage is not supported by this RSA key", "SyntaxError");
    }
  }
}

function intersectUsages(name: string, type: "public" | "private", usages: readonly KeyUsage[]): KeyUsage[] {
  const selected: KeyUsage[] = [];
  for (let index = 0; index < usages.length; index++) {
    const usage = usages[index]!;
    if (usageAllowed(name, type, usage)) selected[selected.length] = usage;
  }
  return normalizeKeyUsages(selected);
}

/** §20.5's bounds need only byte inspection, never big-integer arithmetic. */
function generationExponent(algorithm: RsaHashedKeyGenParams): Uint8Array {
  const exponent = minimalUnsigned(algorithm.publicExponent);
  const length = cryptoViewByteLength(exponent);
  const bits = bitLength(exponent);
  const modulusLength = algorithm.modulusLength;
  if (modulusLength < 4 || length === 0 || (length === 1 && exponent[0]! < 3)
      || (exponent[length - 1]! & 1) === 0 || bits > modulusLength) {
    throw new DOMException("The RSA generation parameters are invalid", "OperationError");
  }
  // If the lengths match, only the all-one value reaches 2^modulusLength − 1.
  if (bits === modulusLength) {
    let allOnes = exponent[0] === (0xff >>> ((8 - modulusLength % 8) % 8));
    for (let index = 1; index < length; index++) if (exponent[index] !== 0xff) allOnes = false;
    if (allOnes) throw new DOMException("The RSA public exponent is too large", "OperationError");
  }
  return exponent;
}

function rsaRecord(record: CryptoKeyRecord, type: "public" | "private", modulusLength: number, exponent: Uint8Array): CryptoRsaKeyInfo {
  const info = record.info;
  if (info.family !== "RSA" || info.type !== type || info.modulusLength !== modulusLength
      || !equalBytes(info.publicExponent, exponent)) {
    throw new DOMException("The primitive returned inconsistent RSA key metadata", "OperationError");
  }
  return info;
}

/** §§20.9.3, 21.4.3, 22.4.3 and the common §14.3.6 private-usage check. */
export function generateRsaKey(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: readonly KeyUsage[],
): CryptoKeyPair {
  if (!(algorithm instanceof RsaHashedKeyGenParams)) throw new DOMException("Expected RSA generation parameters", "NotSupportedError");
  validateUsages(algorithm.name, "pair", usages);
  const publicExponent = generationExponent(algorithm);
  const pair = provider.generateKeyPair({ family: "RSA", modulusLength: algorithm.modulusLength, publicExponent });
  if ("failure" in pair) throw new DOMException("RSA key generation failed", "OperationError");
  rsaRecord(pair.publicKey, "public", algorithm.modulusLength, publicExponent);
  rsaRecord(pair.privateKey, "private", algorithm.modulusLength, publicExponent);
  const privateUsages = intersectUsages(algorithm.name, "private", usages);
  if (privateUsages.length === 0) throw new DOMException("A private key must have at least one usage", "SyntaxError");
  const keyAlgorithm = new RsaHashedKeyAlgorithm(algorithm.name, algorithm.modulusLength, publicExponent, algorithm.hash.name);
  const publicKey = createCryptoKey("public", true, keyAlgorithm, intersectUsages(algorithm.name, "public", usages), pair.publicKey.handle);
  const privateKey = createCryptoKey("private", extractable, keyAlgorithm, privateUsages, pair.privateKey.handle);
  return { privateKey, publicKey };
}

function jwkAlgorithm(name: string, hash: string): string {
  if (name === "RSA-OAEP") {
    switch (hash) {
      case "SHA-1": return "RSA-OAEP";
      case "SHA-256": return "RSA-OAEP-256";
      case "SHA-384": return "RSA-OAEP-384";
      case "SHA-512": return "RSA-OAEP-512";
    }
  } else {
    const prefix = name === "RSA-PSS" ? "PS" : "RS";
    switch (hash) {
      case "SHA-1": return prefix + "1";
      case "SHA-256": return prefix + "256";
      case "SHA-384": return prefix + "384";
      case "SHA-512": return prefix + "512";
    }
  }
  throw new DOMException("The RSA key hash is not supported", "NotSupportedError");
}

/** RFC 7517 §4.3: unknown key operations are allowed; duplicates are not. */
function jwkPolicy(jwk: JsonWebKey, algorithm: RsaHashedImportParams, extractable: boolean, usages: readonly KeyUsage[]): void {
  if (jwk.kty !== "RSA") throw new DOMException("The JWK is not an RSA key", "DataError");
  checkJwkPolicy(jwk, algorithm.name === "RSA-OAEP" ? "enc" : "sig", extractable, usages);
  if (jwk.alg !== undefined && jwk.alg !== jwkAlgorithm(algorithm.name, algorithm.hash.name)) {
    throw new DOMException("The JWK algorithm does not match the requested hash", "DataError");
  }
}

function jwkInteger(value: string | undefined): Uint8Array {
  if (value === undefined) throw new DOMException("An RSA JWK integer is missing", "DataError");
  const bytes = decodeBase64Url(value);
  // RFC 7518 §2 Base64urlUInt is an unsigned *minimal* octet representation.
  // All actual RSA key parameters below are strictly positive.
  if (cryptoViewByteLength(bytes) === 0 || bytes[0] === 0) throw new DOMException("An RSA JWK integer is not minimally encoded", "DataError");
  return bytes;
}

function jwkComponents(jwk: JsonWebKey): CryptoRsaComponents {
  const n = jwkInteger(jwk.n);
  const e = jwkInteger(jwk.e);
  if (jwk.d === undefined) return { family: "RSA", n, e };
  const d = jwkInteger(jwk.d);
  const anyCrt = jwk.p !== undefined || jwk.q !== undefined || jwk.dp !== undefined
    || jwk.dq !== undefined || jwk.qi !== undefined || jwk.oth !== undefined;
  if (!anyCrt) return { family: "RSA", n, e, d };
  const p = jwkInteger(jwk.p);
  const q = jwkInteger(jwk.q);
  const dp = jwkInteger(jwk.dp);
  const dq = jwkInteger(jwk.dq);
  const qi = jwkInteger(jwk.qi);
  if (jwk.oth === undefined) return { family: "RSA", n, e, d, p, q, dp, dq, qi };
  if (jwk.oth.length === 0) throw new DOMException("The RSA other-primes list is empty", "DataError");
  const oth: CryptoRsaOtherPrime[] = [];
  for (let index = 0; index < jwk.oth.length; index++) {
    const prime = jwk.oth[index]!;
    oth[index] = { r: jwkInteger(prime.r), d: jwkInteger(prime.d), t: jwkInteger(prime.t) };
  }
  return { family: "RSA", n, e, d, p, q, dp, dq, qi, oth };
}

function validatePublicComponents(components: CryptoRsaComponents): number {
  const modulusLength = bitLength(components.n);
  const exponentLength = cryptoViewByteLength(components.e);
  const modulusBytes = cryptoViewByteLength(components.n);
  if (modulusLength < 4 || exponentLength === 0 || (exponentLength === 1 && components.e[0]! < 3)
      || (components.e[exponentLength - 1]! & 1) === 0 || (components.n[modulusBytes - 1]! & 1) === 0
      || !lessThan(components.e, components.n)) {
    throw new DOMException("The RSA public key parameters are invalid", "DataError");
  }
  return modulusLength;
}

/** §§20.9.4, 21.4.4, 22.4.4. The provider sees validated DER or decoded integers. */
export function importRsaKey(
  provider: CryptoProvider,
  format: KeyFormat,
  data: Uint8Array | JsonWebKey,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: readonly KeyUsage[],
): CryptoKey {
  if (!(algorithm instanceof RsaHashedImportParams)) throw new DOMException("Expected RSA import parameters", "NotSupportedError");
  let type: "public" | "private";
  let components: CryptoRsaComponents;
  if (format === "spki" || format === "pkcs8") {
    type = format === "spki" ? "public" : "private";
    validateUsages(algorithm.name, type, usages);
    if (data instanceof JsonWebKey) throw new DOMException("Expected DER key bytes", "DataError");
    components = parseRsaDer(format, data);
  } else if (format === "jwk") {
    if (!(data instanceof JsonWebKey)) throw new DOMException("Expected an RSA JWK", "DataError");
    type = data.d === undefined ? "public" : "private";
    validateUsages(algorithm.name, type, usages);
    jwkPolicy(data, algorithm, extractable, usages);
    components = jwkComponents(data);
  } else {
    throw new DOMException("This RSA key format is not supported", "NotSupportedError");
  }
  const modulusLength = validatePublicComponents(components);
  const record = provider.importKey(format === "jwk"
    ? { format: "components", components }
    : { format, bytes: data as Uint8Array });
  if ("failure" in record) {
    throw new DOMException("The RSA key could not be imported", record.failure === "invalid-key" ? "DataError" : "OperationError");
  }
  rsaRecord(record, type, modulusLength, components.e);
  if (type === "private" && usages.length === 0) throw new DOMException("A private key must have at least one usage", "SyntaxError");
  return createCryptoKey(type, extractable,
    new RsaHashedKeyAlgorithm(algorithm.name, modulusLength, components.e, algorithm.hash.name),
    normalizeKeyUsages(usages), record.handle);
}

function exportedInteger(bytes: Uint8Array | undefined): string {
  if (bytes === undefined || cryptoViewByteLength(bytes) === 0 || bytes[0] === 0) {
    throw new DOMException("The native RSA components are incomplete or nonminimal", "OperationError");
  }
  return encodeBase64Url(bytes);
}

function exportJwk(components: CryptoRsaComponents, key: CryptoKeySlots): JsonWebKey {
  const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
  const jwk = new JsonWebKey();
  jwk.kty = "RSA";
  jwk.alg = jwkAlgorithm(algorithm.name, algorithm.hash.name);
  jwk.n = exportedInteger(components.n);
  jwk.e = exportedInteger(components.e);
  if (key.type === "private") {
    jwk.d = exportedInteger(components.d);
    jwk.p = exportedInteger(components.p);
    jwk.q = exportedInteger(components.q);
    jwk.dp = exportedInteger(components.dp);
    jwk.dq = exportedInteger(components.dq);
    jwk.qi = exportedInteger(components.qi);
    if (components.oth !== undefined) {
      if (components.oth.length === 0) throw new DOMException("The native RSA other-primes list is empty", "OperationError");
      jwk.oth = [];
      for (let index = 0; index < components.oth.length; index++) {
        const source = components.oth[index]!;
        const prime = new RsaOtherPrimesInfo();
        prime.r = exportedInteger(source.r);
        prime.d = exportedInteger(source.d);
        prime.t = exportedInteger(source.t);
        jwk.oth[index] = prime;
      }
    }
  }
  jwk.key_ops = [];
  for (let index = 0; index < key.usages.length; index++) jwk.key_ops[index] = key.usages[index]!;
  jwk.ext = key.extractable;
  return jwk;
}

/** §§20.9.5, 21.4.5, 22.4.5: inaccessible material precedes format/type policy. */
export function exportRsaKey(provider: CryptoProvider, format: KeyFormat, key: CryptoKeySlots): Uint8Array | JsonWebKey {
  const algorithm = key.algorithm as RsaHashedKeyAlgorithm;
  if (format === "jwk") {
    const components = provider.exportComponents(key.handle);
    if ("failure" in components || components.family !== "RSA") throw new DOMException("The RSA key cannot be exported", "OperationError");
    if (bitLength(components.n) !== algorithm.modulusLength || !equalBytes(components.e, algorithm.publicExponent)) {
      throw new DOMException("The native RSA components do not match their key", "OperationError");
    }
    return exportJwk(components, key);
  }
  // Even an unsupported format checks material accessibility first. Select the
  // actual key's encoding for that one native call, then apply requested policy.
  const nativeFormat = key.type === "public" ? "spki" : "pkcs8";
  const result = provider.exportKey(key.handle, nativeFormat);
  if ("failure" in result) throw new DOMException("The RSA key cannot be exported", "OperationError");
  if (format === "raw") throw new DOMException("Raw RSA export is not supported", "NotSupportedError");
  if (format !== nativeFormat) throw new DOMException("The RSA key type does not match the export format", "InvalidAccessError");
  try {
    const components = parseRsaDer(format, result, true);
    if (bitLength(components.n) !== algorithm.modulusLength || !equalBytes(components.e, algorithm.publicExponent)) {
      throw new DOMException("The native RSA encoding does not match its key", "OperationError");
    }
  } catch {
    throw new DOMException("The native RSA key encoding is invalid", "OperationError");
  }
  return result;
}
