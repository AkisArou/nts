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
  ERR_CRYPTO_OPERATION_FAILED,
  ERR_CRYPTO_UNKNOWN_CIPHER,
  ERR_INVALID_ARG_TYPE,
  ERR_INVALID_ARG_VALUE,
  ERR_INVALID_ARG_VALUE_BINDING,
  ERR_INVALID_THIS,
  ERR_MISSING_PASSPHRASE,
} from "../../internal/errors.ts";
import { registerKeyObjectBrand } from "../../internal/brands.ts";
import { emitDeprecationOnce } from "../../internal/deprecate.ts";
import { validateObject, validateOneOf, validateString } from "../../internal/validators.ts";
import { isAnyArrayBuffer, isArrayBufferView } from "../../util/src/types.ts";
import {
  base64urlOf,
  bytesOf,
  bytesOfBase64,
  cipherId,
  getArrayBufferOrView,
  markedCryptoError,
  peekedCryptoError,
  unsignedBigInt,
} from "./util.ts";
import type { ByteSource } from "./util.ts";
import { type CryptoKey, getCryptoKeyExtractable, getCryptoKeyHandle, getCryptoKeyType, isCryptoKey } from "./webcrypto/key.ts";

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

/** A secret key object over bytes the caller gives up. */
export function secretKeyObjectOf(bytes: Uint8Array): SecretKeyObject {
  return new SecretKeyObject(secretHandle(bytes));
}

function secretHandle(bytes: Uint8Array): KeyObjectHandle {
  return new KeyObjectHandle(bytes, 0);
}

export function asymmetricHandle(native: number): KeyObjectHandle {
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
  brand: ((value: object) => boolean) | null = null;
  handle: ((key: KeyObject) => KeyObjectHandle) | null = null;
  type: ((key: KeyObject) => KeyObjectType) | null = null;
}

const slots = new KeyObjectSlots();

/**
 * Node's `isKeyObject`: the brand, a private field only the constructor can
 * put there -- not the prototype chain, and not `Symbol.hasInstance`, both of
 * which a program can forge (`test-crypto-keyobject-brand-check`).
 */
export function isKeyObject(value: unknown): value is KeyObject {
  return typeof value === "object" && value !== null && slots.brand!(value);
}

/** Node's `getKeyObjectSlots`: a key's, or `ERR_INVALID_THIS` for anything else. */
function branded(key: unknown): KeyObject {
  if (!isKeyObject(key)) throw new ERR_INVALID_THIS("KeyObject");
  return key;
}

/** A key's handle, read from its slot. */
export function handleOf(key: unknown): KeyObjectHandle {
  return slots.handle!(branded(key));
}

/** A key's type, read from its slot rather than through the replaceable getter. */
export function typeOf(key: unknown): KeyObjectType {
  return slots.type!(branded(key));
}

/**
 * Web Crypto's half of `toCryptoKey`, installed as Web Crypto loads: its
 * families import this module, so this module reaches them through a hook
 * rather than an import of its own -- as `internal/brands.ts` does for util.
 */
class WebCryptoHooks {
  toCryptoKey:
    | ((type: KeyObjectType, handle: KeyObjectHandle, algorithm: unknown, extractable: unknown, keyUsages: unknown) => CryptoKey)
    | null = null;
}

export const webCryptoHooks = new WebCryptoHooks();

export class KeyObject {
  static {
    slots.brand = (value: object): boolean => #handle in value;
    slots.handle = (key: KeyObject): KeyObjectHandle => key.#handle;
    slots.type = (key: KeyObject): KeyObjectType => key.#type;
    registerKeyObjectBrand(slots.brand);
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
    return typeOf(this);
  }

  /** `KeyObject.from(cryptoKey)`: the same key material, as a key object of its type. */
  static from(key: unknown): KeyObject {
    if (!isCryptoKey(key)) throw new ERR_INVALID_ARG_TYPE("key", "CryptoKey", key);
    if (!getCryptoKeyExtractable(key)) {
      emitDeprecationOnce("Passing a non-extractable CryptoKey to KeyObject.from() is deprecated.", "DEP0204");
    }
    const handle = getCryptoKeyHandle(key);
    switch (getCryptoKeyType(key)) {
      case "secret":
        return new SecretKeyObject(handle);
      case "public":
        return new PublicKeyObject(handle);
      default:
        return new PrivateKeyObject(handle);
    }
  }

