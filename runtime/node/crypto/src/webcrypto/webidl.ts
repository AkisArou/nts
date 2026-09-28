// Web Crypto's IDL conversions, from node v24.20.0
// `lib/internal/crypto/webidl.js`: the dictionaries each algorithm takes, and
// node's validators, which reject a value no operation could use while the
// member it came from is still known.
//
// Each dictionary is a function reading its members through
// `DictionaryReader`, level by level and in code-unit order within a level,
// as node's `createDictionaryConverter` reads them after sorting.

import { domException } from "../../../internal/dom-exception.ts";
import {
  type ConversionOptions,
  type Converter,
  converters as genericConverters,
  convertBoolean,
  convertDOMString,
  convertEnum,
  convertInterface,
  convertObject,
  convertOctet,
  convertSequence,
  convertSequenceOfDOMString,
  convertUint8Array,
  convertUnsignedLong,
  convertUnsignedShort,
  convertBufferSource as convertGenericBufferSource,
  DictionaryReader,
  type IdlDictionary,
  requiredArguments,
  type,
} from "../../../internal/webidl.ts";
import { CryptoKey, getCryptoKeyAlgorithm, getCryptoKeyType } from "./key.ts";

export { requiredArguments };

/** Web Crypto's curves, by their Web Crypto names, as OpenSSL names them. */
export function namedCurveAlias(name: string): string | undefined {
  switch (name) {
    case "P-256":
      return "prime256v1";
    case "P-384":
      return "secp384r1";
    case "P-521":
      return "secp521r1";
    default:
      return undefined;
  }
}

/** The largest buffer Web Crypto accepts. */
export const kMaxBufferLength = 2 ** 31 - 1;

/** Node's `validateMaxBufferLength`. */
export function validateMaxBufferLength(data: ArrayBuffer | ArrayBufferView, name: string, max = kMaxBufferLength): void {
  if (data.byteLength > max) throw domException(`${name} must be at most ${max} bytes`, "OperationError");
}

/** Node's `numBitsToBytes`: whole bytes for a length in bits, rounding up. */
export function numBitsToBytes(length: number): number {
  return Math.floor(length / 8) + Math.floor((7 + (length % 8)) / 8);
}

type BufferSource = ArrayBuffer | ArrayBufferView;

function validateByteLength(buffer: BufferSource, name: string, target: number): void {
  if (buffer.byteLength !== target) throw domException(`${name} must contain exactly ${target} bytes`, "OperationError");
}

// -- the members' converters ---------------------------------------------------------

function enforceRangeOptions(options: ConversionOptions): ConversionOptions {
  return { prefix: options.prefix, context: options.context, code: options.code, enforceRange: true };
}

function octetInRange(value: unknown, options: ConversionOptions = {}): number {
  return convertOctet(value, enforceRangeOptions(options));
}

function unsignedShortInRange(value: unknown, options: ConversionOptions = {}): number {
  return convertUnsignedShort(value, enforceRangeOptions(options));
}

function unsignedLongInRange(value: unknown, options: ConversionOptions = {}): number {
  return convertUnsignedLong(value, enforceRangeOptions(options));
}

/** `(object or DOMString)`. */
export function convertAlgorithmIdentifier(value: unknown, options?: ConversionOptions): object | string {
  return type(value) === "Object" ? convertObject(value, options) : convertDOMString(value, options);
}

/** A resizable backing store is still accepted, as node accepts it until a semver-major. */
function convertBigInteger(value: unknown, options: ConversionOptions = {}): Uint8Array {
  return convertUint8Array(value, {
    prefix: options.prefix,
    context: options.context,
    code: options.code,
    allowResizable: true,
    allowShared: false,
  });
}

/** The same leniency for `BufferSource`. */
export function convertBufferSource(value: unknown, options: ConversionOptions = {}): BufferSource {
  return convertGenericBufferSource(value, {
    prefix: options.prefix,
    context: options.context,
    code: options.code,
    allowResizable: options.allowResizable === undefined ? true : options.allowResizable,
    allowShared: options.allowShared,
  });
}

const kKeyFormats = ["raw", "raw-public", "raw-seed", "raw-secret", "raw-private", "pkcs8", "spki", "jwk"];

export function convertKeyFormat(value: unknown, options?: ConversionOptions): string {
  return convertEnum("KeyFormat", kKeyFormats, value, options);
}

