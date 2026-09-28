// `KeyObject` and its three kinds, from node v24.20.0
// `lib/internal/crypto/keys.js` and `src/crypto/crypto_keys.cc`.
//
// A secret key is bytes and nothing else, so its handle is the bytes. A
// public or private key is an OpenSSL `EVP_PKEY` in `keys.c`, and its handle
// is that key's number. The handle class is never exported from the module,
// which is what makes node's constructor check mean the same here -- a program
// cannot build a `KeyObject` from anything but a key this module made.
//
// Node's `KeyObjectHandle::Init` and `Export` decide in C++ which form of a key
// is which; here those decisions are the functions below `createPrivateKey`,
// and `keys.c` does only what OpenSSL must.

import { Buffer } from "../../buffer/src/main.ts";
import {
  ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS,
  ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS_BINDING,
  ERR_CRYPTO_INVALID_CURVE,
  ERR_CRYPTO_INVALID_JWK,
  ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE,
  ERR_CRYPTO_JWK_UNSUPPORTED_CURVE,
  ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE,
  ERR_CRYPTO_UNKNOWN_CIPHER,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_ARG_VALUE_BINDING,
  ERR_MISSING_PASSPHRASE,
} from "../../internal/errors.ts";
import { validateObject, validateOneOf, validateString } from "../../internal/validators.ts";
import { isAnyArrayBuffer, isArrayBufferView } from "../../util/src/types.ts";
import { bytesOf, cipherId, getArrayBufferOrView, peekedCryptoError } from "./util.ts";
import type { ByteSource } from "./util.ts";

export type KeyObjectType = "secret" | "public" | "private";

/** Node's key formats, numbered as `keys.c` numbers the two it parses. */
export const KeyFormat = { DER: 0, PEM: 1, JWK: 2, RawPublic: 3, RawPrivate: 4, RawSeed: 5 } as const;
/** Node's key encodings, numbered as `keys.c` numbers them. */
export const KeyEncoding = { PKCS1: 0, PKCS8: 1, SPKI: 2, SEC1: 3 } as const;
const encodingNames = ["pkcs1", "pkcs8", "spki", "sec1"];

/** `keys.c`'s statuses besides a handle. */
const KeyStatus = {
  Failed: 0,
  NeedPassphrase: -1,
  InvalidCurve: -2,
  UnsupportedType: -3,
  UnsupportedCurve: -4,
} as const;

/** Key material, held privately: a secret key's bytes, or `keys.c`'s handle for an `EVP_PKEY`. */
export class KeyObjectHandle {
  readonly #bytes: Uint8Array;
  readonly #native: number;

  constructor(bytes: Uint8Array, native: number) {
    this.#bytes = bytes;
    this.#native = native;
  }

  /** A secret key's bytes. */
  get bytes(): Uint8Array {
    return this.#bytes;
  }

  /** An asymmetric key's `keys.c` handle; 0 for a secret key. */
  get native(): number {
    return this.#native;
  }

  /** `KeyObjectHandle::Equals`: a secret's bytes in constant time, or `EVP_PKEY_eq`. */
  equals(other: KeyObjectHandle): boolean {
    if (this.#native !== 0 || other.#native !== 0) {
      return this.#native !== 0 && other.#native !== 0 && nts_crypto_key_equals(this.#native, other.#native);
    }
    const a = this.#bytes;
    const b = other.#bytes;
    return a.byteLength === b.byteLength && nts_crypto_timing_safe_equal(a, b);
  }
}

const noBytes = new Uint8Array(0);

function secretHandle(bytes: Uint8Array): KeyObjectHandle {
  return new KeyObjectHandle(bytes, 0);
}

function asymmetricHandle(native: number): KeyObjectHandle {
  return new KeyObjectHandle(noBytes, native);
}

/**
 * A key's slots, for this module's own readers -- node's `getKeyObjectHandle`
 * and `getKeyObjectType`.
 *
 * Read from inside the class, because only the class can read its `#` fields,
 * and never through the `type` getter, which is a configurable property a
 * program can replace (`test-crypto-keyobject-hidden-slots`). Not a static
 * method either, which would hand the key material to anyone holding the
 * exported class. The class fills these in as it is defined; they are fields
 * of an object rather than module-scope functions because the compiled lane
 * can store a closure in a field and cannot in a module-scope name.
 */
class KeyObjectSlots {
  handle: ((key: KeyObject) => KeyObjectHandle) | null = null;
  type: ((key: KeyObject) => KeyObjectType) | null = null;
}

