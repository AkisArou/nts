// Web Crypto's `Crypto` and `SubtleCrypto`, from node v24.20.0
// `lib/internal/crypto/webcrypto.js`.
//
// Each method converts its arguments as Web IDL says, normalizes its
// algorithm, checks the key, and hands the work to the algorithm's family --
// the switch statements are node's, so each case reads against upstream's.
// A family not yet ported is not in the registry (`util.ts`), so
// normalization rejects its name before any switch sees it.
//
// Every method answers a promise, made from its job at the end
// (`callSubtleCryptoMethod`). Node installs the methods as enumerable
// functions; that descriptor, like the classes' `toStringTag`s, is metadata
// `shape.mjs` applies.

import { isUtf8 } from "../../../buffer/src/main.ts";
import { domException, domExceptionWithCause } from "../../../internal/dom-exception.ts";
import { ERR_ENCODING_INVALID_ENCODED_DATA, ERR_ILLEGAL_CONSTRUCTOR, ERR_INVALID_THIS } from "../../../internal/errors.ts";
import { utf8Decode, utf8Length, utf8Write } from "../../../internal/utf8.ts";
import { emitExperimentalWarning } from "../../../internal/process-warning.ts";
import { convertBoolean, convertDOMString, convertUnsignedLong, type ConversionOptions } from "../../../internal/webidl.ts";
import { getRandomValues as fillRandomValues, randomUUID as newRandomUUID } from "../random.ts";
import { asymmetricHandle, exportJwkOf, type KeyObjectHandle, type KeyObjectType, webCryptoHooks } from "../keys.ts";
import { base64urlOf } from "../util.ts";
import { aesCipher, aesGenerateKey, aesImportKey, getAlgorithmName } from "./aes.ts";
import { c20pCipher, c20pGenerateKey, c20pImportKey } from "./chacha20-poly1305.ts";
import { cfrgExportKey, cfrgGenerateKey, cfrgImportKey, ecdhDeriveBits, eddsaSignVerify } from "./cfrg.ts";
import { asyncDigest } from "./digest.ts";
import { ecdsaSignVerify, ecExportKey, ecGenerateKey, ecImportKey } from "./ec.ts";
import {
  argon2DeriveBits,
  hkdfDeriveBits,
  pbkdf2DeriveBits,
  validateArgon2DeriveBitsLength,
  validateDeriveBitsLength,
} from "./kdf.ts";
import {
  type EncapsulatedBits,
  mlDsaSignVerify,
  mlKemDecapsulate,
  mlKemEncapsulate,
  pqcExportKey,
  pqcGenerateKey,
  pqcImportKey,
} from "./pqc.ts";
import { rsaExportKey, rsaImportKey, rsaJwkAlgorithm, rsaKeyGenerate, rsaOaepCipher, rsaSignVerify } from "./rsa.ts";
import {
  type CryptoKey,
  getCryptoKeyAlgorithm,
  getCryptoKeyExtractable,
  getCryptoKeyHandle,
  getCryptoKeyType,
  getCryptoKeyUsages,
  getCryptoKeyUsagesMask,
  hasCryptoKeyUsage,
} from "./key.ts";
import { hmacGenerateKey, hmacJwkAlgorithm, hmacSignVerify, kmacGenerateKey, kmacSignVerify, macImportKey } from "./mac.ts";
import {
  bytesOfSource,
  callSubtleCryptoMethod,
  getBlockSize,
  type Job,
  mapJob,
  type NormalizedAlgorithm,
  normalizeAlgorithm,
  numBitsToBytes,
  type Operation,
  resolvedJob,
  validateMaxBufferLength,
} from "./util.ts";
import { importGenericSecretKey, type JsonWebKey, type KeyData } from "./webcrypto-util.ts";
import {
  convertAlgorithmIdentifier,
  convertBufferSource,
  convertCryptoKey,
  convertJsonWebKey,
  convertKeyFormat,
  convertKeyUsages,
  requiredArguments,
} from "./webidl.ts";

type BufferSource = ArrayBuffer | ArrayBufferView;
type AlgorithmIdentifier = object | string;

const kArgumentContexts = [
  "1st argument",
  "2nd argument",
  "3rd argument",
  "4th argument",
  "5th argument",
  "6th argument",
  "7th argument",
];

/** Node's `prepareSubtleMethod`: the receiver, then the argument count. */
function prepareSubtleMethod(receiver: unknown, method: string, argumentCount: number, required: number): string {
  if (receiver !== subtle) throw new ERR_INVALID_THIS("SubtleCrypto");
  const prefix = `Failed to execute '${method}' on 'SubtleCrypto'`;
  requiredArguments(argumentCount, required, { prefix });
  return prefix;
}

/** The options each argument converts under: the method's prefix, and which argument it is. */
function argument(prefix: string, index: number): ConversionOptions {
  return { prefix, context: kArgumentContexts[index] };
}

/** A family the registry admitted and no switch handles: node's `assert.fail('Unreachable code')`. */
function unreachable(): Error {
  return new Error("Unreachable code");
}

// -- the operations -------------------------------------------------------------------

function generateKeyFor(algorithm: NormalizedAlgorithm, extractable: boolean, usages: string[]): Job<unknown> {
  switch (algorithm.name) {
    case "RSASSA-PKCS1-v1_5":
    case "RSA-PSS":
    case "RSA-OAEP":
      return rsaKeyGenerate(algorithm, extractable, usages);
    case "Ed25519":
    case "Ed448":
    case "X25519":
    case "X448":
      return cfrgGenerateKey(algorithm, extractable, usages);
    case "ECDSA":
    case "ECDH":
      return ecGenerateKey(algorithm, extractable, usages);
    case "ChaCha20-Poly1305":
      return c20pGenerateKey(algorithm, extractable, usages);
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
    case "ML-KEM-512":
    case "ML-KEM-768":
    case "ML-KEM-1024":
      return pqcGenerateKey(algorithm, extractable, usages);
    case "HMAC":
      return hmacGenerateKey(algorithm, extractable, usages);
    case "KMAC128":
    case "KMAC256":
      return kmacGenerateKey(algorithm, extractable, usages);
    case "AES-CTR":
    case "AES-CBC":
    case "AES-GCM":
    case "AES-OCB":
    case "AES-KW":
      return aesGenerateKey(algorithm, extractable, usages);
    default:
      throw unreachable();
  }
}

