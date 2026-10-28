import { DOMException } from "../core/errors.ts";
import type { CryptoEcComponents, CryptoKeyRecord, CryptoNamedCurve, CryptoProvider } from "../provider/crypto.ts";
import { EcKeyGenParams, EcKeyImportParams } from "./algorithms.ts";
import type { EcAlgorithmName, NormalizedAlgorithm } from "./algorithms.ts";
import { cryptoViewByteLength } from "./buffer-source.ts";
import { createCryptoKey, KeyAlgorithm } from "./crypto-key.ts";
import type { CryptoKey, CryptoKeyPair, CryptoKeySlots, KeyAlgorithmObject, KeyUsage } from "./crypto-key.ts";
import { parseEcDer, parseEcPoint } from "./der.ts";
import type { EcDerKey } from "./der.ts";
import { ecCurveByteLength } from "./ec-curve.ts";
import { checkJwkPolicy, decodeBase64Url, encodeBase64Url, JsonWebKey, normalizeKeyUsages } from "./jwk.ts";
import type { KeyFormat } from "./jwk.ts";

interface EcKeyAlgorithmObject extends KeyAlgorithmObject {
  namedCurve: CryptoNamedCurve;
}

/** Web Cryptography §23.5: the curve belongs to the key; the signing hash does not. */
export class EcKeyAlgorithm extends KeyAlgorithm {
  readonly namedCurve: CryptoNamedCurve;

  constructor(name: EcAlgorithmName, namedCurve: CryptoNamedCurve) {
    super(name);
    this.namedCurve = namedCurve;
  }

  override copy(): EcKeyAlgorithm {
    return new EcKeyAlgorithm(this.name as EcAlgorithmName, this.namedCurve);
  }

  override toObject(): EcKeyAlgorithmObject {
    return { name: this.name, namedCurve: this.namedCurve };
  }
}

function supportedCurve(namedCurve: string): CryptoNamedCurve {
  if (namedCurve === "P-256" || namedCurve === "P-384" || namedCurve === "P-521") return namedCurve;
  throw new DOMException("This elliptic curve is not supported", "NotSupportedError");
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  const length = cryptoViewByteLength(left);
  if (length !== cryptoViewByteLength(right)) return false;
  for (let index = 0; index < length; index++) if (left[index] !== right[index]) return false;
  return true;
}

function usageAllowed(name: string, type: "public" | "private" | "pair", usage: KeyUsage): boolean {
  if (name === "ECDH") return type !== "public" && (usage === "deriveKey" || usage === "deriveBits");
  return (type !== "private" && usage === "verify") || (type !== "public" && usage === "sign");
}