const kKeyUsages = [
  "encrypt",
  "decrypt",
  "sign",
  "verify",
  "deriveKey",
  "deriveBits",
  "wrapKey",
  "unwrapKey",
  "encapsulateBits",
  "decapsulateBits",
  "encapsulateKey",
  "decapsulateKey",
];

function convertKeyUsage(value: unknown, options?: ConversionOptions): string {
  return convertEnum("KeyUsage", kKeyUsages, value, options);
}

export function convertKeyUsages(value: unknown, options: ConversionOptions = {}): string[] {
  return convertSequence(value, options, convertKeyUsage);
}

export function convertCryptoKey(value: unknown, options?: ConversionOptions): CryptoKey {
  return convertInterface<CryptoKey>("CryptoKey", CryptoKey.prototype, value, options);
}

// -- the validators -------------------------------------------------------------------

function aesLengthValidator(value: unknown): void {
  if (value !== 128 && value !== 192 && value !== 256) {
    throw domException("AES key length must be 128, 192, or 256 bits", "OperationError");
  }
}

function namedCurveValidator(value: unknown): void {
  if (namedCurveAlias(value as string) === undefined) throw domException("Unrecognized namedCurve", "NotSupportedError");
}

/** Node's `ensureSHA`: the hash of an algorithm that only takes the SHA family. */
function ensureSHA(value: unknown, label: string): void {
  const name = typeof value === "string" ? value : (value as { name?: unknown }).name;
  if (typeof name !== "string" || !name.toLowerCase().startsWith("sha")) {
    throw domException(`Only SHA hashes are supported in ${label}`, "NotSupportedError");
  }
}

function isUint32(value: number): boolean {
  return value === value >>> 0;
}

function bufferSourceEqualsAscii(value: BufferSource, text: string): boolean {
  if (value.byteLength !== text.length) return false;
  const bytes = ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value);
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** `AeadParams`'s checks depend on the algorithm, which node reads from the dictionary as written. */
function aeadName(dictionary: IdlDictionary): string {
  return String(dictionary.name).toLowerCase();
}

function aeadIvValidator(value: unknown, dictionary: IdlDictionary): void {
  const iv = value as BufferSource;
  switch (aeadName(dictionary)) {
    case "chacha20-poly1305":
      validateByteLength(iv, "algorithm.iv", 12);
      break;
    case "aes-gcm":
      validateMaxBufferLength(iv, "algorithm.iv");
      break;
    case "aes-ocb":
      if (iv.byteLength > 15) throw domException("AES-OCB algorithm.iv must be no more than 15 bytes", "OperationError");
      break;
  }
}

function aeadTagLengthValidator(value: unknown, dictionary: IdlDictionary): void {
  const length = value as number;
  switch (aeadName(dictionary)) {
    case "chacha20-poly1305":
      if (length !== 128) throw domException(`${length} is not a valid ChaCha20-Poly1305 tag length`, "OperationError");
      break;
    case "aes-gcm":
      if (![32, 64, 96, 104, 112, 120, 128].includes(length)) {
        throw domException(`${length} is not a valid AES-GCM tag length`, "OperationError");
      }
      break;
    case "aes-ocb":
      if (![64, 96, 128].includes(length)) throw domException(`${length} is not a valid AES-OCB tag length`, "OperationError");
      break;
  }
}

// -- the dictionaries -------------------------------------------------------------------

/** A dictionary deriving from `Algorithm`: its `name` level read, and the reader ready for its own. */
function algorithmReader(dictionary: string, value: unknown, options?: ConversionOptions): DictionaryReader {
  return new DictionaryReader(dictionary, value, options).member("name", convertDOMString, true).level();
}

function hashMember(reader: DictionaryReader, dictionary: string): DictionaryReader {
  return reader.member("hash", convertAlgorithmIdentifier, true, (value) => ensureSHA(value, dictionary));
}

export function convertAlgorithm(value: unknown, options?: ConversionOptions): IdlDictionary {
  return new DictionaryReader("Algorithm", value, options).member("name", convertDOMString, true).result;
}

function rsaKeyGenMembers(reader: DictionaryReader): DictionaryReader {
  return reader.member("modulusLength", unsignedLongInRange, true).member("publicExponent", convertBigInteger, true);
}

function convertRsaKeyGenParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return rsaKeyGenMembers(algorithmReader("RsaKeyGenParams", value, options)).result;
}

function convertRsaHashedKeyGenParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  const reader = rsaKeyGenMembers(algorithmReader("RsaHashedKeyGenParams", value, options)).level();
  return hashMember(reader, "RsaHashedKeyGenParams").result;
}

function convertRsaHashedImportParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return hashMember(algorithmReader("RsaHashedImportParams", value, options), "RsaHashedImportParams").result;
}

function convertEcKeyImportParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("EcKeyImportParams", value, options).member("namedCurve", convertDOMString, true, namedCurveValidator)
    .result;
}

function convertEcKeyGenParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("EcKeyGenParams", value, options).member("namedCurve", convertDOMString, true, namedCurveValidator)
    .result;
}

function convertAesKeyGenParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("AesKeyGenParams", value, options).member("length", unsignedShortInRange, true, aesLengthValidator)
    .result;
}

function convertRsaPssParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("RsaPssParams", value, options).member("saltLength", unsignedLongInRange, true).result;
}

function convertRsaOaepParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("RsaOaepParams", value, options).member("label", convertBufferSource).result;
}

function convertEcdsaParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return hashMember(algorithmReader("EcdsaParams", value, options), "EcdsaParams").result;
}

function hmacParams(dictionary: string, zeroError: string, value: unknown, options?: ConversionOptions): IdlDictionary {
  const reader = hashMember(algorithmReader(dictionary, value, options), dictionary);
  return reader.member("length", unsignedLongInRange, false, (length) => {
    if (length === 0) throw domException(`${dictionary}.length cannot be 0`, zeroError);
  }).result;
}

function convertHmacKeyGenParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return hmacParams("HmacKeyGenParams", "OperationError", value, options);
}

function convertHmacImportParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return hmacParams("HmacImportParams", "DataError", value, options);
}

function convertRsaOtherPrimesInfo(value: unknown, options?: ConversionOptions): IdlDictionary {
  return new DictionaryReader("RsaOtherPrimesInfo", value, options)
    .member("d", convertDOMString)
    .member("r", convertDOMString)
    .member("t", convertDOMString).result;
}

function convertSequenceOfRsaOtherPrimesInfo(value: unknown, options: ConversionOptions = {}): IdlDictionary[] {
  return convertSequence(value, options, convertRsaOtherPrimesInfo);
}

export function convertJsonWebKey(value: unknown, options?: ConversionOptions): IdlDictionary {
  return new DictionaryReader("JsonWebKey", value, options)
    .member("alg", convertDOMString)
    .member("crv", convertDOMString)
    .member("d", convertDOMString)
    .member("dp", convertDOMString)
    .member("dq", convertDOMString)
    .member("e", convertDOMString)
    .member("ext", convertBoolean)
    .member("k", convertDOMString)
    .member("key_ops", convertSequenceOfDOMString)
    .member("kty", convertDOMString)
    .member("n", convertDOMString)
    .member("oth", convertSequenceOfRsaOtherPrimesInfo)
    .member("p", convertDOMString)
    .member("priv", convertDOMString)
    .member("pub", convertDOMString)
    .member("q", convertDOMString)
    .member("qi", convertDOMString)
    .member("use", convertDOMString)
    .member("x", convertDOMString)
    .member("y", convertDOMString).result;
}

function convertHkdfParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return hashMember(algorithmReader("HkdfParams", value, options), "HkdfParams")
    .member("info", convertBufferSource, true, (info) =>
      validateMaxBufferLength(info as BufferSource, "algorithm.info", 1024),
    )
    .member("salt", convertBufferSource, true).result;
}

function convertCShakeParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("CShakeParams", value, options)
    .member("customization", convertBufferSource, false, (customization) =>
      validateMaxBufferLength(customization as BufferSource, "CShakeParams.customization", 512),
    )
    .member("functionName", convertBufferSource, false, (name) => {
      const functionName = name as BufferSource;
      if (
        functionName.byteLength === 0 ||
        bufferSourceEqualsAscii(functionName, "KMAC") ||
        bufferSourceEqualsAscii(functionName, "TupleHash") ||
        bufferSourceEqualsAscii(functionName, "ParallelHash")
      ) {
        return;
      }
      throw domException("Unsupported CShakeParams functionName", "NotSupportedError");
    })
    .member("outputLength", unsignedLongInRange, true, (length) => {
      if (!isUint32(numBitsToBytes(length as number) * 8)) {
        throw domException("Invalid CShakeParams outputLength", "OperationError");
      }
    }).result;
}

function convertPbkdf2Params(value: unknown, options?: ConversionOptions): IdlDictionary {
  return hashMember(algorithmReader("Pbkdf2Params", value, options), "Pbkdf2Params")
    .member("iterations", unsignedLongInRange, true, (iterations) => {
      if (iterations === 0) throw domException("iterations cannot be zero", "OperationError");
    })
    .member("salt", convertBufferSource, true).result;
}

function convertAesDerivedKeyParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("AesDerivedKeyParams", value, options).member(
    "length",
    unsignedShortInRange,
    true,
    aesLengthValidator,
  ).result;
}

function convertAesCbcParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("AesCbcParams", value, options).member("iv", convertBufferSource, true, (iv) =>
    validateByteLength(iv as BufferSource, "algorithm.iv", 16),
  ).result;
}

function convertAeadParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("AeadParams", value, options)
    .member("additionalData", convertBufferSource, false, (data) =>
      validateMaxBufferLength(data as BufferSource, "algorithm.additionalData"),
    )
    .member("iv", convertBufferSource, true, aeadIvValidator)
    .member("tagLength", octetInRange, false, aeadTagLengthValidator).result;
}

function convertAesCtrParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("AesCtrParams", value, options)
    .member("counter", convertBufferSource, true, (counter) =>
      validateByteLength(counter as BufferSource, "algorithm.counter", 16),
    )
    .member("length", octetInRange, true, (length) => {
      if (length === 0 || (length as number) > 128) {
        throw domException("AES-CTR algorithm.length must be between 1 and 128", "OperationError");
      }
    }).result;
}

function convertEcdhKeyDeriveParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("EcdhKeyDeriveParams", value, options).member("public", convertCryptoKey, true, (key, dictionary) => {
    if (getCryptoKeyType(key) !== "public") {
      throw domException("algorithm.public must be a public key", "InvalidAccessError");
    }
    if (getCryptoKeyAlgorithm(key).name.toLowerCase() !== String(dictionary.name).toLowerCase()) {
      throw domException("key algorithm mismatch", "InvalidAccessError");
    }
  }).result;
}

/** A context needs OpenSSL 3.2; before it, node accepts only an empty one. */
function convertContextParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  const contexts = nts_crypto_openssl_version_number() >= 0x30200000;
  return algorithmReader("ContextParams", value, options).member("context", convertBufferSource, false, (context) => {
    if (!contexts && (context as BufferSource).byteLength) {
      throw domException("Non zero-length ContextParams.context is not supported.", "NotSupportedError");
    }
  }).result;
}

function convertArgon2Params(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("Argon2Params", value, options)
    .member("associatedData", convertBufferSource)
    .member("memory", unsignedLongInRange, true, (memory, dictionary) => {
      if ((memory as number) < 8 * (dictionary.parallelism as number)) {
        throw domException("memory must be at least 8 times the degree of parallelism", "OperationError");
      }
    })
    .member("nonce", convertBufferSource, true, (nonce) => {
      if ((nonce as BufferSource).byteLength < 8) throw domException("nonce must be at least 8 bytes", "OperationError");
    })
    .member("parallelism", unsignedLongInRange, true, (parallelism) => {
      if (parallelism === 0 || (parallelism as number) > Math.pow(2, 24) - 1) {
        throw domException("parallelism must be > 0 and <= 16777215", "OperationError");
      }
    })
    .member("passes", unsignedLongInRange, true, (passes) => {
      if (passes === 0) throw domException("passes must be > 0", "OperationError");
    })
    .member("secretValue", convertBufferSource)
    .member("version", octetInRange, false, (version) => {
      if (version !== 0x13) throw domException(`${String(version)} is not a valid Argon2 version`, "OperationError");
    }).result;
}

function convertKmacKeyGenParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("KmacKeyGenParams", value, options).member("length", unsignedLongInRange).result;
}

function convertKmacImportParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("KmacImportParams", value, options).member("length", unsignedLongInRange).result;
}

function convertKmacParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("KmacParams", value, options)
    .member("customization", convertBufferSource)
    .member("outputLength", unsignedLongInRange, true).result;
}

function outputLengthValidator(dictionary: string, length: number): void {
  if (length === 0 || length % 8) throw domException(`Invalid ${dictionary} outputLength`, "OperationError");
}

function convertKangarooTwelveParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("KangarooTwelveParams", value, options)
    .member("customization", convertBufferSource, false, (customization) =>
      validateMaxBufferLength(customization as BufferSource, "KangarooTwelveParams.customization", 512),
    )
    .member("outputLength", unsignedLongInRange, true, (length) =>
      outputLengthValidator("KangarooTwelveParams", length as number),
    ).result;
}