/** The bits each key-derivation family derives; node's two switches, shared. */
function deriveBitsFor(algorithm: NormalizedAlgorithm, key: CryptoKey, length: number | null | undefined): Job<ArrayBuffer> {
  switch (algorithm.name) {
    case "X25519":
    case "X448":
    case "ECDH":
      return ecdhDeriveBits(algorithm, key, length);
    case "HKDF":
      return hkdfDeriveBits(algorithm, key, length);
    case "PBKDF2":
      return pbkdf2DeriveBits(algorithm, key, length);
    case "Argon2d":
    case "Argon2i":
    case "Argon2id":
      return argon2DeriveBits(algorithm, key, length);
    default:
      throw unreachable();
  }
}

/** Node's `getKeyLength`: the bits a derived key of this algorithm takes, or null for a derivation key. */
function getKeyLength(algorithm: NormalizedAlgorithm): number | null | undefined {
  const { name, length, hash } = algorithm;
  switch (name) {
    case "AES-CTR":
    case "AES-CBC":
    case "AES-GCM":
    case "AES-OCB":
    case "AES-KW":
      if (length !== 128 && length !== 192 && length !== 256) throw domException("Invalid key length", "OperationError");
      return length;
    case "HMAC":
      if (length === undefined) return getBlockSize(hash!.name);
      if (typeof length === "number" && length !== 0) return length;
      throw domException("Invalid key length", "OperationError");
    case "KMAC128":
    case "KMAC256":
      if (typeof length === "number") return length;
      return name === "KMAC128" ? 128 : 256;
    case "HKDF":
    case "PBKDF2":
    case "Argon2d":
    case "Argon2i":
    case "Argon2id":
      return null;
    case "ChaCha20-Poly1305":
      return 256;
    default:
      return undefined;
  }
}

function exportKeySpki(key: CryptoKey): ArrayBuffer | undefined {
  switch (getCryptoKeyAlgorithm(key).name) {
    case "RSASSA-PKCS1-v1_5":
    case "RSA-PSS":
    case "RSA-OAEP":
      return rsaExportKey(key, "spki");
    case "ECDSA":
    case "ECDH":
      return ecExportKey(key, "spki");
    case "Ed25519":
    case "Ed448":
    case "X25519":
    case "X448":
      return cfrgExportKey(key, "spki");
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
    case "ML-KEM-512":
    case "ML-KEM-768":
    case "ML-KEM-1024":
      return pqcExportKey(key, "spki");
    default:
      return undefined;
  }
}

function exportKeyPkcs8(key: CryptoKey): ArrayBuffer | undefined {
  switch (getCryptoKeyAlgorithm(key).name) {
    case "RSASSA-PKCS1-v1_5":
    case "RSA-PSS":
    case "RSA-OAEP":
      return rsaExportKey(key, "pkcs8");
    case "ECDSA":
    case "ECDH":
      return ecExportKey(key, "pkcs8");
    case "Ed25519":
    case "Ed448":
    case "X25519":
    case "X448":
      return cfrgExportKey(key, "pkcs8");
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
    case "ML-KEM-512":
    case "ML-KEM-768":
    case "ML-KEM-1024":
      return pqcExportKey(key, "pkcs8");
    default:
      return undefined;
  }
}

function exportKeyRawPublic(key: CryptoKey, format: string): ArrayBuffer | undefined {
  switch (getCryptoKeyAlgorithm(key).name) {
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
    case "ML-KEM-512":
    case "ML-KEM-768":
    case "ML-KEM-1024":
      // ML-DSA and ML-KEM keys do not recognize "raw".
      return format === "raw-public" ? pqcExportKey(key, "raw") : undefined;
    case "ECDSA":
    case "ECDH":
      return ecExportKey(key, "raw");
    case "Ed25519":
    case "Ed448":
    case "X25519":
    case "X448":
      return cfrgExportKey(key, "raw");
    default:
      return undefined;
  }
}

function exportKeyRawSeed(key: CryptoKey): ArrayBuffer | undefined {
  switch (getCryptoKeyAlgorithm(key).name) {
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
    case "ML-KEM-512":
    case "ML-KEM-768":
    case "ML-KEM-1024":
      return pqcExportKey(key, "raw");
    default:
      return undefined;
  }
}

function exportKeyRawSecret(key: CryptoKey, format: string): ArrayBuffer | undefined {
  switch (getCryptoKeyAlgorithm(key).name) {
    case "AES-CTR":
    case "AES-CBC":
    case "AES-GCM":
    case "AES-KW":
    case "HMAC":
      return getCryptoKeyHandle(key).bytes.slice().buffer;
    case "AES-OCB":
    case "KMAC128":
    case "KMAC256":
    case "ChaCha20-Poly1305":
      return format === "raw-secret" ? getCryptoKeyHandle(key).bytes.slice().buffer : undefined;
    default:
      return undefined;
  }
}

/**
 * Node's `exportKeyJWK`: `key_ops`, `ext` and `alg`, then the key's own
 * members, all defined rather than assigned -- so no inherited setter sees
 * the object, as node's native export defines its members.
 */