function validateUsages(name: string, type: "public" | "private" | "pair", usages: readonly KeyUsage[]): void {
  for (let index = 0; index < usages.length; index++) {
    if (!usageAllowed(name, type, usages[index]!)) {
      throw new DOMException("The requested usage is not supported by this EC key", "SyntaxError");
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

function ecRecord(record: CryptoKeyRecord, type: "public" | "private", namedCurve: CryptoNamedCurve): void {
  const info = record.info;
  if (info.family !== "EC" || info.type !== type || info.namedCurve !== namedCurve) {
    throw new DOMException("The primitive returned inconsistent EC key metadata", "OperationError");
  }
}

/** §§23.7.3, 24.4.1 and §14.3.6's final private-key usage check. */
export function generateEcKey(
  provider: CryptoProvider,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: readonly KeyUsage[],
): CryptoKeyPair {
  if (!(algorithm instanceof EcKeyGenParams)) throw new DOMException("Expected EC generation parameters", "NotSupportedError");
  validateUsages(algorithm.name, "pair", usages);
  const namedCurve = supportedCurve(algorithm.namedCurve);
  const pair = provider.generateKeyPair({ family: "EC", namedCurve });
  if ("failure" in pair) throw new DOMException("EC key generation failed", "OperationError");
  ecRecord(pair.publicKey, "public", namedCurve);
  ecRecord(pair.privateKey, "private", namedCurve);
  const privateUsages = intersectUsages(algorithm.name, "private", usages);
  if (privateUsages.length === 0) throw new DOMException("A private key must have at least one usage", "SyntaxError");
  const keyAlgorithm = new EcKeyAlgorithm(algorithm.name, namedCurve);
  const publicKey = createCryptoKey("public", true, keyAlgorithm, intersectUsages(algorithm.name, "public", usages), pair.publicKey.handle);
  const privateKey = createCryptoKey("private", extractable, keyAlgorithm, privateUsages, pair.privateKey.handle);
  return { privateKey, publicKey };
}

/** RFC 7517 §4.3: unknown operations are permitted; duplicate/inconsistent ones are not. */
function jwkPolicy(jwk: JsonWebKey, name: EcAlgorithmName, namedCurve: CryptoNamedCurve, extractable: boolean, usages: readonly KeyUsage[]): void {
  if (jwk.kty !== "EC") throw new DOMException("The JWK is not an EC key", "DataError");
  checkJwkPolicy(jwk, name === "ECDSA" ? "sig" : "enc", extractable, usages);
  if (jwk.crv !== namedCurve) throw new DOMException("The JWK curve does not match the requested curve", "DataError");
  // ECDSA binds alg to the curve; ECDH has no corresponding alg restriction.
  if (name === "ECDSA" && jwk.alg !== undefined) {
    const expected = namedCurve === "P-256" ? "ES256" : namedCurve === "P-384" ? "ES384" : "ES512";
    if (jwk.alg !== expected) throw new DOMException("The JWK algorithm does not match its curve", "DataError");
  }
}

function jwkOctets(value: string | undefined, namedCurve: CryptoNamedCurve): Uint8Array {
  if (value === undefined) throw new DOMException("An EC JWK component is missing", "DataError");
  const bytes = decodeBase64Url(value);
  if (cryptoViewByteLength(bytes) !== ecCurveByteLength(namedCurve)) {
    throw new DOMException("An EC JWK component has the wrong width", "DataError");
  }
  return bytes;
}

function jwkComponents(jwk: JsonWebKey, namedCurve: CryptoNamedCurve): CryptoEcComponents {
  const x = jwkOctets(jwk.x, namedCurve);
  const y = jwkOctets(jwk.y, namedCurve);
  return jwk.d === undefined ? { family: "EC", namedCurve, x, y }
    : { family: "EC", namedCurve, x, y, d: jwkOctets(jwk.d, namedCurve) };
}

function componentWidths(components: CryptoEcComponents, namedCurve: CryptoNamedCurve, privateKey: boolean): void {
  const width = ecCurveByteLength(namedCurve);
  if (components.namedCurve !== namedCurve || cryptoViewByteLength(components.x) !== width
      || cryptoViewByteLength(components.y) !== width
      || (privateKey && (components.d === undefined || cryptoViewByteLength(components.d) !== width))) {
    throw new DOMException("The native EC components do not match their key", "OperationError");
  }
}

function privatePointMatches(provider: CryptoProvider, record: CryptoKeyRecord, encoded: EcDerKey | CryptoEcComponents): void {
  if (encoded.d === undefined || encoded.x === undefined || encoded.y === undefined) return;
  // Import obtains a mathematical private key. A supplied public point remains
  // format policy: compare it with the point native code computes from d.
  const actual = provider.exportComponents(record.handle);
  if ("failure" in actual || actual.family !== "EC") throw new DOMException("The EC private key cannot be inspected", "OperationError");
  componentWidths(actual, encoded.namedCurve, true);
  if (actual.d === undefined || !equalBytes(actual.d, encoded.d)) {
    throw new DOMException("The primitive changed the EC private scalar", "OperationError");
  }
  if (!equalBytes(actual.x, encoded.x) || !equalBytes(actual.y, encoded.y)) {
    throw new DOMException("The EC public point does not match its private scalar", "DataError");
  }
}

/** §§23.7.4 and 24.4.3: original encodings are validated before native import. */
export function importEcKey(
  provider: CryptoProvider,
  format: KeyFormat,
  data: Uint8Array | JsonWebKey,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: readonly KeyUsage[],
): CryptoKey {
  if (!(algorithm instanceof EcKeyImportParams)) throw new DOMException("Expected EC import parameters", "NotSupportedError");
  const namedCurve = supportedCurve(algorithm.namedCurve);
  if (format === "raw-secret") throw new DOMException("This asymmetric key format is not supported", "NotSupportedError");
  let type: "public" | "private";
  let encoded: EcDerKey | CryptoEcComponents;
  if (format === "jwk") {
    if (!(data instanceof JsonWebKey)) throw new DOMException("Expected an EC JWK", "DataError");
    type = data.d === undefined ? "public" : "private";
    validateUsages(algorithm.name, type, usages);
    jwkPolicy(data, algorithm.name, namedCurve, extractable, usages);
    encoded = jwkComponents(data, namedCurve);
  } else {
    if (format !== "pkcs8" && format !== "spki" && format !== "raw") throw new DOMException("The key format is not supported", "NotSupportedError");
    type = format === "pkcs8" ? "private" : "public";
    validateUsages(algorithm.name, type, usages);
    if (data instanceof JsonWebKey) throw new DOMException("Expected EC key bytes", "DataError");
    encoded = format === "raw" ? parseEcPoint(data, namedCurve) : parseEcDer(format, data);
    if (encoded.namedCurve !== namedCurve) throw new DOMException("The encoded EC curve does not match the requested curve", "DataError");
  }
  const record = provider.importKey(format === "jwk"
    ? { format: "components", components: encoded as CryptoEcComponents }
    : format === "raw" ? { format, family: "EC", namedCurve, bytes: data as Uint8Array }
      : { format, bytes: data as Uint8Array });
  if ("failure" in record) {
    throw new DOMException("The EC key could not be imported", record.failure === "invalid-key" ? "DataError" : "OperationError");
  }
  ecRecord(record, type, namedCurve);
  privatePointMatches(provider, record, encoded);
  if (type === "private" && usages.length === 0) throw new DOMException("A private key must have at least one usage", "SyntaxError");
  return createCryptoKey(type, extractable, new EcKeyAlgorithm(algorithm.name, namedCurve), normalizeKeyUsages(usages), record.handle);
}

function exportJwk(components: CryptoEcComponents, key: CryptoKeySlots): JsonWebKey {
  const algorithm = key.algorithm as EcKeyAlgorithm;
  componentWidths(components, algorithm.namedCurve, key.type === "private");
  const jwk = new JsonWebKey();
  jwk.kty = "EC";
  jwk.crv = algorithm.namedCurve;
  jwk.x = encodeBase64Url(components.x);
  jwk.y = encodeBase64Url(components.y);
  if (key.type === "private") jwk.d = encodeBase64Url(components.d!);
  jwk.key_ops = [];
  for (let index = 0; index < key.usages.length; index++) jwk.key_ops[index] = key.usages[index]!;
  jwk.ext = key.extractable;
  return jwk;
}

/** §§23.7.5 and 24.4.4: material access precedes format/type checks. */
export function exportEcKey(provider: CryptoProvider, format: KeyFormat, key: CryptoKeySlots): Uint8Array | JsonWebKey {
  const algorithm = key.algorithm as EcKeyAlgorithm;
  if (format === "jwk") {
    const components = provider.exportComponents(key.handle);
    if ("failure" in components || components.family !== "EC") throw new DOMException("The EC key cannot be exported", "OperationError");
    return exportJwk(components, key);
  }
  const unsupported = format !== "raw" && format !== "spki" && format !== "pkcs8";
  const nativeFormat = key.type === "private" ? "pkcs8" : format === "raw" ? "raw" : "spki";
  const result = provider.exportKey(key.handle, nativeFormat);
  if ("failure" in result) throw new DOMException("The EC key cannot be exported", "OperationError");
  if (unsupported) throw new DOMException("The key format is not supported", "NotSupportedError");
  if (format !== nativeFormat) throw new DOMException("The EC key type does not match the export format", "InvalidAccessError");
  try {
    const encoded = format === "raw" ? parseEcPoint(result, algorithm.namedCurve) : parseEcDer(format, result, true);
    if (encoded.namedCurve !== algorithm.namedCurve) throw new DOMException("The native EC encoding has the wrong curve", "OperationError");
  } catch {
    throw new DOMException("The native EC key encoding is invalid", "OperationError");
  }
  return result;
}