const slots = new KeyObjectSlots();

/** A key's handle, read from its slot. */
export function handleOf(key: KeyObject): KeyObjectHandle {
  return slots.handle!(key);
}

/** A key's type, read from its slot rather than through the replaceable getter. */
export function typeOf(key: KeyObject): KeyObjectType {
  return slots.type!(key);
}

export class KeyObject {
  static {
    slots.handle = (key: KeyObject): KeyObjectHandle => key.#handle;
    slots.type = (key: KeyObject): KeyObjectType => key.#type;
  }

  readonly #type: KeyObjectType;
  readonly #handle: KeyObjectHandle;

  constructor(type: unknown, handle: unknown) {
    if (type !== "secret" && type !== "public" && type !== "private") {
      throw new ERR_INVALID_ARG_VALUE("type", type);
    }
    if (typeof handle !== "object" || !(handle instanceof KeyObjectHandle)) {
      throw new ERR_INVALID_ARG_TYPE("handle", "object", handle);
    }
    this.#type = type;
    this.#handle = handle;
  }

  get type(): KeyObjectType {
    return this.#type;
  }

  /**
   * `KeyObject.from(cryptoKey)`. This profile has no `CryptoKey` yet -- that is
   * Web Crypto's `subtle` -- so nothing a program holds can be one, and every
   * argument is refused as node refuses a value that is not.
   */
  static from(key: unknown): KeyObject {
    throw new ERR_INVALID_ARG_TYPE("key", "CryptoKey", key);
  }

  equals(otherKeyObject: unknown): boolean {
    if (!(otherKeyObject instanceof KeyObject)) {
      throw new ERR_INVALID_ARG_TYPE("otherKeyObject", "KeyObject", otherKeyObject);
    }
    return this.#type === otherKeyObject.#type && this.#handle.equals(otherKeyObject.#handle);
  }
}

export class SecretKeyObject extends KeyObject {
  constructor(handle: unknown) {
    super("secret", handle);
  }

  get symmetricKeySize(): number {
    return handleOf(this).bytes.byteLength;
  }

  export(options?: unknown): Buffer | { kty: string; k: string } {
    const bytes = handleOf(this).bytes;
    if (options !== undefined) {
      validateObject(options, "options");
      const format = (options as { format?: unknown }).format;
      validateOneOf(format, "options.format", [undefined, "buffer", "jwk"]);
      if (format === "jwk") {
        return { kty: "oct", k: Buffer.from(bytes).toString("base64url") };
      }
    }
    return Buffer.from(bytes);
  }
}

// -- asymmetric keys ----------------------------------------------------------

/** What `asymmetricKeyDetails` reports, per family. */
export interface AsymmetricKeyDetails {
  modulusLength?: number;
  publicExponent?: bigint;
  hashAlgorithm?: string;
  mgf1HashAlgorithm?: string;
  saltLength?: number;
  divisorLength?: number;
  namedCurve?: string;
}

/** Big-endian bytes as an unsigned bigint: node's `bigIntArrayToUnsignedBigInt`. */
function unsignedBigInt(bytes: Uint8Array): bigint {
  let value = 0n;
  for (let i = 0; i < bytes.length; i++) value = (value << 8n) | BigInt(bytes[i]!);
  return value;
}

/**
 * Node's `GetAsymmetricKeyDetail` and `normalizeKeyDetails`: RSA's modulus
 * and exponent, RSA-PSS's restrictions when it has them, DSA's two lengths,
 * EC's curve, and nothing for the rest.
 */
function detailsOf(native: number, keyType: string | undefined): AsymmetricKeyDetails {
  const details: AsymmetricKeyDetails = {};
  const numbers = nts_crypto_key_details(native);
  const names = nts_crypto_key_detail_names(native);
  switch (keyType) {
    case "rsa":
    case "rsa-pss":
      details.modulusLength = numbers[0]!;
      details.publicExponent = unsignedBigInt(nts_crypto_key_public_exponent(native));
      if (keyType === "rsa-pss" && names[1] !== "") {
        details.hashAlgorithm = names[1]!;
        if (names[2] !== "") details.mgf1HashAlgorithm = names[2]!;
        details.saltLength = numbers[2]!;
      }
      break;
    case "dsa":
      details.modulusLength = numbers[0]!;
      details.divisorLength = numbers[1]!;
      break;
    case "ec":
      if (names[0] !== "") details.namedCurve = names[0]!;
      break;
    default:
      break;
  }
  return details;
}