function exportKeyJWK(key: CryptoKey): JsonWebKey | undefined {
  const algorithm = getCryptoKeyAlgorithm(key);
  let alg: string | undefined;
  switch (algorithm.name) {
    case "RSASSA-PKCS1-v1_5":
    case "RSA-PSS":
    case "RSA-OAEP":
      alg = rsaJwkAlgorithm(algorithm.name, algorithm.hash!.name);
      break;
    case "ECDSA":
    case "ECDH":
    case "X25519":
    case "X448":
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
    case "ML-KEM-512":
    case "ML-KEM-768":
    case "ML-KEM-1024":
      break;
    case "ChaCha20-Poly1305":
      alg = "C20P";
      break;
    case "Ed25519":
    case "Ed448":
      alg = algorithm.name;
      break;
    case "AES-CTR":
    case "AES-CBC":
    case "AES-GCM":
    case "AES-OCB":
    case "AES-KW":
      alg = getAlgorithmName(algorithm.name, algorithm.length);
      break;
    case "HMAC":
      alg = hmacJwkAlgorithm(algorithm.hash!.name);
      break;
    case "KMAC128":
      alg = "K128";
      break;
    case "KMAC256":
      alg = "K256";
      break;
    default:
      return undefined;
  }
  const type = getCryptoKeyType(key);
  const handle = getCryptoKeyHandle(key);
  const material: JsonWebKey =
    type === "secret" ? { kty: "oct", k: base64urlOf(handle.bytes) } : exportJwkOf(handle.native, type === "private");
  const keyOps = getCryptoKeyUsages(key).slice();
  const ext = getCryptoKeyExtractable(key);
  // Without an `alg` of its own the key's members follow `ext` directly: an
  // AKP key's `alg` is one of them, and comes after its `priv` and `kty`.
  return alg === undefined ? { key_ops: keyOps, ext, ...material } : { key_ops: keyOps, ext, alg, ...material };
}

/** Node's `exportKeySync`. */
function exportKeySync(format: string, key: CryptoKey): ArrayBuffer | JsonWebKey {
  const algorithm = getCryptoKeyAlgorithm(key);
  try {
    normalizeAlgorithm(algorithm, "exportKey");
  } catch {
    throw domException(`${algorithm.name} key export is not supported`, "NotSupportedError");
  }
  if (!getCryptoKeyExtractable(key)) throw domException("key is not extractable", "InvalidAccessError");
  const type = getCryptoKeyType(key);
  let result: ArrayBuffer | JsonWebKey | undefined;
  switch (format) {
    case "spki":
      if (type === "public") result = exportKeySpki(key);
      break;
    case "pkcs8":
      if (type === "private") result = exportKeyPkcs8(key);
      break;
    case "jwk":
      result = exportKeyJWK(key);
      break;
    case "raw-secret":
      if (type === "secret") result = exportKeyRawSecret(key, format);
      break;
    case "raw-public":
      if (type === "public") result = exportKeyRawPublic(key, format);
      break;
    case "raw-seed":
      if (type === "private") result = exportKeyRawSeed(key);
      break;
    case "raw":
      if (type === "secret") result = exportKeyRawSecret(key, format);
      else if (type === "public") result = exportKeyRawPublic(key, format);
      break;
  }
  if (!result) {
    throw domException(`Unable to export ${algorithm.name} ${type} key using ${format} format`, "NotSupportedError");
  }
  return result;
}

/** Node's `importKeySync`: the family's import, then the check that a secret or private key has usages. */
function importKeySync(
  format: string,
  keyData: KeyData,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: string[],
): CryptoKey {
  let result: CryptoKey | undefined;
  switch (algorithm.name) {
    case "RSASSA-PKCS1-v1_5":
    case "RSA-PSS":
    case "RSA-OAEP":
      result = rsaImportKey(format, keyData, algorithm, extractable, usages);
      break;
    case "ECDSA":
    case "ECDH":
      result = ecImportKey(aliasKeyFormat(format, "raw-public"), keyData, algorithm, extractable, usages);
      break;
    case "Ed25519":
    case "Ed448":
    case "X25519":
    case "X448":
      result = cfrgImportKey(aliasKeyFormat(format, "raw-public"), keyData, algorithm, extractable, usages);
      break;
    case "HMAC":
    case "KMAC128":
    case "KMAC256":
      result = macImportKey(format, keyData, algorithm, extractable, usages);
      break;
    case "AES-CTR":
    case "AES-CBC":
    case "AES-GCM":
    case "AES-KW":
    case "AES-OCB":
      result = aesImportKey(algorithm, format, keyData, extractable, usages);
      break;
    case "ChaCha20-Poly1305":
      result = c20pImportKey(algorithm, format, keyData, extractable, usages);
      break;
    case "HKDF":
    case "PBKDF2":
      result = importGenericSecretKey(algorithm, aliasKeyFormat(format, "raw-secret"), keyData, extractable, usages);
      break;
    case "Argon2d":
    case "Argon2i":
    case "Argon2id":
      if (format === "raw-secret") result = importGenericSecretKey(algorithm, format, keyData, extractable, usages);
      break;
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
    case "ML-KEM-512":
    case "ML-KEM-768":
    case "ML-KEM-1024":
      result = pqcImportKey(format, keyData, algorithm, extractable, usages);
      break;
  }
  if (!result) throw domException(`Unable to import ${algorithm.name} using ${format} format`, "NotSupportedError");
  const type = getCryptoKeyType(result);
  if ((type === "secret" || type === "private") && getCryptoKeyUsagesMask(result) === 0) {
    throw domException(`Usages cannot be empty when importing a ${type} key.`, "SyntaxError");
  }
  return result;
}

/** Node's `toCryptoKeySecret`: a secret key object's material, imported by its family. */
function toCryptoKeySecret(
  handle: KeyObjectHandle,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: string[],
): CryptoKey {
  const keyData = { handle, type: "secret" as KeyObjectType };
  let result: CryptoKey | undefined;
  switch (algorithm.name) {
    case "HMAC":
    case "KMAC128":
    case "KMAC256":
      result = macImportKey("KeyObjectHandle", keyData, algorithm, extractable, usages);
      break;
    case "AES-CTR":
    case "AES-CBC":
    case "AES-GCM":
    case "AES-KW":
    case "AES-OCB":
      result = aesImportKey(algorithm, "KeyObjectHandle", keyData, extractable, usages);
      break;
    case "ChaCha20-Poly1305":
      result = c20pImportKey(algorithm, "KeyObjectHandle", keyData, extractable, usages);
      break;
    case "HKDF":
    case "PBKDF2":
    case "Argon2d":
    case "Argon2i":
    case "Argon2id":
      result = importGenericSecretKey(algorithm, "KeyObjectHandle", keyData, extractable, usages);
      break;
    default:
      throw domException("Unrecognized algorithm name", "NotSupportedError");
  }
  if (getCryptoKeyUsagesMask(result!) === 0) {
    throw domException(`Usages cannot be empty when importing a ${getCryptoKeyType(result!)} key.`, "SyntaxError");
  }
  return result!;
}

