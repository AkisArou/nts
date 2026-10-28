import { DOMException } from "../core/errors.ts";
import type { CryptoKeyRecord, CryptoOkpComponents, CryptoProvider } from "../provider/crypto.ts";
import type { NormalizedAlgorithm, OkpAlgorithmName } from "./algorithms.ts";
import { createCryptoKey, KeyAlgorithm } from "./crypto-key.ts";
import type { CryptoKey, CryptoKeyPair, CryptoKeySlots, KeyUsage } from "./crypto-key.ts";
import { parseOkpDer } from "./der.ts";
import { checkJwkPolicy, decodeBase64Url, encodeBase64Url, JsonWebKey, normalizeKeyUsages } from "./jwk.ts";
import type { KeyFormat } from "./jwk.ts";
import { isEdwardsCurve, okpCurveByteLength } from "./okp-curve.ts";

function okpName(name: string): OkpAlgorithmName {
  if (name === "Ed25519" || name === "X25519" || name === "Ed448" || name === "X448") return name;
  throw new DOMException("This octet key-pair algorithm is not supported", "NotSupportedError");
}

function usageAllowed(name: OkpAlgorithmName, type: "public" | "private" | "pair", usage: KeyUsage): boolean {
  if (!isEdwardsCurve(name)) return type !== "public" && (usage === "deriveKey" || usage === "deriveBits");
  return (type !== "private" && usage === "verify") || (type !== "public" && usage === "sign");
}

function validateUsages(name: OkpAlgorithmName, type: "public" | "private" | "pair", usages: readonly KeyUsage[]): void {
  for (let index = 0; index < usages.length; index++) {
    if (!usageAllowed(name, type, usages[index]!)) {
      throw new DOMException("The requested usage is not supported by this key", "SyntaxError");
    }
  }
}

function intersectUsages(name: OkpAlgorithmName, type: "public" | "private", usages: readonly KeyUsage[]): KeyUsage[] {
  const selected: KeyUsage[] = [];
  for (let index = 0; index < usages.length; index++) {
    const usage = usages[index]!;
    if (usageAllowed(name, type, usage)) selected[selected.length] = usage;
  }
  return normalizeKeyUsages(selected);
}

function okpRecord(record: CryptoKeyRecord, type: "public" | "private", name: OkpAlgorithmName): void {
  const info = record.info;
  if (info.family !== "OKP" || info.type !== type || info.namedCurve !== name) {
    throw new DOMException("The primitive returned inconsistent octet key-pair metadata", "OperationError");
  }
}

/** Web Cryptography §§25–26 / Secure Curves §§4, 6: name-only KeyAlgorithm. */
export function generateOkpKey(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: readonly KeyUsage[],
): CryptoKeyPair {
  const name = okpName(algorithm.name);
  validateUsages(name, "pair", usages);
  const pair = provider.generateKeyPair({ family: "OKP", namedCurve: name });
  if ("failure" in pair) throw new DOMException("Octet key-pair generation failed", "OperationError");
  okpRecord(pair.publicKey, "public", name);
  okpRecord(pair.privateKey, "private", name);
  const privateUsages = intersectUsages(name, "private", usages);
  if (privateUsages.length === 0) throw new DOMException("A private key must have at least one usage", "SyntaxError");
  const keyAlgorithm = new KeyAlgorithm(name);
  const publicKey = createCryptoKey("public", true, keyAlgorithm, intersectUsages(name, "public", usages), pair.publicKey.handle);
  const privateKey = createCryptoKey("private", extractable, keyAlgorithm, privateUsages, pair.privateKey.handle);
  return { privateKey, publicKey };
}

function jwkPolicy(jwk: JsonWebKey, name: OkpAlgorithmName, extractable: boolean, usages: readonly KeyUsage[]): void {
  if (jwk.kty !== "OKP") throw new DOMException("The JWK is not an octet key pair", "DataError");
  if (jwk.crv !== name) throw new DOMException("The JWK curve does not match the algorithm", "DataError");
  // The Edwards imports accept the fully specified name and its earlier JOSE
  // family name. X25519 and X448 have no algorithm-member check on import.
  if (isEdwardsCurve(name) && jwk.alg !== undefined && jwk.alg !== name && jwk.alg !== "EdDSA") {
    throw new DOMException("The JWK algorithm does not match the Edwards key", "DataError");
  }
  checkJwkPolicy(jwk, isEdwardsCurve(name) ? "sig" : "enc", extractable, usages);
}

function jwkOctets(value: string | undefined, name: OkpAlgorithmName): Uint8Array {
  if (value === undefined) throw new DOMException("An octet key-pair component is missing", "DataError");
  const bytes = decodeBase64Url(value);
  if (bytes.byteLength !== okpCurveByteLength(name)) throw new DOMException("An octet key-pair component has the wrong width", "DataError");
  return bytes;
}

function componentShape(components: CryptoOkpComponents, name: OkpAlgorithmName, privateKey: boolean): void {
  const width = okpCurveByteLength(name);
  if (components.namedCurve !== name || components.x.byteLength !== width
      || (privateKey && (components.d === undefined || components.d.byteLength !== width))) {
    throw new DOMException("The native octet key-pair components do not match their key", "OperationError");
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) if (left[index] !== right[index]) return false;
  return true;
}