function convertTurboShakeParams(value: unknown, options?: ConversionOptions): IdlDictionary {
  return algorithmReader("TurboShakeParams", value, options)
    .member("domainSeparation", octetInRange, false, (separation) => {
      if ((separation as number) < 0x01 || (separation as number) > 0x7f) {
        throw domException("TurboShakeParams.domainSeparation must be in range 0x01-0x7f", "OperationError");
      }
    })
    .member("outputLength", unsignedLongInRange, true, (length) =>
      outputLengthValidator("TurboShakeParams", length as number),
    ).result;
}

/** The converter for an algorithm dictionary, by its IDL name. */
export function dictionaryConverter(name: string): Converter<IdlDictionary> {
  switch (name) {
    case "RsaKeyGenParams":
      return convertRsaKeyGenParams;
    case "RsaHashedKeyGenParams":
      return convertRsaHashedKeyGenParams;
    case "RsaHashedImportParams":
      return convertRsaHashedImportParams;
    case "EcKeyImportParams":
      return convertEcKeyImportParams;
    case "EcKeyGenParams":
      return convertEcKeyGenParams;
    case "AesKeyGenParams":
      return convertAesKeyGenParams;
    case "RsaPssParams":
      return convertRsaPssParams;
    case "RsaOaepParams":
      return convertRsaOaepParams;
    case "EcdsaParams":
      return convertEcdsaParams;
    case "HmacKeyGenParams":
      return convertHmacKeyGenParams;
    case "HmacImportParams":
      return convertHmacImportParams;
    case "HkdfParams":
      return convertHkdfParams;
    case "CShakeParams":
      return convertCShakeParams;
    case "Pbkdf2Params":
      return convertPbkdf2Params;
    case "AesDerivedKeyParams":
      return convertAesDerivedKeyParams;
    case "AesCbcParams":
      return convertAesCbcParams;
    case "AeadParams":
      return convertAeadParams;
    case "AesCtrParams":
      return convertAesCtrParams;
    case "EcdhKeyDeriveParams":
      return convertEcdhKeyDeriveParams;
    case "ContextParams":
      return convertContextParams;
    case "Argon2Params":
      return convertArgon2Params;
    case "KmacKeyGenParams":
      return convertKmacKeyGenParams;
    case "KmacImportParams":
      return convertKmacImportParams;
    case "KmacParams":
      return convertKmacParams;
    case "KangarooTwelveParams":
      return convertKangarooTwelveParams;
    case "TurboShakeParams":
      return convertTurboShakeParams;
    default:
      throw new Error(`No converter for ${name}`);
  }
}

/** Node's converter table, the generic ones included, made on request for the tests that read it. */
export function webCryptoConverters(): Record<string, Converter<unknown>> {
  const table = genericConverters();
  table.AlgorithmIdentifier = convertAlgorithmIdentifier;
  table.HashAlgorithmIdentifier = convertAlgorithmIdentifier;
  table.KeyFormat = convertKeyFormat;
  table.KeyUsage = convertKeyUsage;
  table["sequence<KeyUsage>"] = convertKeyUsages;
  table.Algorithm = convertAlgorithm;
  table.BigInteger = convertBigInteger;
  table.BufferSource = convertBufferSource;
  table.CryptoKey = convertCryptoKey;
  table.NamedCurve = convertDOMString;
  table.RsaOtherPrimesInfo = convertRsaOtherPrimesInfo;
  table["sequence<RsaOtherPrimesInfo>"] = convertSequenceOfRsaOtherPrimesInfo;
  table.JsonWebKey = convertJsonWebKey;
  for (const name of [
    "RsaKeyGenParams",
    "RsaHashedKeyGenParams",
    "RsaHashedImportParams",
    "EcKeyImportParams",
    "EcKeyGenParams",
    "AesKeyGenParams",
    "RsaPssParams",
    "RsaOaepParams",
    "EcdsaParams",
    "HmacKeyGenParams",
    "HmacImportParams",
    "HkdfParams",
    "CShakeParams",
    "Pbkdf2Params",
    "AesDerivedKeyParams",
    "AesCbcParams",
    "AeadParams",
    "AesCtrParams",
    "EcdhKeyDeriveParams",
    "ContextParams",
    "Argon2Params",
    "KmacKeyGenParams",
    "KmacImportParams",
    "KmacParams",
    "KangarooTwelveParams",
    "TurboShakeParams",
  ]) {
    table[name] = dictionaryConverter(name);
  }
  return table;
}