/** Node's `toCryptoKey`: an asymmetric key's material, imported by its family with its checks. */
function toCryptoKey(
  handle: KeyObjectHandle,
  type: KeyObjectType,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: string[],
): CryptoKey {
  const keyData = { handle, type };
  let result: CryptoKey | undefined;
  switch (algorithm.name) {
    case "RSASSA-PKCS1-v1_5":
    case "RSA-PSS":
    case "RSA-OAEP":
      result = rsaImportKey("KeyObjectHandle", keyData, algorithm, extractable, usages);
      break;
    case "ECDSA":
    case "ECDH":
      result = ecImportKey("KeyObjectHandle", keyData, algorithm, extractable, usages);
      break;
    case "Ed25519":
    case "Ed448":
    case "X25519":
    case "X448":
      result = cfrgImportKey("KeyObjectHandle", keyData, algorithm, extractable, usages);
      break;
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
    case "ML-KEM-512":
    case "ML-KEM-768":
    case "ML-KEM-1024":
      result = pqcImportKey("KeyObjectHandle", keyData, algorithm, extractable, usages);
      break;
    default:
      throw domException("Unrecognized algorithm name", "NotSupportedError");
  }
  if (getCryptoKeyType(result!) === "private" && getCryptoKeyUsagesMask(result!) === 0) {
    throw domException("Usages cannot be empty when importing a private key.", "SyntaxError");
  }
  return result!;
}

/**
 * Node's `toPublicCryptoKey`: a private key's public half, extractable, under
 * the same algorithm. Its handle holds the same key, as node's public handle
 * made from a private one does.
 */
function toPublicCryptoKey(key: CryptoKey, usages: string[]): CryptoKey {
  const handle = asymmetricHandle(getCryptoKeyHandle(key).native);
  return toCryptoKey(handle, "public", getCryptoKeyAlgorithm(key) as NormalizedAlgorithm, true, usages);
}

// `KeyObject#toCryptoKey`, which `keys.ts` reaches through this hook.
webCryptoHooks.toCryptoKey = (type, handle, algorithm, extractable, keyUsages) => {
  const normalized = normalizeAlgorithm(convertAlgorithmIdentifier(algorithm), "importKey");
  const isExtractable = convertBoolean(extractable);
  const usages = convertKeyUsages(keyUsages);
  return type === "secret"
    ? toCryptoKeySecret(handle, normalized, isExtractable, usages)
    : toCryptoKey(handle, type, normalized, isExtractable, usages);
};

function signVerify(
  algorithm: AlgorithmIdentifier,
  key: CryptoKey,
  data: BufferSource,
  signature?: BufferSource,
): Job<ArrayBuffer | boolean> {
  const operation = signature !== undefined ? "verify" : "sign";
  const normalized = normalizeAlgorithm(algorithm, operation);
  if (normalized.name !== getCryptoKeyAlgorithm(key).name) throw domException("Key algorithm mismatch", "InvalidAccessError");
  if (!hasCryptoKeyUsage(key, operation)) throw domException(`Unable to use this key to ${operation}`, "InvalidAccessError");
  switch (normalized.name) {
    case "RSA-PSS":
    case "RSASSA-PKCS1-v1_5":
      return rsaSignVerify(key, data, normalized, signature);
    case "ECDSA":
      return ecdsaSignVerify(key, data, normalized, signature);
    case "Ed25519":
    case "Ed448":
      return eddsaSignVerify(key, data, normalized, signature);
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
      return mlDsaSignVerify(key, data, normalized, signature);
    case "HMAC":
      return hmacSignVerify(key, data, signature);
    case "KMAC128":
    case "KMAC256":
      return kmacSignVerify(key, data, normalized, signature);
    default:
      throw unreachable();
  }
}

/**
 * Node's `cipherOrWrap`. Web Crypto allows more, but node's jobs take at
 * most what a `uint32_t` holds, and so does this.
 */
function cipherOrWrap(mode: "encrypt" | "decrypt", algorithm: NormalizedAlgorithm, key: CryptoKey, data: BufferSource): Job<ArrayBuffer> {
  validateMaxBufferLength(data, "data");
  switch (algorithm.name) {
    case "RSA-OAEP":
      return rsaOaepCipher(mode, key, data, algorithm);
    case "AES-CTR":
    case "AES-CBC":
    case "AES-GCM":
    case "AES-OCB":
    case "AES-KW":
      return aesCipher(mode, key, data, algorithm);
    case "ChaCha20-Poly1305":
      return c20pCipher(mode, key, data, algorithm);
    default:
      throw unreachable();
  }
}

/** Node's `aliasKeyFormat`: a format a family also accepts as `raw`. */
function aliasKeyFormat(format: string, alias: string): string {
  return format === alias ? "raw" : format;
}

/**
 * Node's `detachFromUserPrototypes`: Web Crypto parses and serializes a JWK
 * in a fresh global object, which node approximates by taking every object
 * in it off the program's prototypes -- so no `toJSON` or accessor a program
 * put on `Object.prototype` or `Array.prototype` sees it. An array keeps an
 * iterator of its own, for the sequence conversion that reads one.
 */
function detachFromUserPrototypes(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  Object.setPrototypeOf(value, null);
  if (Array.isArray(value)) {
    const items = value as unknown[];
    Object.defineProperty(items, Symbol.iterator, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: function* () {
        for (let n = 0; n < items.length; n++) yield items[n];
      },
    });
    for (let n = 0; n < items.length; n++) detachFromUserPrototypes(items[n]);
    return;
  }
  for (const key of Object.keys(value)) detachFromUserPrototypes((value as Record<string, unknown>)[key]);
}

/**
 * Node's `encodeUtf8String`: a string's UTF-8 through the runtime's own
 * codec, which no program can replace -- `TextEncoder` and `Buffer` it can.
 */
function encodeUtf8(text: string): Uint8Array {
  const bytes = new Uint8Array(utf8Length(text));
  utf8Write(bytes, text, 0, bytes.byteLength);
  return bytes;
}