export class AsymmetricKeyObject extends KeyObject {
  #details: AsymmetricKeyDetails | undefined;

  get asymmetricKeyType(): string | undefined {
    const name = nts_crypto_key_type(handleOf(this).native);
    return name === "" ? undefined : name;
  }

  /** A copy each time, as node's getter spreads its cached details. */
  get asymmetricKeyDetails(): AsymmetricKeyDetails {
    this.#details ??= detailsOf(handleOf(this).native, this.asymmetricKeyType);
    return { ...this.#details };
  }
}

export interface JsonWebKey {
  kty?: string;
  crv?: string;
  x?: string;
  y?: string;
  d?: string;
  n?: string;
  e?: string;
  p?: string;
  q?: string;
  dp?: string;
  dq?: string;
  qi?: string;
}

const base64url = (bytes: Uint8Array): string =>
  new Buffer(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength).toString("base64url");

function okpCurveName(keyType: string | undefined): string {
  switch (keyType) {
    case "ed25519":
      return "Ed25519";
    case "ed448":
      return "Ed448";
    case "x25519":
      return "X25519";
    default:
      return "X448";
  }
}

/** JWK's names for the four curves it has them for; `keys.c` refuses the rest. */
function jwkCurveName(namedCurve: string | undefined): string | undefined {
  switch (namedCurve) {
    case "prime256v1":
      return "P-256";
    case "secp384r1":
      return "P-384";
    case "secp521r1":
      return "P-521";
    default:
      return namedCurve;
  }
}

/**
 * Node's `ExportJWKAsymmetricKey`, with its property order: RSA
 * `kty n e [d p q dp dq qi]`, EC `kty x y crv [d]`, OKP `crv [d] x kty`.
 * RSA-PSS has no JWK form here, as `KeyObject#export` has none in node.
 */
function exportJwk(key: AsymmetricKeyObject, privateKey: boolean): JsonWebKey {
  const native = handleOf(key).native;
  const parts = nts_crypto_key_export_jwk(native, privateKey);
  if (parts.length === 0) {
    if (nts_crypto_key_status() === KeyStatus.UnsupportedCurve) {
      throw new ERR_CRYPTO_JWK_UNSUPPORTED_CURVE(
        `Unsupported JWK EC curve: ${nts_crypto_key_detail_names(native)[0]}.`,
      );
    }
    throw new ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE();
  }
  const keyType = key.asymmetricKeyType;
  if (keyType === "rsa") {
    const jwk: JsonWebKey = { kty: "RSA", n: base64url(parts[0]!), e: base64url(parts[1]!) };
    if (privateKey) {
      jwk.d = base64url(parts[2]!);
      jwk.p = base64url(parts[3]!);
      jwk.q = base64url(parts[4]!);
      jwk.dp = base64url(parts[5]!);
      jwk.dq = base64url(parts[6]!);
      jwk.qi = base64url(parts[7]!);
    }
    return jwk;
  }
  if (keyType === "ec") {
    const jwk: JsonWebKey = { kty: "EC", x: base64url(parts[0]!), y: base64url(parts[1]!) };
    jwk.crv = jwkCurveName(key.asymmetricKeyDetails.namedCurve);
    if (privateKey) jwk.d = base64url(parts[2]!);
    return jwk;
  }
  const jwk: JsonWebKey = { crv: okpCurveName(keyType) };
  if (privateKey) jwk.d = base64url(parts[1]!);
  jwk.x = base64url(parts[0]!);
  jwk.kty = "OKP";
  return jwk;
}

/** A key's raw form, or node's refusal for one it has none of. */
function exportRaw(key: AsymmetricKeyObject, privateKey: boolean, compressed: boolean): Buffer {
  const bytes = nts_crypto_key_export_raw(handleOf(key).native, privateKey, compressed);
  if (bytes === null) {
    throw new ERR_INVALID_ARG_VALUE_BINDING(privateKey ? "Failed to get raw private key" : "Failed to get raw public key");
  }
  return new Buffer(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
}

/** PEM is text and DER is bytes, as node's `ToV8Value` returns them. */
function encoded(bytes: Uint8Array, format: number): Buffer | string {
  const buffer = new Buffer(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
  return format === KeyFormat.PEM ? buffer.toString("utf8") : buffer;
}

export class PublicKeyObject extends AsymmetricKeyObject {
  constructor(handle: unknown) {
    super("public", handle);
  }

  export(options?: KeyExportOptions): Buffer | string | JsonWebKey {
    switch (options?.format) {
      case "jwk":
        return exportJwk(this, false);
      case "raw-public": {
        const type = options.type ?? "uncompressed";
        if (this.asymmetricKeyType === "ec") {
          validateOneOf(type, "options.type", ["compressed", "uncompressed"]);
        }
        return exportRaw(this, false, type === "compressed");
      }
      default: {
        const { format, type } = parsePublicKeyEncoding(options, this.asymmetricKeyType, undefined);
        const bytes = nts_crypto_key_export_public(handleOf(this).native, format, type ?? -1);
        if (bytes === null) throw peekedCryptoError("Failed to encode public key");
        return encoded(bytes, format);
      }
    }
  }
}

export class PrivateKeyObject extends AsymmetricKeyObject {
  constructor(handle: unknown) {
    super("private", handle);
  }

  export(options?: KeyExportOptions): Buffer | string | JsonWebKey {
    if (options?.passphrase !== undefined && options.format !== "pem" && options.format !== "der") {
      throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS(String(options.format), "does not support encryption");
    }
    switch (options?.format) {
      case "jwk":
        return exportJwk(this, true);
      case "raw-private":
        return exportRaw(this, true, false);
      default: {
        const { format, type, cipher, passphrase } = parsePrivateKeyEncoding(
          options,
          this.asymmetricKeyType,
          undefined,
        );
        let id = -1;
        if (cipher !== undefined && cipher !== null) {
          id = cipherId(cipher as string);
          if (id < 0) throw new ERR_CRYPTO_UNKNOWN_CIPHER();
        }
        const bytes = nts_crypto_key_export_private(
          handleOf(this).native,
          format,
          type ?? -1,
          id,
          passphrase === undefined ? noBytes : bytesOf(passphrase),
        );
        if (bytes === null) throw peekedCryptoError("Failed to encode private key");
        return encoded(bytes, format);
      }
    }
  }
}

// -- encodings, as node parses them ------------------------------------------

export interface KeyExportOptions {
  format?: string;
  type?: string;
  cipher?: string;
  passphrase?: string | ArrayBufferView;
  encoding?: string;
}

interface KeyEncoding {
  format: number;
  type: number | undefined;
  cipher?: unknown;
  passphrase?: ByteSource;
}

function parseKeyFormat(formatStr: unknown, defaultFormat: number | undefined, optionName: string): number {
  if (formatStr === undefined && defaultFormat !== undefined) return defaultFormat;
  switch (formatStr) {
    case "pem":
      return KeyFormat.PEM;
    case "der":
      return KeyFormat.DER;
    case "jwk":
      return KeyFormat.JWK;
    case "raw-public":
      return KeyFormat.RawPublic;
    case "raw-private":
      return KeyFormat.RawPrivate;
    case "raw-seed":
      return KeyFormat.RawSeed;
    default:
      throw new ERR_INVALID_ARG_VALUE(optionName, formatStr);
  }
}

function parseKeyType(
  typeStr: unknown,
  required: boolean,
  keyType: string | undefined,
  isPublic: boolean | undefined,
  optionName: string,
): number | undefined {
  if (typeStr === undefined && !required) return undefined;
  if (typeStr === "pkcs1") {
    if (keyType !== undefined && keyType !== "rsa") {
      throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS(typeStr, "can only be used for RSA keys");
    }
    return KeyEncoding.PKCS1;
  }
  if (typeStr === "spki" && isPublic !== false) return KeyEncoding.SPKI;
  if (typeStr === "pkcs8" && isPublic !== true) return KeyEncoding.PKCS8;
  if (typeStr === "sec1" && isPublic !== true) {
    if (keyType !== undefined && keyType !== "ec") {
      throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS(typeStr, "can only be used for EC keys");
    }
    return KeyEncoding.SEC1;
  }
  throw new ERR_INVALID_ARG_VALUE(optionName, typeStr);
}

function option(name: string, prefix: string | undefined): string {
  return prefix === undefined ? `options.${name}` : `${prefix}.${name}`;
}

function parseKeyFormatAndType(
  enc: KeyExportOptions,
  keyType: string | undefined,
  isPublic: boolean | undefined,
  objName: string | undefined,
): KeyEncoding {
  const formatStr = enc.format;
  const typeStr = enc.type;
  const isInput = keyType === undefined;
  const format = parseKeyFormat(formatStr, isInput ? KeyFormat.PEM : undefined, option("format", objName));

  if (format === KeyFormat.RawPublic) {
    if (isPublic === false) throw new ERR_INVALID_ARG_VALUE(option("format", objName), "raw-public");
    if (typeStr !== undefined && typeStr !== "uncompressed" && typeStr !== "compressed") {
      throw new ERR_INVALID_ARG_VALUE(option("type", objName), typeStr);
    }
    return { format, type: undefined };
  }
  if (format === KeyFormat.RawPrivate || format === KeyFormat.RawSeed) {
    if (isPublic === true) {
      throw new ERR_INVALID_ARG_VALUE(
        option("format", objName),
        format === KeyFormat.RawPrivate ? "raw-private" : "raw-seed",
      );
    }
    if (typeStr !== undefined) throw new ERR_INVALID_ARG_VALUE(option("type", objName), typeStr);
    return { format, type: undefined };
  }
  const isRequired = (!isInput || format === KeyFormat.DER) && format !== KeyFormat.JWK;
  const type = parseKeyType(typeStr, isRequired, keyType, isPublic, option("type", objName));
  return { format, type };
}

function isStringOrBuffer(value: unknown): boolean {
  return typeof value === "string" || isArrayBufferView(value) || isAnyArrayBuffer(value);
}

/** Node's `parseKeyEncoding`: format and type, and for a private key its encryption. */
function parseKeyEncoding(
  enc: unknown,
  keyType: string | undefined,
  isPublic: boolean | undefined,
  objName: string | undefined,
): KeyEncoding {
  validateObject(enc, "options");
  const options = enc as KeyExportOptions;
  const isInput = keyType === undefined;
  const { format, type } = parseKeyFormatAndType(options, keyType, isPublic, objName);

  let cipher: unknown;
  let passphrase: unknown;
  let encoding: string | undefined;
  if (isPublic !== true) {
    cipher = options.cipher;
    passphrase = options.passphrase;
    encoding = options.encoding;

    if (format === KeyFormat.RawPrivate || format === KeyFormat.RawSeed) {
      if ((cipher !== undefined && cipher !== null) || passphrase !== undefined) {
        throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS("raw format", "does not support encryption");
      }
      return { format, type };
    }

    if (!isInput) {
      if (cipher !== undefined && cipher !== null) {
        if (typeof cipher !== "string") throw new ERR_INVALID_ARG_VALUE(option("cipher", objName), cipher);
        if (format === KeyFormat.DER && (type === KeyEncoding.PKCS1 || type === KeyEncoding.SEC1)) {
          throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS(encodingNames[type]!, "does not support encryption");
        }
      } else if (passphrase !== undefined) {
        throw new ERR_INVALID_ARG_VALUE(
          option("cipher", objName),
          cipher,
          "is required when a passphrase is specified",
        );
      }
    }

    if (
      (isInput && passphrase !== undefined && !isStringOrBuffer(passphrase)) ||
      (!isInput && cipher !== undefined && cipher !== null && !isStringOrBuffer(passphrase))
    ) {
      throw new ERR_INVALID_ARG_VALUE(option("passphrase", objName), passphrase);
    }
  }

  const bytes = passphrase === undefined ? undefined : getArrayBufferOrView(passphrase, "key.passphrase", encoding);
  return { format, type, cipher, passphrase: bytes };
}

function parsePublicKeyEncoding(enc: unknown, keyType: string | undefined, objName: string | undefined): KeyEncoding {
  return parseKeyEncoding(enc, keyType, keyType ? true : undefined, objName);
}

function parsePrivateKeyEncoding(enc: unknown, keyType: string | undefined, objName: string | undefined): KeyEncoding {
  return parseKeyEncoding(enc, keyType, false, objName);
}

/** Node's key contexts: what a caller is about to do with the key. */
export const KeyContext = { ConsumePublic: 0, ConsumePrivate: 1, CreatePublic: 2, CreatePrivate: 3 } as const;

function validateAsymmetricKeyType(type: KeyObjectType, context: number, key: unknown): void {
  if (context === KeyContext.CreatePrivate) {
    throw new ERR_INVALID_ARG_TYPE("key", ["string", "ArrayBuffer", "Buffer", "TypedArray", "DataView"], key);
  }
  if (type !== "private") {
    if (context === KeyContext.ConsumePrivate || context === KeyContext.CreatePublic) {
      throw new ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(type, "private");
    }
    if (type !== "public") throw new ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(type, "private or public");
  }
}

/** Node's `getKeyTypes`: the accepted kinds, as the error lists them. */
function keyTypes(allowKeyObject: boolean, bufferOnly = false): string[] {
  const types = ["ArrayBuffer", "Buffer", "TypedArray", "DataView", "string", "KeyObject", "CryptoKey"];
  if (bufferOnly) return types.slice(0, 4);
  if (!allowKeyObject) return types.slice(0, 5);
  return types;
}

/** Where a key comes from: an existing key's handle, or data in a format. */
export interface PreparedKey {
  handle?: KeyObjectHandle;
  data?: unknown;
  format?: number;
  type?: number;
  passphrase?: ByteSource;
  asymmetricKeyType?: string;
  namedCurve?: string | null;
}

interface KeyInput {
  key?: unknown;
  encoding?: string;
  format?: unknown;
  asymmetricKeyType?: unknown;
  namedCurve?: unknown;
}

/** Node's `prepareAsymmetricKey`: every way a program may name an asymmetric key. */
export function prepareAsymmetricKey(key: unknown, context: number, name = "key"): PreparedKey {
  if (key instanceof KeyObject) {
    validateAsymmetricKeyType(typeOf(key), context, key);
    return { handle: handleOf(key) };
  }
  if (isStringOrBuffer(key)) {
    // PEM by default, mostly for backward compatibility.
    return { format: KeyFormat.PEM, data: getArrayBufferOrView(key, name) };
  }
  if (typeof key === "object" && key !== null) {
    const given = key as KeyInput;
    const data = given.key;
    const format = given.format;
    // `key` may be a KeyObject, to carry options such as padding beside it.
    if (data instanceof KeyObject) {
      validateAsymmetricKeyType(typeOf(data), context, data);
      return { handle: handleOf(data) };
    }
    if (format === "jwk") {
      validateObject(data, `${name}.key`);
      return { data, format: KeyFormat.JWK };
    }
    if (format === "raw-public" || format === "raw-private" || format === "raw-seed") {
      if ((context === KeyContext.ConsumePrivate || context === KeyContext.CreatePrivate) && format === "raw-public") {
        throw new ERR_INVALID_ARG_VALUE(`${name}.format`, format);
      }
      if (!isArrayBufferView(data) && !isAnyArrayBuffer(data)) {
        throw new ERR_INVALID_ARG_TYPE(`${name}.key`, ["ArrayBuffer", "Buffer", "TypedArray", "DataView"], data);
      }
      validateString(given.asymmetricKeyType, `${name}.asymmetricKeyType`);
      if (given.asymmetricKeyType === "ec") validateString(given.namedCurve, `${name}.namedCurve`);
      return {
        data: getArrayBufferOrView(data, `${name}.key`),
        format: parseKeyFormat(format, undefined, `${name}.format`),
        asymmetricKeyType: given.asymmetricKeyType,
        namedCurve: (given.namedCurve as string | undefined) ?? null,
      };
    }
    // Either PEM, or DER in one of the four encodings.
    if (!isStringOrBuffer(data)) {
      throw new ERR_INVALID_ARG_TYPE(`${name}.key`, keyTypes(context !== KeyContext.CreatePrivate), data);
    }
    const isPublic = context === KeyContext.ConsumePrivate || context === KeyContext.CreatePrivate ? false : undefined;
    const encoding = parseKeyEncoding(key, undefined, isPublic, name);
    return {
      data: getArrayBufferOrView(data, `${name}.key`, given.encoding),
      format: encoding.format,
      type: encoding.type,
      passphrase: encoding.passphrase,
    };
  }
  throw new ERR_INVALID_ARG_TYPE(name, keyTypes(context !== KeyContext.CreatePrivate), key);
}

// -- making a key's handle, as node's KeyObjectHandle::Init -------------------

/** A key parsed from PEM or DER, or node's error for why it is not one. */
function parsed(native: number, message: string): number {
  if (native > 0) return native;
  if (native === KeyStatus.NeedPassphrase) {
    throw new ERR_MISSING_PASSPHRASE("Passphrase required for encrypted key");
  }
  throw peekedCryptoError(message);
}

function jwkString(value: unknown, message: string): string {
  if (typeof value !== "string") throw new ERR_CRYPTO_INVALID_JWK(message);
  return value;
}

/** Base64 of either alphabet, as `ByteSource::FromEncodedString` reads a JWK member. */
function jwkBytes(value: string): Uint8Array {
  return Buffer.from(value, "base64");
}

/** A handle from a JWK or raw import, and whether it holds private material. */
interface Imported {
  native: number;
  privateKey: boolean;
}

/** Node's `ImportJWKFromArgs`. */
function importJwk(jwk: JsonWebKey): Imported {
  const kty = jwk.kty;
  if (typeof kty !== "string") throw new ERR_CRYPTO_INVALID_JWK("Invalid JWK format");
  if (kty === "RSA") {
    const message = "Invalid JWK RSA key";
    const n = jwkString(jwk.n, message);
    const e = jwkString(jwk.e, message);
    if (jwk.d !== undefined && typeof jwk.d !== "string") throw new ERR_CRYPTO_INVALID_JWK(message);
    const privateKey = typeof jwk.d === "string";
    const parts = [jwkBytes(n), jwkBytes(e)];
    if (privateKey) {
      for (const member of [jwk.d, jwk.p, jwk.q, jwk.dp, jwk.dq, jwk.qi]) {
        parts.push(jwkBytes(jwkString(member, message)));
      }
    }
    const native = nts_crypto_key_from_jwk_rsa(parts, privateKey);
    if (native <= 0) throw new ERR_CRYPTO_INVALID_JWK(message);
    return { native, privateKey };
  }
  if (kty === "EC") {
    const message = "Invalid JWK EC key";
    const crv = jwkString(jwk.crv, message);
    if (!nts_crypto_key_curve_known(crv)) throw new ERR_CRYPTO_INVALID_CURVE();
    const x = jwkString(jwk.x, message);
    const y = jwkString(jwk.y, message);
    if (jwk.d !== undefined && typeof jwk.d !== "string") throw new ERR_CRYPTO_INVALID_JWK(message);
    const privateKey = typeof jwk.d === "string";
    const native = nts_crypto_key_from_jwk_ec(
      crv,
      jwkBytes(x),
      jwkBytes(y),
      privateKey ? jwkBytes(jwk.d as string) : noBytes,
      privateKey,
    );
    if (native <= 0) throw new ERR_CRYPTO_INVALID_JWK(message);
    return { native, privateKey };
  }
  if (kty === "OKP") {
    const message = "Invalid JWK OKP key";
    const crv = jwkString(jwk.crv, message);
    const x = jwkString(jwk.x, message);
    if (jwk.d !== undefined && typeof jwk.d !== "string") throw new ERR_CRYPTO_INVALID_JWK(message);
    const privateKey = typeof jwk.d === "string";
    const native = nts_crypto_key_from_okp(crv, jwkBytes(privateKey ? (jwk.d as string) : x), privateKey);
    if (native <= 0) throw new ERR_CRYPTO_INVALID_JWK(message);
    return { native, privateKey };
  }
  if (kty === "AKP") throw new ERR_INVALID_ARG_VALUE_BINDING("Unsupported key type");
  throw new ERR_CRYPTO_INVALID_JWK(`${kty} is not a supported JWK key type`);
}

/** The Edwards and Montgomery curves by the names `ImportRawKey` accepts, case aside. */
function okpName(name: string): string | undefined {
  switch (name.toLowerCase()) {
    case "ed25519":
      return "Ed25519";
    case "ed448":
      return "Ed448";
    case "x25519":
      return "X25519";
    case "x448":
      return "X448";
    default:
      return undefined;
  }
}

/** A post-quantum key type node knows by name, which this module does not implement yet. */
function isPostQuantumName(keyType: string): boolean {
  return keyType.startsWith("ml-dsa-") || keyType.startsWith("ml-kem-") || keyType.startsWith("slh-dsa-");
}

/** Node's `ImportRawKey`: an EC or OKP key from its raw public or private form. */
function importRaw(prepared: PreparedKey): Imported {
  const keyType = prepared.asymmetricKeyType!;
  const format = prepared.format!;
  const privateKey = format !== KeyFormat.RawPublic;
  const okp = okpName(keyType);
  if (keyType === "ec" || okp !== undefined) {
    if (format === KeyFormat.RawSeed) throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS_BINDING();
  } else if (keyType === "rsa" || keyType === "rsa-pss" || keyType === "dsa" || keyType === "dh") {
    throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS_BINDING();
  } else if (isPostQuantumName(keyType)) {
    throw new ERR_INVALID_ARG_VALUE_BINDING("Unsupported key type");
  } else {
    throw new ERR_INVALID_ARG_VALUE_BINDING(`Invalid asymmetricKeyType: ${keyType}`);
  }
  const raw = bytesOf(prepared.data as ByteSource);
  const native =
    keyType === "ec"
      ? nts_crypto_key_from_raw_ec(prepared.namedCurve ?? "", raw, privateKey)
      : nts_crypto_key_from_okp(okp!, raw, privateKey);
  if (native === KeyStatus.InvalidCurve) throw new ERR_CRYPTO_INVALID_CURVE();
  if (native <= 0) throw new ERR_INVALID_ARG_VALUE_BINDING("Invalid key data");
  return { native, privateKey };
}

/** An asymmetric key's handle, as node's `KeyObjectHandle::Init` makes it. */
function initAsymmetric(prepared: PreparedKey, wantPublic: boolean): KeyObjectHandle {
  if (prepared.handle !== undefined) return prepared.handle;
  const format = prepared.format!;
  if (format === KeyFormat.RawPublic || format === KeyFormat.RawPrivate || format === KeyFormat.RawSeed) {
    return asymmetricHandle(importRaw(prepared).native);
  }
  if (format === KeyFormat.JWK) {
    const { native, privateKey } = importJwk(prepared.data as JsonWebKey);
    if (!wantPublic && !privateKey) throw new ERR_CRYPTO_INVALID_JWK("JWK does not contain private key material");
    return asymmetricHandle(native);
  }
  const data = bytesOf(prepared.data as ByteSource);
  const passphrase = prepared.passphrase === undefined ? noBytes : bytesOf(prepared.passphrase);
  const hasPassphrase = prepared.passphrase !== undefined;
  const type = prepared.type ?? -1;
  if (wantPublic) {
    return asymmetricHandle(
      parsed(nts_crypto_key_parse_public(format, type, data, passphrase, hasPassphrase), "Failed to read asymmetric key"),
    );
  }
  return asymmetricHandle(
    parsed(nts_crypto_key_parse_private(format, type, data, passphrase, hasPassphrase), "Failed to read private key"),
  );
}

/** `crypto.createPublicKey(key)`: from a public key, or a private key's public half. */
export function createPublicKey(key: unknown): PublicKeyObject {
  const prepared = prepareAsymmetricKey(key, KeyContext.CreatePublic);
  return new PublicKeyObject(initAsymmetric(prepared, true));
}

/** `crypto.createPrivateKey(key)`. */
export function createPrivateKey(key: unknown): PrivateKeyObject {
  const prepared = prepareAsymmetricKey(key, KeyContext.CreatePrivate);
  return new PrivateKeyObject(initAsymmetric(prepared, false));
}

/** A key to sign or decrypt with: a private key, and how the caller named it. */
export function preparePrivateKey(key: unknown, name = "key"): KeyObjectHandle {
  return initAsymmetric(prepareAsymmetricKey(key, KeyContext.ConsumePrivate, name), false);
}

/** A key to verify or encrypt with: a public key, or a private key's public half. */
export function preparePublicOrPrivateKey(key: unknown, name = "key"): KeyObjectHandle {
  return initAsymmetric(prepareAsymmetricKey(key, KeyContext.ConsumePublic, name), true);
}

// -- secret keys --------------------------------------------------------------

/**
 * Node's `prepareSecretKey`, answering the bytes: a secret `KeyObject`'s own,
 * or the argument's. Unless `bufferOnly`, a `KeyObject` of another type is
 * refused by name.
 */
export function prepareSecretKey(key: unknown, encoding: string | undefined, bufferOnly = false): Uint8Array {
  if (!bufferOnly && key instanceof KeyObject) {
    const type = typeOf(key);
    if (type !== "secret") throw new ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE(type, "secret");
    return handleOf(key).bytes;
  }
  if (typeof key !== "string" && !isArrayBufferView(key) && !isAnyArrayBuffer(key)) {
    throw new ERR_INVALID_ARG_TYPE("key", keyTypes(!bufferOnly, bufferOnly), key);
  }
  return bytesOf(getArrayBufferOrView(key, "key", encoding));
}

/**
 * `crypto.createSecretKey(key[, encoding])`. The bytes are copied, as
 * `KeyObjectHandle::Init` copies them: a key does not change when the buffer
 * it was made from does.
 */
export function createSecretKey(key: unknown, encoding?: string): SecretKeyObject {
  const bytes = prepareSecretKey(key, encoding, true);
  // Copied into a fresh array, not with `slice`: the bytes may be a `Buffer`,
  // whose `slice` is node's alias for `subarray` and shares them.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new SecretKeyObject(secretHandle(copy));
}
