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

import { TextDecoder } from "../../../../web-platform/src/core/encoding.ts";
import { Buffer } from "../../../buffer/src/main.ts";
import { domException, domExceptionWithCause } from "../../../internal/dom-exception.ts";
import { ERR_ILLEGAL_CONSTRUCTOR, ERR_INVALID_THIS } from "../../../internal/errors.ts";
import { emitExperimentalWarning } from "../../../internal/process-warning.ts";
import { convertBoolean, convertDOMString, convertUnsignedLong, type ConversionOptions } from "../../../internal/webidl.ts";
import { getRandomValues as fillRandomValues, randomUUID as newRandomUUID } from "../random.ts";
import { asBuffer } from "../util.ts";
import { aesCipher, aesGenerateKey, aesImportKey, getAlgorithmName } from "./aes.ts";
import { asyncDigest } from "./digest.ts";
import { hkdfDeriveBits, pbkdf2DeriveBits, validateDeriveBitsLength } from "./kdf.ts";
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
import { hmacGenerateKey, hmacJwkAlgorithm, hmacSignVerify, macImportKey } from "./mac.ts";
import {
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
import { importGenericSecretKey, type JsonWebKey } from "./webcrypto-util.ts";
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
    case "HMAC":
      return hmacGenerateKey(algorithm, extractable, usages);
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
    case "HKDF":
      return hkdfDeriveBits(algorithm, key, length);
    case "PBKDF2":
      return pbkdf2DeriveBits(algorithm, key, length);
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
 * members, all in one literal -- so no inherited setter sees the object, as
 * node's native export defines its members.
 */
function exportKeyJWK(key: CryptoKey): JsonWebKey | undefined {
  const algorithm = getCryptoKeyAlgorithm(key);
  let alg: string | undefined;
  switch (algorithm.name) {
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
    default:
      return undefined;
  }
  const jwk: JsonWebKey = {
    key_ops: getCryptoKeyUsages(key).slice(),
    ext: getCryptoKeyExtractable(key),
    alg,
    kty: "oct",
    k: asBuffer(getCryptoKeyHandle(key).bytes).toString("base64url"),
  };
  if (alg === undefined) delete jwk.alg;
  return jwk;
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
    case "jwk":
      result = exportKeyJWK(key);
      break;
    case "raw-secret":
    case "raw":
      if (type === "secret") result = exportKeyRawSecret(key, format);
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
  keyData: Uint8Array | JsonWebKey,
  algorithm: NormalizedAlgorithm,
  extractable: boolean,
  usages: string[],
): CryptoKey {
  let result: CryptoKey | undefined;
  switch (algorithm.name) {
    case "HMAC":
      result = macImportKey(format, keyData, algorithm, extractable, usages);
      break;
    case "AES-CTR":
    case "AES-CBC":
    case "AES-GCM":
    case "AES-KW":
    case "AES-OCB":
      result = aesImportKey(algorithm, format, keyData, extractable, usages);
      break;
    case "HKDF":
    case "PBKDF2":
      result = importGenericSecretKey(algorithm, aliasKeyFormat(format, "raw-secret"), keyData as Uint8Array, extractable, usages);
      break;
  }
  if (!result) throw domException(`Unable to import ${algorithm.name} using ${format} format`, "NotSupportedError");
  const type = getCryptoKeyType(result);
  if ((type === "secret" || type === "private") && getCryptoKeyUsagesMask(result) === 0) {
    throw domException(`Usages cannot be empty when importing a ${type} key.`, "SyntaxError");
  }
  return result;
}

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
    case "HMAC":
      return hmacSignVerify(key, data, signature);
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
    case "AES-CTR":
    case "AES-CBC":
    case "AES-GCM":
    case "AES-OCB":
    case "AES-KW":
      return aesCipher(mode, key, data, algorithm);
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

/** Node's `parseJwk`: a wrapped JWK's UTF-8, parsed and converted as Web Crypto's "parse a JWK" says. */
function parseJwk(data: ArrayBuffer): JsonWebKey {
  let key: JsonWebKey;
  try {
    const json = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(data));
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
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  return new Uint8Array(source);
}

/** The checks every encapsulation method makes of its algorithm and key. */
function checkEncapsulationKey(
  identifier: AlgorithmIdentifier,
  key: CryptoKey,
  operation: "encapsulate" | "decapsulate",
  usage: string,
  subject: string,
): void {
  const normalized = normalizeAlgorithm(identifier, operation);
  if (normalized.name !== getCryptoKeyAlgorithm(key).name) throw domException("key algorithm mismatch", "InvalidAccessError");
  if (!hasCryptoKeyUsage(key, usage)) throw domException(`${subject} does not have ${usage} usage`, "InvalidAccessError");
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
        bytes = Buffer.from(padded, "utf8");
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
      convertKeyUsages(keyUsages, argument(prefix, 1));
      const type = getCryptoKeyType(cryptoKey);
      if (type !== "private") {
        throw domException("key must be a private key", type === "secret" ? "NotSupportedError" : "InvalidAccessError");
      }
      throw unreachable();
    });
  }

  encapsulateBits(encapsulationAlgorithm: unknown, encapsulationKey: unknown): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      emitExperimentalWarning("The encapsulateBits Web Crypto API method");
      const prefix = prepareSubtleMethod(this, "encapsulateBits", count, 2);
      const identifier = convertAlgorithmIdentifier(encapsulationAlgorithm, argument(prefix, 0));
      const key = convertCryptoKey(encapsulationKey, argument(prefix, 1));
      checkEncapsulationKey(identifier, key, "encapsulate", "encapsulateBits", "encapsulationKey");
      throw unreachable();
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
      convertBoolean(extractable);
      convertKeyUsages(keyUsages, argument(prefix, 4));
      normalizeAlgorithm(identifier, "encapsulate");
      normalizeAlgorithm(shared, "importKey");
      checkEncapsulationKey(identifier, key, "encapsulate", "encapsulateKey", "encapsulationKey");
      throw unreachable();
    });
  }

  decapsulateBits(decapsulationAlgorithm: unknown, decapsulationKey: unknown, ciphertext: unknown): Promise<unknown> {
    const count = arguments.length;
    return callSubtleCryptoMethod(() => {
      emitExperimentalWarning("The decapsulateBits Web Crypto API method");
      const prefix = prepareSubtleMethod(this, "decapsulateBits", count, 3);
      const identifier = convertAlgorithmIdentifier(decapsulationAlgorithm, argument(prefix, 0));
      const key = convertCryptoKey(decapsulationKey, argument(prefix, 1));
      convertBufferSource(ciphertext, argument(prefix, 2));
      checkEncapsulationKey(identifier, key, "decapsulate", "decapsulateBits", "decapsulationKey");
      throw unreachable();
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
      convertBufferSource(ciphertext, argument(prefix, 2));
      const shared = convertAlgorithmIdentifier(sharedKeyAlgorithm, argument(prefix, 3));
      convertBoolean(extractable);
      convertKeyUsages(keyUsages, argument(prefix, 5));
      normalizeAlgorithm(identifier, "decapsulate");
      normalizeAlgorithm(shared, "importKey");
      checkEncapsulationKey(identifier, key, "decapsulate", "decapsulateKey", "decapsulationKey");
      throw unreachable();
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