/** Node's `decodeUTF8(data, false, true)`: fatal on invalid input, a leading BOM dropped. */
function decodeUtf8(bytes: Uint8Array): string {
  if (!isUtf8(bytes)) throw new ERR_ENCODING_INVALID_ENCODED_DATA("The encoded data was not valid for encoding utf-8");
  const start = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  return utf8Decode(bytes, start, bytes.length);
}

/** Node's `parseJwk`: a wrapped JWK's UTF-8, parsed and converted as Web Crypto's "parse a JWK" says. */
function parseJwk(data: ArrayBuffer): JsonWebKey {
  let key: JsonWebKey;
  try {
    const json = decodeUtf8(new Uint8Array(data));
    const result: unknown = JSON.parse(json);
    detachFromUserPrototypes(result);
    key = convertJsonWebKey(result) as JsonWebKey;
  } catch (error) {
    throw domExceptionWithCause("Invalid wrapped JWK key", "DataError", error);
  }
  if (!Object.hasOwn(key, "kty")) throw domException("Invalid wrapped JWK key", "DataError");
  return key;
}

/** The algorithm for an operation, or for its fallback when the first has no such algorithm. */
function normalizeEither(identifier: AlgorithmIdentifier, first: Operation, fallback: Operation): NormalizedAlgorithm {
  try {
    return normalizeAlgorithm(identifier, first);
  } catch {
    return normalizeAlgorithm(identifier, fallback);
  }
}

/** A key's bytes, as a family's import takes them. */
function bytesOf(source: BufferSource): Uint8Array {
  return bytesOfSource(source);
}

/** The checks every encapsulation method makes of its algorithm and key. */
function checkEncapsulationKey(normalized: NormalizedAlgorithm, key: CryptoKey, usage: string, subject: string): void {
  if (normalized.name !== getCryptoKeyAlgorithm(key).name) throw domException("key algorithm mismatch", "InvalidAccessError");
  if (!hasCryptoKeyUsage(key, usage)) throw domException(`${subject} does not have ${usage} usage`, "InvalidAccessError");
}

/** The encapsulation dispatch the four KEM methods share. */
function encapsulateFor(key: CryptoKey): Job<EncapsulatedBits> {
  switch (getCryptoKeyAlgorithm(key).name) {
    case "ML-KEM-512":
    case "ML-KEM-768":
    case "ML-KEM-1024":
      return mlKemEncapsulate(key);
    default:
      throw unreachable();
  }
}

function decapsulateFor(key: CryptoKey, ciphertext: BufferSource): Job<ArrayBuffer> {
  switch (getCryptoKeyAlgorithm(key).name) {
    case "ML-KEM-512":
    case "ML-KEM-768":
    case "ML-KEM-1024":
      return mlKemDecapsulate(key, ciphertext);
    default:
      throw unreachable();
  }
}

/** `encrypt` and `decrypt`, which differ only in their mode. */
function cipherMethod(
  receiver: unknown,
  count: number,
  method: "encrypt" | "decrypt",
  algorithm: unknown,
  key: unknown,
  data: unknown,
): Job<ArrayBuffer> {
  const prefix = prepareSubtleMethod(receiver, method, count, 3);
  const identifier = convertAlgorithmIdentifier(algorithm, argument(prefix, 0));
  const cryptoKey = convertCryptoKey(key, argument(prefix, 1));
  const bytes = convertBufferSource(data, argument(prefix, 2));
  const normalized = normalizeAlgorithm(identifier, method);
  if (normalized.name !== getCryptoKeyAlgorithm(cryptoKey).name) {
    throw domException("Key algorithm mismatch", "InvalidAccessError");
  }
  if (!hasCryptoKeyUsage(cryptoKey, method)) throw domException(`Unable to use this key to ${method}`, "InvalidAccessError");
  return cipherOrWrap(method, normalized, cryptoKey, bytes);
}

// -- SubtleCrypto.supports --------------------------------------------------------------

/** The most bits ECDH derives on each curve Web Crypto has. */
function ecdhMaxLength(namedCurve: string | undefined): number | undefined {
  switch (namedCurve) {
    case "P-256":
      return 256;
    case "P-384":
      return 384;
    case "P-521":
      return 528;
    default:
      return undefined;
  }
}

/** Node's `check`: whether an operation would accept this algorithm, and this length. */
function check(operation: string, algorithm: unknown, length?: number | null): boolean {
  let op = operation;
  if (op === "encapsulateBits" || op === "encapsulateKey") op = "encapsulate";
  if (op === "decapsulateBits" || op === "decapsulateKey") op = "decapsulate";
  let normalized: NormalizedAlgorithm;
  try {
    normalized = normalizeAlgorithm(algorithm, op as Operation);
  } catch {
    if (op === "wrapKey") return check("encrypt", algorithm);
    if (op === "unwrapKey") return check("decrypt", algorithm);
    return false;
  }
  switch (op) {
    case "decapsulate":
    case "decrypt":
    case "digest":
    case "encapsulate":
    case "encrypt":
    case "exportKey":
    case "importKey":
    case "sign":
    case "unwrapKey":
    case "verify":
    case "wrapKey":
      return true;
    case "deriveBits": {
      if (normalized.name === "HKDF" || normalized.name === "PBKDF2") validateDeriveBitsLength(length);
      if (normalized.name.startsWith("Argon2")) validateArgon2DeriveBitsLength(length);
      const bits = length ?? 0;
      if (normalized.name === "X25519" && bits > 256) return false;
      if (normalized.name === "X448" && bits > 448) return false;
      if (normalized.name === "ECDH") {
        const maxLength = ecdhMaxLength(getCryptoKeyAlgorithm(normalized.public).namedCurve);
        if (maxLength !== undefined && bits > maxLength) return false;
      }
      return true;
    }
    case "generateKey":
      if (normalized.name === "HMAC" && normalized.length === undefined && normalized.hash!.name.startsWith("SHA3-")) {
        return false;
      }
      return true;
    default:
      throw unreachable();
  }
}

const kSupportsOperations = [
  "decapsulateBits",
  "decapsulateKey",
  "decrypt",
  "deriveBits",
  "deriveKey",
  "digest",
  "encapsulateBits",
  "encapsulateKey",
  "encrypt",
  "exportKey",
  "generateKey",
  "getPublicKey",
  "importKey",
  "sign",
  "unwrapKey",
  "verify",
  "wrapKey",
];