function privatePublicMatches(provider: CryptoProvider, record: CryptoKeyRecord, supplied: CryptoOkpComponents, name: OkpAlgorithmName): void {
  if (supplied.d === undefined) return;
  const actual = provider.exportComponents(record.handle);
  if ("failure" in actual || actual.family !== "OKP") throw new DOMException("The private key cannot be inspected", "OperationError");
  componentShape(actual, name, true);
  if (actual.d === undefined || !equalBytes(actual.d, supplied.d)) {
    throw new DOMException("The primitive changed the imported private key bytes", "OperationError");
  }
  if (!equalBytes(actual.x, supplied.x)) {
    throw new DOMException("The JWK public key does not match its private key", "DataError");
  }
}

/**
 * Web Cryptography §§25.3.4, 26.3.3 and Secure Curves §§4.3, 6.4.
 * Every public value of the algorithm's encoded width is retained as supplied;
 * canonical, on-curve and small-order checks belong to the operation that uses it.
 * https://wicg.github.io/webcrypto-secure-curves/#ed448-operations
 */
export function importOkpKey(
  provider: CryptoProvider,
  format: KeyFormat,
  data: Uint8Array | JsonWebKey,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: readonly KeyUsage[],
): CryptoKey {
  const name = okpName(algorithm.name);
  if (format === "raw-secret") throw new DOMException("This asymmetric key format is not supported", "NotSupportedError");
  let type: "public" | "private";
  let components: CryptoOkpComponents | undefined;
  if (format === "jwk") {
    if (!(data instanceof JsonWebKey)) throw new DOMException("Expected an octet key-pair JWK", "DataError");
    type = data.d === undefined ? "public" : "private";
    validateUsages(name, type, usages);
    jwkPolicy(data, name, extractable, usages);
    const x = jwkOctets(data.x, name);
    components = data.d === undefined ? { family: "OKP", namedCurve: name, x }
      : { family: "OKP", namedCurve: name, x, d: jwkOctets(data.d, name) };
  } else {
    if (format !== "pkcs8" && format !== "spki" && format !== "raw") throw new DOMException("The key format is not supported", "NotSupportedError");
    type = format === "pkcs8" ? "private" : "public";
    validateUsages(name, type, usages);
    if (data instanceof JsonWebKey) throw new DOMException("Expected octet key-pair bytes", "DataError");
    if (format === "raw") {
      if (data.byteLength !== okpCurveByteLength(name)) throw new DOMException("The raw public key has the wrong encoded width", "DataError");
    } else if (parseOkpDer(format, data).namedCurve !== name) {
      throw new DOMException("The encoded algorithm does not match the requested key", "DataError");
    }
  }
  const record = provider.importKey(components !== undefined ? { format: "components", components }
    : format === "raw" ? { format, family: "OKP", namedCurve: name, bytes: data as Uint8Array }
      : { format: format as "spki" | "pkcs8", bytes: data as Uint8Array });
  if ("failure" in record) {
    throw new DOMException("The octet key pair could not be imported", record.failure === "invalid-key" ? "DataError" : "OperationError");
  }
  okpRecord(record, type, name);
  if (components !== undefined) privatePublicMatches(provider, record, components, name);
  if (type === "private" && usages.length === 0) throw new DOMException("A private key must have at least one usage", "SyntaxError");
  return createCryptoKey(type, extractable, new KeyAlgorithm(name), normalizeKeyUsages(usages), record.handle);
}

/** OKP exports: material-access errors precede export-format type errors. */
export function exportOkpKey(provider: CryptoProvider, format: KeyFormat, key: CryptoKeySlots): Uint8Array | JsonWebKey {
  const name = okpName(key.algorithm.name);
  if (format === "jwk") {
    const components = provider.exportComponents(key.handle);
    if ("failure" in components || components.family !== "OKP") throw new DOMException("The key cannot be exported", "OperationError");
    componentShape(components, name, key.type === "private");
    const jwk = new JsonWebKey();
    jwk.kty = "OKP";
    jwk.crv = name;
    if (isEdwardsCurve(name)) jwk.alg = name;
    jwk.x = encodeBase64Url(components.x);
    if (key.type === "private") jwk.d = encodeBase64Url(components.d!);
    jwk.key_ops = [];
    for (let index = 0; index < key.usages.length; index++) jwk.key_ops[index] = key.usages[index]!;
    jwk.ext = key.extractable;
    return jwk;
  }
  const unsupported = format !== "raw" && format !== "spki" && format !== "pkcs8";
  const nativeFormat = key.type === "private" ? "pkcs8" : format === "raw" ? "raw" : "spki";
  const result = provider.exportKey(key.handle, nativeFormat);
  if ("failure" in result) throw new DOMException("The key cannot be exported", "OperationError");
  if (unsupported) throw new DOMException("The key format is not supported", "NotSupportedError");
  if (format !== nativeFormat) throw new DOMException("The key type does not match the export format", "InvalidAccessError");
  try {
    if (format === "raw") {
      if (result.byteLength !== okpCurveByteLength(name)) throw new DOMException("The native public key has the wrong width", "OperationError");
    } else if (parseOkpDer(format, result).namedCurve !== name) {
      throw new DOMException("The native key encoding has the wrong algorithm", "OperationError");
    }
  } catch {
    throw new DOMException("The native key encoding is invalid", "OperationError");
  }
  return result;
}