  /**
   * `keyObject.toCryptoKey(algorithm, extractable, keyUsages)`: the same key
   * material imported as `subtle.importKey` would import it, through the hook
   * Web Crypto installs (`webCryptoHooks`).
   */
  toCryptoKey(algorithm: unknown, extractable: unknown, keyUsages: unknown): CryptoKey {
    return webCryptoHooks.toCryptoKey!(typeOf(this), handleOf(this), algorithm, extractable, keyUsages);
  }

  equals(otherKeyObject: unknown): boolean {
    if (!isKeyObject(otherKeyObject)) {
      throw new ERR_INVALID_ARG_TYPE("otherKeyObject", "KeyObject", otherKeyObject);
    }
    return typeOf(this) === typeOf(otherKeyObject) && handleOf(this).equals(handleOf(otherKeyObject));
  }
}

export class SecretKeyObject extends KeyObject {
  constructor(handle: unknown) {
    super("secret", handle);
  }

  get symmetricKeySize(): number {
    if (typeOf(this) !== "secret") throw new ERR_INVALID_THIS("SecretKeyObject");
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

/** A handle's key type name, as `asymmetricKeyType` reports it: undefined for none node names. */
export function asymmetricKeyTypeOfNative(native: number): string | undefined {
  const name = nts_crypto_key_type(native);
  return name === "" ? undefined : name;
}

/** A handle's details, as `asymmetricKeyDetails` reports them. */
export function keyDetailsOf(native: number): AsymmetricKeyDetails {
  return detailsOf(native, asymmetricKeyTypeOfNative(native));
}

/** An asymmetric key's handle, or `ERR_INVALID_THIS` for anything else. */
function asymmetricHandleOf(key: unknown): KeyObjectHandle {
  if (typeOf(key) === "secret") throw new ERR_INVALID_THIS("AsymmetricKeyObject");
  return handleOf(key);
}

/** A key's type name, read through its handle and not the replaceable getter. */
function asymmetricKeyTypeOf(handle: KeyObjectHandle): string | undefined {
  return asymmetricKeyTypeOfNative(handle.native);
}

/** Node's `getKeyObjectAsymmetricKeyType`: read from the slot, not the replaceable getter. */
export function asymmetricKeyTypeOfKey(key: KeyObject): string | undefined {
  return asymmetricKeyTypeOf(asymmetricHandleOf(key));
}

export class AsymmetricKeyObject extends KeyObject {
  #details: AsymmetricKeyDetails | undefined;

  get asymmetricKeyType(): string | undefined {
    return asymmetricKeyTypeOf(asymmetricHandleOf(this));
  }

  /** A copy each time, as node's getter spreads its cached details. */
  get asymmetricKeyDetails(): AsymmetricKeyDetails {
    const handle = asymmetricHandleOf(this);
    this.#details ??= detailsOf(handle.native, asymmetricKeyTypeOf(handle));
    return { ...this.#details };
  }
}

export interface JsonWebKey {
  kty?: string;
  alg?: string;
  pub?: string;
  priv?: string;
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
  return exportJwkOf(handleOf(key).native, privateKey);
}

/** The same, for the key behind a handle -- a `KeyObject`'s or a `CryptoKey`'s. */
export function exportJwkOf(native: number, privateKey: boolean): JsonWebKey {
  const keyType = nts_crypto_key_type(native);
  if (isPostQuantumName(keyType)) return exportAkpJwk(native, keyType, privateKey);
  const parts = nts_crypto_key_export_jwk(native, privateKey);
  if (parts.length === 0) {
    if (nts_crypto_key_status() === KeyStatus.UnsupportedCurve) {
      throw new ERR_CRYPTO_JWK_UNSUPPORTED_CURVE(
        `Unsupported JWK EC curve: ${nts_crypto_key_detail_names(native)[0]}.`,
      );
    }
    throw new ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE();
  }
  // Each member defined in a literal, never assigned: a JWK a program is
  // handed has no member an inherited setter saw, as node's native export
  // defines its members.
  const b64 = (index: number): string => base64urlOf(parts[index]!);
  if (keyType === "rsa") {
    if (!privateKey) return { kty: "RSA", n: b64(0), e: b64(1) };
    return { kty: "RSA", n: b64(0), e: b64(1), d: b64(2), p: b64(3), q: b64(4), dp: b64(5), dq: b64(6), qi: b64(7) };
  }
  if (keyType === "ec") {
    const curve = nts_crypto_key_detail_names(native)[0];
    const crv = jwkCurveName(curve === "" ? undefined : curve);
    if (!privateKey) return { kty: "EC", x: b64(0), y: b64(1), crv };
    return { kty: "EC", x: b64(0), y: b64(1), crv, d: b64(2) };
  }
  const crv = okpCurveName(keyType);
  if (!privateKey) return { crv, x: b64(0), kty: "OKP" };
  return { crv, d: b64(1), x: b64(0), kty: "OKP" };
}

/**
 * Node's `ExportJwkPqcKey`: `AKP`, with OpenSSL's name as `alg`, the raw public
 * key as `pub`, and for a private key its seed -- or SLH-DSA's raw private
 * key -- as `priv`, first.
 */
function exportAkpJwk(native: number, keyType: string, privateKey: boolean): JsonWebKey {
  let priv: string | undefined;
  if (privateKey) {
    const seeded = hasSeed(keyType);
    const secret = seeded ? nts_crypto_key_export_seed(native) : nts_crypto_key_export_raw(native, true, false);
    if (secret === null) {
      throw new ERR_CRYPTO_OPERATION_FAILED(seeded ? "key does not have an available seed" : "Failed to get raw private key");
    }
    priv = base64urlOf(secret);
  }
  const alg = postQuantumAlgOf(keyType);
  const pub = nts_crypto_key_export_raw(native, false, false);
  if (pub === null) throw new ERR_CRYPTO_OPERATION_FAILED("Failed to get raw public key");
  return priv === undefined ? { kty: "AKP", alg, pub: base64urlOf(pub) } : { priv, kty: "AKP", alg, pub: base64urlOf(pub) };
}

/**
 * Node's `RawPublicKey`, `RawPrivateKey` and their EC forms: a key's raw
 * bytes, or node's refusal for a type that has none.
 */
function exportRaw(key: AsymmetricKeyObject, privateKey: boolean, compressed: boolean): Buffer {
  const type = key.asymmetricKeyType ?? "";
  const supported = privateKey ? hasRawPrivateKey(type) : hasRawPublicKey(type);
  if (!supported) throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS_BINDING();
  const bytes = nts_crypto_key_export_raw(handleOf(key).native, privateKey, compressed);
  if (bytes === null) {
    if (type === "ec" && privateKey) throw new ERR_CRYPTO_OPERATION_FAILED("Failed to export EC private key");
    throw new ERR_CRYPTO_OPERATION_FAILED(privateKey ? "Failed to get raw private key" : "Failed to get raw public key");
  }
  return new Buffer(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
}

/** PEM is text and DER is bytes, as node's `ToV8Value` returns them. */
function encoded(bytes: Uint8Array, format: number): Buffer | string {
  const buffer = new Buffer(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
  return format === KeyFormat.PEM ? buffer.toString("utf8") : buffer;
}

/** Node's `WritePublicKey`: PEM or DER, or OpenSSL's reason it could not be. */
function writePublicKey(native: number, format: number, type: number | undefined): Buffer | string {
  const bytes = nts_crypto_key_export_public(native, format, type ?? -1);
  if (bytes === null) throw markedCryptoError("Failed to encode public key");
  return encoded(bytes, format);
}

/** Node's `WritePrivateKey`, encrypted under the cipher id if one is given (-1 is none). */
function writePrivateKey(
  native: number,
  format: number,
  type: number | undefined,
  cipher: number,
  passphrase: ByteSource | undefined,
): Buffer | string {
  const bytes = nts_crypto_key_export_private(
    native,
    format,
    type ?? -1,
    cipher,
    passphrase === undefined ? noBytes : bytesOf(passphrase),
  );
  if (bytes === null) throw markedCryptoError("Failed to encode private key");
  return encoded(bytes, format);
}

/** A key as DER: SPKI for the public half, unencrypted PKCS#8 for a private key. */
export function writeDerKey(native: number, isPublic: boolean): Uint8Array {
  const bytes = isPublic
    ? nts_crypto_key_export_public(native, KeyFormat.DER, KeyEncoding.SPKI)
    : nts_crypto_key_export_private(native, KeyFormat.DER, KeyEncoding.PKCS8, -1, noBytes);
  if (bytes === null) throw markedCryptoError(isPublic ? "Failed to encode public key" : "Failed to encode private key");
  return bytes;
}

/**
 * The cipher a private key encoding names, resolved as node's C++ resolves it
 * before anything is written: -1 for none, and an unknown name refused.
 */
export function encodingCipher(cipher: unknown): number {
  if (cipher === undefined || cipher === null) return -1;
  const id = cipherId(cipher as string);
  if (id < 0) throw new ERR_CRYPTO_UNKNOWN_CIPHER();
  return id;
}

/** The key types with a raw form besides EC's point and scalar. */
const rawKeyTypes = ["ed25519", "ed448", "x25519", "x448"];

/** Every post-quantum family's public key is raw bytes. */
function hasRawPublicKey(type: string): boolean {
  return type === "ec" || rawKeyTypes.includes(type) || isPostQuantumName(type);
}

/** Node's `IsPqcRawPrivateKeyId`: SLH-DSA's private key is raw bytes. */
function hasRawPrivateKey(type: string): boolean {
  return type === "ec" || rawKeyTypes.includes(type) || type.startsWith("slh-dsa-");
}

/** Node's `IsPqcSeedKeyId`: ML-DSA's and ML-KEM's private key is kept as a seed. */
function hasSeed(type: string): boolean {
  return type.startsWith("ml-dsa-") || type.startsWith("ml-kem-");
}

/** Node's `RawSeed`: the seed, or node's refusal for a key without one. */
function exportSeed(key: AsymmetricKeyObject): Buffer {
  if (!hasSeed(key.asymmetricKeyType ?? "")) throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS_BINDING();
  const bytes = nts_crypto_key_export_seed(handleOf(key).native);
  if (bytes === null) throw new ERR_CRYPTO_OPERATION_FAILED("Failed to get raw seed");
  return new Buffer(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Node's `ToEncodedPublicKey`, for a generated key: its JWK, its raw form, or
 * PEM or DER.
 */
export function encodePublicKey(key: PublicKeyObject, encoding: KeyEncoding): Buffer | string | JsonWebKey {
  if (encoding.format === KeyFormat.JWK) return exportJwk(key, false);
  if (encoding.format === KeyFormat.RawPublic) return exportRaw(key, false, encoding.compressed === true);
  return writePublicKey(handleOf(key).native, encoding.format, encoding.type);
}

/** Node's `ToEncodedPrivateKey`, for a generated key, with its cipher already resolved. */
export function encodePrivateKey(
  key: PrivateKeyObject,
  encoding: KeyEncoding,
  cipher: number,
): Buffer | string | JsonWebKey {
  if (encoding.format === KeyFormat.JWK) return exportJwk(key, true);
  if (encoding.format === KeyFormat.RawSeed) return exportSeed(key);
  if (encoding.format === KeyFormat.RawPrivate) return exportRaw(key, true, false);
  return writePrivateKey(handleOf(key).native, encoding.format, encoding.type, cipher, encoding.passphrase);
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
        return writePublicKey(handleOf(this).native, format, type);
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
      case "raw-seed":
        return exportSeed(this);
      default: {
        const { format, type, cipher, passphrase } = parsePrivateKeyEncoding(
          options,
          this.asymmetricKeyType,
          undefined,
        );
        return writePrivateKey(handleOf(this).native, format, type, encodingCipher(cipher), passphrase);
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

/** A parsed key encoding: a format, and for PEM and DER an encoding type. */
export interface KeyEncoding {
  format: number;
  type: number | undefined;
  /** A raw public EC point, compressed. */
  compressed?: boolean;
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
    return { format, type: undefined, compressed: typeStr === "compressed" };
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
  const { format, type, compressed } = parseKeyFormatAndType(options, keyType, isPublic, objName);

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
  return { format, type, compressed, cipher, passphrase: bytes };
}

export function parsePublicKeyEncoding(enc: unknown, keyType: string | undefined, objName: string | undefined): KeyEncoding {
  return parseKeyEncoding(enc, keyType, keyType ? true : undefined, objName);
}

export function parsePrivateKeyEncoding(enc: unknown, keyType: string | undefined, objName: string | undefined): KeyEncoding {
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
  if (isKeyObject(key)) {
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
    if (isKeyObject(data)) {
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

/** Node's `KeyObjectHandle::Init` over DER: SPKI for a public key, PKCS#8 for a private one. */
export function parseDerKey(data: Uint8Array, isPublic: boolean): number {
  return isPublic
    ? parsed(nts_crypto_key_parse_public(KeyFormat.DER, KeyEncoding.SPKI, data, noBytes, false), "Failed to read asymmetric key")
    : parsed(nts_crypto_key_parse_private(KeyFormat.DER, KeyEncoding.PKCS8, data, noBytes, false), "Failed to read private key");
}

function jwkString(value: unknown, message: string): string {
  if (typeof value !== "string") throw new ERR_CRYPTO_INVALID_JWK(message);
  return value;
}

/** Base64 of either alphabet, as `ByteSource::FromEncodedString` reads a JWK member. */
function jwkBytes(value: string): Uint8Array {
  return bytesOfBase64(value);
}

/** A handle from a JWK or raw import, and whether it holds private material. */
export interface Imported {
  native: number;
  privateKey: boolean;
}

/** Node's `ImportJWKFromArgs`. */
export function importJwk(jwk: JsonWebKey): Imported {
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
  if (kty === "AKP") {
    const keyType = postQuantumTypeOf(typeof jwk.alg === "string" ? jwk.alg : "");
    if (keyType === undefined) throw new ERR_CRYPTO_INVALID_JWK('Unsupported JWK AKP "alg"');
    const message = "Invalid JWK AKP key";
    if (typeof jwk.pub !== "string" || (jwk.priv !== undefined && typeof jwk.priv !== "string")) {
      throw new ERR_CRYPTO_INVALID_JWK(message);
    }
    // A private key is made from `priv` alone, as node makes it.
    const privateKey = typeof jwk.priv === "string";
    const form = !privateKey ? 0 : hasSeed(keyType) ? 2 : 1;
    const native = nts_crypto_key_from_post_quantum(keyType, jwkBytes(privateKey ? jwk.priv! : jwk.pub), form);
    if (native <= 0) throw new ERR_CRYPTO_INVALID_JWK(message);
    return { native, privateKey };
  }
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

/** The post-quantum families: node's name for each, and its JWK `alg`, which is OpenSSL's. */
const postQuantumFamilies: readonly (readonly [string, string])[] = [
  ["ml-dsa-44", "ML-DSA-44"],
  ["ml-dsa-65", "ML-DSA-65"],
  ["ml-dsa-87", "ML-DSA-87"],
  ["ml-kem-512", "ML-KEM-512"],
  ["ml-kem-768", "ML-KEM-768"],
  ["ml-kem-1024", "ML-KEM-1024"],
  ["slh-dsa-sha2-128f", "SLH-DSA-SHA2-128f"],
  ["slh-dsa-sha2-128s", "SLH-DSA-SHA2-128s"],
  ["slh-dsa-sha2-192f", "SLH-DSA-SHA2-192f"],
  ["slh-dsa-sha2-192s", "SLH-DSA-SHA2-192s"],
  ["slh-dsa-sha2-256f", "SLH-DSA-SHA2-256f"],
  ["slh-dsa-sha2-256s", "SLH-DSA-SHA2-256s"],
  ["slh-dsa-shake-128f", "SLH-DSA-SHAKE-128f"],
  ["slh-dsa-shake-128s", "SLH-DSA-SHAKE-128s"],
  ["slh-dsa-shake-192f", "SLH-DSA-SHAKE-192f"],
  ["slh-dsa-shake-192s", "SLH-DSA-SHAKE-192s"],
  ["slh-dsa-shake-256f", "SLH-DSA-SHAKE-256f"],
  ["slh-dsa-shake-256s", "SLH-DSA-SHAKE-256s"],
];

function isPostQuantumName(keyType: string): boolean {
  return postQuantumFamilies.some((family) => family[0] === keyType);
}

/** Node's `FindPqcAlgorithmByName`: a JWK `alg`, exactly as OpenSSL spells it. */
function postQuantumTypeOf(alg: string): string | undefined {
  return postQuantumFamilies.find((family) => family[1] === alg)?.[0];
}

function postQuantumAlgOf(keyType: string): string {
  return postQuantumFamilies.find((family) => family[0] === keyType)![1];
}

/**
 * Node's `ValidateRawKeyImportFormat` and `ImportRawKey`: an EC, OKP or
 * post-quantum key from a raw form its family has -- a public key, and a
 * private key or a seed as the family keeps it.
 */
function importRaw(prepared: PreparedKey): Imported {
  const keyType = prepared.asymmetricKeyType!;
  const format = prepared.format!;
  const privateKey = format !== KeyFormat.RawPublic;
  const okp = okpName(keyType);
  let privateForm: number;
  if (keyType === "ec" || okp !== undefined || keyType.startsWith("slh-dsa-")) {
    privateForm = KeyFormat.RawPrivate;
  } else if (hasSeed(keyType)) {
    privateForm = KeyFormat.RawSeed;
  } else if (keyType === "rsa" || keyType === "rsa-pss" || keyType === "dsa" || keyType === "dh") {
    throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS_BINDING();
  } else {
    throw new ERR_INVALID_ARG_VALUE_BINDING(`Invalid asymmetricKeyType: ${keyType}`);
  }
  if (privateKey && format !== privateForm) throw new ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS_BINDING();
  const raw = bytesOf(prepared.data as ByteSource);
  let native: number;
  if (keyType === "ec") native = nts_crypto_key_from_raw_ec(prepared.namedCurve ?? "", raw, privateKey);
  else if (okp !== undefined) native = nts_crypto_key_from_okp(okp, raw, privateKey);
  else native = nts_crypto_key_from_post_quantum(keyType, raw, !privateKey ? 0 : format === KeyFormat.RawSeed ? 2 : 1);
  if (native === KeyStatus.InvalidCurve) throw new ERR_CRYPTO_INVALID_CURVE();
  if (native <= 0) throw new ERR_INVALID_ARG_VALUE_BINDING("Invalid key data");
  return { native, privateKey };
}

/**
 * Node's `KeyObjectHandle::Init` over a raw public key: an EC point on the
 * named curve, or an Edwards or Montgomery key of the named type.
 */
export function importRawPublicKey(keyType: string, namedCurve: string | undefined, data: Uint8Array): number {
  return importRaw({ format: KeyFormat.RawPublic, data, asymmetricKeyType: keyType, namedCurve }).native;
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

/**
 * A key to sign or decrypt with, checked as node's JavaScript checks it. The
 * key itself is made by `privateKeyOf`, later, as node's C++ makes it: the
 * options beside the key are validated in between, so their errors come first.
 */
export function preparePrivateKey(key: unknown, name = "key"): PreparedKey {
  return prepareAsymmetricKey(key, KeyContext.ConsumePrivate, name);
}

/** A key to verify or encrypt with: a public key, or a private key's public half. */
export function preparePublicOrPrivateKey(key: unknown, name = "key"): PreparedKey {
  return prepareAsymmetricKey(key, KeyContext.ConsumePublic, name);
}

/**
 * The options a key argument may carry beside the key, for whichever
 * operation takes it: `sign({ key, padding })`, `publicEncrypt({ key,
 * oaepHash })`. Node reads them off the argument whatever it is; a string, a
 * buffer and a key object carry none.
 */
export interface KeyOperationOptions {
  padding?: unknown;
  saltLength?: unknown;
  dsaEncoding?: unknown;
  context?: unknown;
  oaepHash?: unknown;
  oaepLabel?: unknown;
  encoding?: unknown;
}

const noKeyOptions: KeyOperationOptions = {};

/** The options beside a key argument; null and undefined are read, as node reads them, and throw. */
export function keyOptionsOf(key: unknown): KeyOperationOptions {
  if (typeof key !== "object" && key !== undefined) return noKeyOptions;
  if (isKeyObject(key) || isArrayBufferView(key) || isAnyArrayBuffer(key)) return noKeyOptions;
  return key as KeyOperationOptions;
}

/** Node's `KeyObjectData::GetPrivateKeyFromJs`: the prepared key's handle, parsed if need be. */
export function privateKeyOf(prepared: PreparedKey): KeyObjectHandle {
  return initAsymmetric(prepared, false);
}

/** Node's `KeyObjectData::GetPublicOrPrivateKeyFromJs`. */
export function publicOrPrivateKeyOf(prepared: PreparedKey): KeyObjectHandle {
  return initAsymmetric(prepared, true);
}

// -- secret keys --------------------------------------------------------------

/**
 * Node's `prepareSecretKey`, answering the bytes: a secret `KeyObject`'s own,
 * or the argument's. Unless `bufferOnly`, a `KeyObject` of another type is
 * refused by name.
 */
export function prepareSecretKey(key: unknown, encoding: string | undefined, bufferOnly = false): Uint8Array {
  if (!bufferOnly && isKeyObject(key)) {
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