/** `supports`'s third argument, as an algorithm. */
function additionalAlgorithm(prefix: string, value: unknown): AlgorithmIdentifier {
  return convertAlgorithmIdentifier(value, { prefix, context: "3rd argument" });
}

/** Which algorithm families `getPublicKey` knows, by the two letters node matches on. */
function hasPublicKey(name: string): boolean {
  switch (name.slice(0, 2)) {
    case "ML":
    case "SL":
    case "RS":
    case "EC":
    case "Ed":
    case "X2":
    case "X4":
      return true;
    default:
      return false;
  }
}

/** Which shared-key algorithms an encapsulation may import, and at what length. */
function isSharedKeyAlgorithm(algorithm: NormalizedAlgorithm): boolean {
  switch (algorithm.name) {
    case "AES-OCB":
    case "AES-KW":
    case "AES-GCM":
    case "AES-CTR":
    case "AES-CBC":
    case "ChaCha20-Poly1305":
    case "HKDF":
    case "PBKDF2":
    case "Argon2i":
    case "Argon2d":
    case "Argon2id":
      return true;
    case "HMAC":
    case "KMAC128":
    case "KMAC256":
      return algorithm.length === undefined || numBitsToBytes(algorithm.length) === 32;
    default:
      return false;
  }
}

// -- the classes ------------------------------------------------------------------------

/** What only this module holds: the argument that makes the constructors build rather than refuse. */
class Construction {}

const construction = new Construction();

export class SubtleCrypto {
  constructor(token?: unknown) {
    if (token !== construction) throw new ERR_ILLEGAL_CONSTRUCTOR();
  }

  /** `SubtleCrypto.supports` (WICG webcrypto-modern-algos). */
  static supports(operation: unknown, algorithm: unknown, lengthOrAdditionalAlgorithm: unknown = null): boolean {
    emitExperimentalWarning("The supports Web Crypto API method");
    if (this !== SubtleCrypto) throw new ERR_INVALID_THIS("SubtleCrypto constructor");
    const prefix = "Failed to execute 'supports' on 'SubtleCrypto'";
    requiredArguments(arguments.length, 2, { prefix });
    const op = convertDOMString(operation, { prefix, context: "1st argument" });
    const identifier = convertAlgorithmIdentifier(algorithm, { prefix, context: "2nd argument" });
    if (!kSupportsOperations.includes(op)) return false;

    let length: number | null | undefined;
    let checkOperation = op;
    if (op === "deriveKey") {
      const additional = additionalAlgorithm(prefix, lengthOrAdditionalAlgorithm);
      if (!check("importKey", additional)) return false;
      try {
        length = getKeyLength(normalizeAlgorithm(additional, "get key length"));
      } catch {
        return false;
      }
      checkOperation = "deriveBits";
    } else if (op === "wrapKey") {
      if (!check("exportKey", additionalAlgorithm(prefix, lengthOrAdditionalAlgorithm))) return false;
    } else if (op === "unwrapKey") {
      if (!check("importKey", additionalAlgorithm(prefix, lengthOrAdditionalAlgorithm))) return false;
    } else if (op === "deriveBits") {
      length =
        lengthOrAdditionalAlgorithm === null
          ? null
          : convertUnsignedLong(lengthOrAdditionalAlgorithm, { prefix, context: "3rd argument" });
    } else if (op === "getPublicKey") {
      try {
        return hasPublicKey(normalizeAlgorithm(identifier, "exportKey").name);
      } catch {
        return false;
      }
    } else if (op === "encapsulateKey" || op === "decapsulateKey") {
      const additional = additionalAlgorithm(prefix, lengthOrAdditionalAlgorithm);
      let normalized: NormalizedAlgorithm;
      try {
        normalized = normalizeAlgorithm(additional, "importKey");
      } catch {
        return false;
      }
      if (!isSharedKeyAlgorithm(normalized)) return false;
    }
    try {
      return check(checkOperation, identifier, length);
    } catch {
      return false;
    }
  }

  encrypt(algorithm: unknown, key: unknown, data: unknown): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => cipherMethod(this, count, "encrypt", algorithm, key, data));
  }

  decrypt(algorithm: unknown, key: unknown, data: unknown): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => cipherMethod(this, count, "decrypt", algorithm, key, data));
  }

  sign(algorithm: unknown, key: unknown, data: unknown): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      const prefix = prepareSubtleMethod(this, "sign", count, 3);
      const identifier = convertAlgorithmIdentifier(algorithm, argument(prefix, 0));
      const cryptoKey = convertCryptoKey(key, argument(prefix, 1));
      const bytes = convertBufferSource(data, argument(prefix, 2));
      return signVerify(identifier, cryptoKey, bytes);
    });
  }

  verify(algorithm: unknown, key: unknown, signature: unknown, data: unknown): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      const prefix = prepareSubtleMethod(this, "verify", count, 4);
      const identifier = convertAlgorithmIdentifier(algorithm, argument(prefix, 0));
      const cryptoKey = convertCryptoKey(key, argument(prefix, 1));
      const expected = convertBufferSource(signature, argument(prefix, 2));
      const bytes = convertBufferSource(data, argument(prefix, 3));
      return signVerify(identifier, cryptoKey, bytes, expected);
    });
  }

  digest(algorithm: unknown, data: unknown): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      const prefix = prepareSubtleMethod(this, "digest", count, 2);
      const identifier = convertAlgorithmIdentifier(algorithm, argument(prefix, 0));
      const bytes = convertBufferSource(data, argument(prefix, 1));
      return asyncDigest(normalizeAlgorithm(identifier, "digest"), bytes);
    });
  }

  generateKey(algorithm: unknown, extractable: unknown, keyUsages: unknown): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      const prefix = prepareSubtleMethod(this, "generateKey", count, 3);
      const identifier = convertAlgorithmIdentifier(algorithm, argument(prefix, 0));
      const isExtractable = convertBoolean(extractable);
      const usages = convertKeyUsages(keyUsages, argument(prefix, 2));
      return generateKeyFor(normalizeAlgorithm(identifier, "generateKey"), isExtractable, usages);
    });
  }

  deriveKey(algorithm: unknown, baseKey: unknown, derivedKeyType: unknown, extractable: unknown, keyUsages: unknown): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      const prefix = prepareSubtleMethod(this, "deriveKey", count, 5);
      const identifier = convertAlgorithmIdentifier(algorithm, argument(prefix, 0));
      const key = convertCryptoKey(baseKey, argument(prefix, 1));
      const derivedType = convertAlgorithmIdentifier(derivedKeyType, argument(prefix, 2));
      const isExtractable = convertBoolean(extractable);
      const usages = convertKeyUsages(keyUsages, argument(prefix, 4));
      const normalized = normalizeAlgorithm(identifier, "deriveBits");
      const derivedImport = normalizeAlgorithm(derivedType, "importKey");
      const derivedLength = normalizeAlgorithm(derivedType, "get key length");
      if (!hasCryptoKeyUsage(key, "deriveKey")) {
        throw domException("baseKey does not have deriveKey usage", "InvalidAccessError");
      }
      if (getCryptoKeyAlgorithm(key).name !== normalized.name) {
        throw domException("Key algorithm mismatch", "InvalidAccessError");
      }
      const secret = deriveBitsFor(normalized, key, getKeyLength(derivedLength));
      return mapJob(secret, (bits) => importKeySync("raw-secret", new Uint8Array(bits), derivedImport, isExtractable, usages));
    });
  }

  deriveBits(algorithm: unknown, baseKey: unknown, length: unknown = null): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      const prefix = prepareSubtleMethod(this, "deriveBits", count, 2);
      const identifier = convertAlgorithmIdentifier(algorithm, argument(prefix, 0));
      const key = convertCryptoKey(baseKey, argument(prefix, 1));
      const bits = length === null ? null : convertUnsignedLong(length, argument(prefix, 2));
      const normalized = normalizeAlgorithm(identifier, "deriveBits");
      if (!hasCryptoKeyUsage(key, "deriveBits")) {
        throw domException("baseKey does not have deriveBits usage", "InvalidAccessError");
      }
      if (getCryptoKeyAlgorithm(key).name !== normalized.name) {
        throw domException("Key algorithm mismatch", "InvalidAccessError");
      }
      return deriveBitsFor(normalized, key, bits);
    });
  }

  importKey(format: unknown, keyData: unknown, algorithm: unknown, extractable: unknown, keyUsages: unknown): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      const prefix = prepareSubtleMethod(this, "importKey", count, 5);
      const keyFormat = convertKeyFormat(format, argument(prefix, 0));
      const material =
        keyFormat === "jwk"
          ? (convertJsonWebKey(keyData, argument(prefix, 1)) as JsonWebKey)
          : bytesOf(convertBufferSource(keyData, argument(prefix, 1)));
      const identifier = convertAlgorithmIdentifier(algorithm, argument(prefix, 2));
      const isExtractable = convertBoolean(extractable);
      const usages = convertKeyUsages(keyUsages, argument(prefix, 4));
      const normalized = normalizeAlgorithm(identifier, "importKey");
      return resolvedJob(importKeySync(keyFormat, material, normalized, isExtractable, usages));
    });
  }

  exportKey(format: unknown, key: unknown): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      const prefix = prepareSubtleMethod(this, "exportKey", count, 2);
      const keyFormat = convertKeyFormat(format, argument(prefix, 0));
      const cryptoKey = convertCryptoKey(key, argument(prefix, 1));
      return resolvedJob(exportKeySync(keyFormat, cryptoKey));
    });
  }

  wrapKey(format: unknown, key: unknown, wrappingKey: unknown, wrapAlgorithm: unknown): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      const prefix = prepareSubtleMethod(this, "wrapKey", count, 4);
      const keyFormat = convertKeyFormat(format, argument(prefix, 0));
      const cryptoKey = convertCryptoKey(key, argument(prefix, 1));
      const wrapping = convertCryptoKey(wrappingKey, argument(prefix, 2));
      const identifier = convertAlgorithmIdentifier(wrapAlgorithm, argument(prefix, 3));
      const normalized = normalizeEither(identifier, "wrapKey", "encrypt");
      if (normalized.name !== getCryptoKeyAlgorithm(wrapping).name) {
        throw domException("Key algorithm mismatch", "InvalidAccessError");
      }
      if (!hasCryptoKeyUsage(wrapping, "wrapKey")) throw domException("Unable to use this key to wrapKey", "InvalidAccessError");
      const exported = exportKeySync(keyFormat, cryptoKey);
      let bytes: BufferSource;
      if (keyFormat === "jwk") {
        detachFromUserPrototypes(exported);
        const json = JSON.stringify(exported);
        // Step 13's note: a JWK wrapped with AES-KW is padded to a multiple of 8 bytes.
        const padded = normalized.name === "AES-KW" && json.length % 8 !== 0 ? json + " ".repeat(8 - (json.length % 8)) : json;
        bytes = encodeUtf8(padded);
      } else {
        bytes = exported as ArrayBuffer;
      }
      return cipherOrWrap("encrypt", normalized, wrapping, bytes);
    });
  }

  unwrapKey(
    format: unknown,
    wrappedKey: unknown,
    unwrappingKey: unknown,
    unwrapAlgorithm: unknown,
    unwrappedKeyAlgorithm: unknown,
    extractable: unknown,
    keyUsages: unknown,
  ): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      const prefix = prepareSubtleMethod(this, "unwrapKey", count, 7);
      const keyFormat = convertKeyFormat(format, argument(prefix, 0));
      const wrapped = convertBufferSource(wrappedKey, argument(prefix, 1));
      const unwrapping = convertCryptoKey(unwrappingKey, argument(prefix, 2));
      const identifier = convertAlgorithmIdentifier(unwrapAlgorithm, argument(prefix, 3));
      const keyIdentifier = convertAlgorithmIdentifier(unwrappedKeyAlgorithm, argument(prefix, 4));
      const isExtractable = convertBoolean(extractable);
      const usages = convertKeyUsages(keyUsages, argument(prefix, 6));
      const normalized = normalizeEither(identifier, "unwrapKey", "decrypt");
      const keyAlgorithm = normalizeAlgorithm(keyIdentifier, "importKey");
      if (normalized.name !== getCryptoKeyAlgorithm(unwrapping).name) {
        throw domException("Key algorithm mismatch", "InvalidAccessError");
      }
      if (!hasCryptoKeyUsage(unwrapping, "unwrapKey")) {
        throw domException("Unable to use this key to unwrapKey", "InvalidAccessError");
      }
      const bytes = cipherOrWrap("decrypt", normalized, unwrapping, wrapped);
      return mapJob(bytes, (data) =>
        importKeySync(keyFormat, keyFormat === "jwk" ? parseJwk(data) : new Uint8Array(data), keyAlgorithm, isExtractable, usages),
      );
    });
  }

  getPublicKey(key: unknown, keyUsages: unknown): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      emitExperimentalWarning("The getPublicKey Web Crypto API method");
      const prefix = prepareSubtleMethod(this, "getPublicKey", count, 2);
      const cryptoKey = convertCryptoKey(key, argument(prefix, 0));
      const usages = convertKeyUsages(keyUsages, argument(prefix, 1));
      const type = getCryptoKeyType(cryptoKey);
      if (type !== "private") {
        throw domException("key must be a private key", type === "secret" ? "NotSupportedError" : "InvalidAccessError");
      }
      return resolvedJob(toPublicCryptoKey(cryptoKey, usages));
    });
  }

  encapsulateBits(encapsulationAlgorithm: unknown, encapsulationKey: unknown): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      emitExperimentalWarning("The encapsulateBits Web Crypto API method");
      const prefix = prepareSubtleMethod(this, "encapsulateBits", count, 2);
      const identifier = convertAlgorithmIdentifier(encapsulationAlgorithm, argument(prefix, 0));
      const key = convertCryptoKey(encapsulationKey, argument(prefix, 1));
      checkEncapsulationKey(normalizeAlgorithm(identifier, "encapsulate"), key, "encapsulateBits", "encapsulationKey");
      return encapsulateFor(key);
    });
  }

  encapsulateKey(
    encapsulationAlgorithm: unknown,
    encapsulationKey: unknown,
    sharedKeyAlgorithm: unknown,
    extractable: unknown,
    keyUsages: unknown,
  ): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      emitExperimentalWarning("The encapsulateKey Web Crypto API method");
      const prefix = prepareSubtleMethod(this, "encapsulateKey", count, 5);
      const identifier = convertAlgorithmIdentifier(encapsulationAlgorithm, argument(prefix, 0));
      const key = convertCryptoKey(encapsulationKey, argument(prefix, 1));
      const shared = convertAlgorithmIdentifier(sharedKeyAlgorithm, argument(prefix, 2));
      const isExtractable = convertBoolean(extractable);
      const usages = convertKeyUsages(keyUsages, argument(prefix, 4));
      const normalized = normalizeAlgorithm(identifier, "encapsulate");
      const sharedImport = normalizeAlgorithm(shared, "importKey");
      checkEncapsulationKey(normalized, key, "encapsulateKey", "encapsulationKey");
      return mapJob(encapsulateFor(key), (bits) => ({
        ciphertext: bits.ciphertext,
        sharedKey: importKeySync("raw-secret", new Uint8Array(bits.sharedKey), sharedImport, isExtractable, usages),
      }));
    });
  }

  decapsulateBits(decapsulationAlgorithm: unknown, decapsulationKey: unknown, ciphertext: unknown): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      emitExperimentalWarning("The decapsulateBits Web Crypto API method");
      const prefix = prepareSubtleMethod(this, "decapsulateBits", count, 3);
      const identifier = convertAlgorithmIdentifier(decapsulationAlgorithm, argument(prefix, 0));
      const key = convertCryptoKey(decapsulationKey, argument(prefix, 1));
      const bytes = convertBufferSource(ciphertext, argument(prefix, 2));
      checkEncapsulationKey(normalizeAlgorithm(identifier, "decapsulate"), key, "decapsulateBits", "decapsulationKey");
      return decapsulateFor(key, bytes);
    });
  }

  decapsulateKey(
    decapsulationAlgorithm: unknown,
    decapsulationKey: unknown,
    ciphertext: unknown,
    sharedKeyAlgorithm: unknown,
    extractable: unknown,
    keyUsages: unknown,
  ): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      emitExperimentalWarning("The decapsulateKey Web Crypto API method");
      const prefix = prepareSubtleMethod(this, "decapsulateKey", count, 6);
      const identifier = convertAlgorithmIdentifier(decapsulationAlgorithm, argument(prefix, 0));
      const key = convertCryptoKey(decapsulationKey, argument(prefix, 1));
      const bytes = convertBufferSource(ciphertext, argument(prefix, 2));
      const shared = convertAlgorithmIdentifier(sharedKeyAlgorithm, argument(prefix, 3));
      const isExtractable = convertBoolean(extractable);
      const usages = convertKeyUsages(keyUsages, argument(prefix, 5));
      const normalized = normalizeAlgorithm(identifier, "decapsulate");
      const sharedImport = normalizeAlgorithm(shared, "importKey");
      checkEncapsulationKey(normalized, key, "decapsulateKey", "decapsulationKey");
      return mapJob(decapsulateFor(key, bytes), (bits) =>
        importKeySync("raw-secret", new Uint8Array(bits), sharedImport, isExtractable, usages),
      );
    });
  }
}

export class Crypto {
  constructor(token?: unknown) {
    if (token !== construction) throw new ERR_ILLEGAL_CONSTRUCTOR();
  }

  get subtle(): SubtleCrypto {
    if (this !== crypto) throw new ERR_INVALID_THIS("Crypto");
    return subtle;
  }

  getRandomValues(array: unknown): ArrayBufferView {
    if (this !== crypto) throw new ERR_INVALID_THIS("Crypto");
    requiredArguments(arguments.length, 1, { prefix: "Failed to execute 'getRandomValues' on 'Crypto'" });
    return fillRandomValues(array as ArrayBufferView);
  }

  randomUUID(): string {
    if (this !== crypto) throw new ERR_INVALID_THIS("Crypto");
    return newRandomUUID();
  }
}

/** The one of each. */
const subtle = new SubtleCrypto(construction);
export const crypto = new Crypto(construction);
