import { DOMException } from "../core/errors.ts";
import { coerceToDOMString } from "../core/webidl.ts";
import type { CryptoDigestName } from "../provider/crypto.ts";
import {
  copyCryptoBytes,
  cryptoBytes,
  cryptoTypedArrayName,
  toCryptoArrayBufferView,
  toCryptoBufferSource,
} from "./buffer-source.ts";
import type { CryptoBufferSource } from "./buffer-source.ts";
import { getCryptoKeySlots } from "./crypto-key.ts";
import type { CryptoKey } from "./crypto-key.ts";
import { toCryptoUnsignedInteger } from "./webidl.ts";

/** Web Cryptography §11. Objects are not converted to dictionaries until normalization. */
export type AlgorithmIdentifier = string | object;

/** The operations in Web Cryptography §18.2.2, including deriveKey's internal operation. */
export type CryptoOperation =
  | "encrypt"
  | "decrypt"
  | "sign"
  | "verify"
  | "digest"
  | "generateKey"
  | "deriveBits"
  | "importKey"
  | "exportKey"
  | "wrapKey"
  | "unwrapKey"
  | "get key length";

/** Typed IDL dictionary; later algorithm dictionaries extend this layout. */
export class Algorithm<Name extends string = string> {
  readonly name: Name;

  constructor(name: Name) {
    this.name = name;
  }
}

/** SHA's registration (§32.2) uses Algorithm, with no additional members. */
export class DigestAlgorithm extends Algorithm<CryptoDigestName> {
  constructor(name: CryptoDigestName) {
    super(name);
  }
}

export type AesAlgorithmName = "AES-CTR" | "AES-CBC" | "AES-GCM" | "AES-KW";
export type SecretAlgorithmName = AesAlgorithmName | "HMAC";
export type RsaAlgorithmName = "RSASSA-PKCS1-v1_5" | "RSA-PSS" | "RSA-OAEP";
export type EcAlgorithmName = "ECDSA" | "ECDH";
export type OkpAlgorithmName = "Ed25519" | "X25519";
export type KdfAlgorithmName = "HKDF" | "PBKDF2";
type RegisteredAlgorithmName = CryptoDigestName | SecretAlgorithmName | RsaAlgorithmName | EcAlgorithmName | OkpAlgorithmName | KdfAlgorithmName;

/** Web Cryptography §27.5. Validation of AES key sizes is an operation step. */
export class AesKeyGenParams extends Algorithm<AesAlgorithmName> {
  readonly length: number;

  constructor(name: AesAlgorithmName, length: number) {
    super(name);
    this.length = length;
  }
}

/** Web Cryptography §27.6. deriveKey normalizes this separately from import. */
export class AesDerivedKeyParams extends Algorithm<AesAlgorithmName> {
  readonly length: number;

  constructor(name: AesAlgorithmName, length: number) {
    super(name);
    this.length = length;
  }
}

/** Web Cryptography §27.3. Counter length and size checks follow normalization. */
export class AesCtrParams extends Algorithm<"AES-CTR"> {
  readonly counter: Uint8Array;
  readonly length: number;

  constructor(name: "AES-CTR", counter: Uint8Array, length: number) {
    super(name);
    this.counter = counter;
    this.length = length;
  }
}

/** Web Cryptography §28.3. */
export class AesCbcParams extends Algorithm<"AES-CBC"> {
  readonly iv: Uint8Array;

  constructor(name: "AES-CBC", iv: Uint8Array) {
    super(name);
    this.iv = iv;
  }
}

/** Web Cryptography §29.3. Optional members remain undefined until operation policy. */
export class AesGcmParams extends Algorithm<"AES-GCM"> {
  readonly iv: Uint8Array;
  readonly additionalData: Uint8Array | undefined;
  readonly tagLength: number | undefined;

  constructor(
    name: "AES-GCM",
    iv: Uint8Array,
    additionalData: Uint8Array | undefined,
    tagLength: number | undefined,
  ) {
    super(name);
    this.iv = iv;
    this.additionalData = additionalData;
    this.tagLength = tagLength;
  }
}

/** Web Cryptography §31.5. The hash is normalized only after dictionary conversion. */
export class HmacKeyGenParams extends Algorithm<"HMAC"> {
  readonly hash: DigestAlgorithm;
  readonly length: number | undefined;

  constructor(name: "HMAC", hash: DigestAlgorithm, length: number | undefined) {
    super(name);
    this.hash = hash;
    this.length = length;
  }
}

/** Web Cryptography §31.3. The same IDL members have different import policy. */
export class HmacImportParams extends Algorithm<"HMAC"> {
  readonly hash: DigestAlgorithm;
  readonly length: number | undefined;

  constructor(name: "HMAC", hash: DigestAlgorithm, length: number | undefined) {
    super(name);
    this.hash = hash;
    this.length = length;
  }
}

/** Web Cryptography §§20.3–20.4. Mathematical bounds are generate-key steps. */
export class RsaHashedKeyGenParams extends Algorithm<RsaAlgorithmName> {
  readonly modulusLength: number;
  readonly publicExponent: Uint8Array;
  readonly hash: DigestAlgorithm;

  constructor(name: RsaAlgorithmName, modulusLength: number, publicExponent: Uint8Array, hash: DigestAlgorithm) {
    super(name);
    this.modulusLength = modulusLength;
    this.publicExponent = publicExponent;
    this.hash = hash;
  }
}

/** Web Cryptography §20.8, shared by all three RSA algorithms. */
export class RsaHashedImportParams extends Algorithm<RsaAlgorithmName> {
  readonly hash: DigestAlgorithm;

  constructor(name: RsaAlgorithmName, hash: DigestAlgorithm) {
    super(name);
    this.hash = hash;
  }
}

/** Web Cryptography §21.3. Salt length is an unsigned octet count, not bits. */
export class RsaPssParams extends Algorithm<"RSA-PSS"> {
  readonly saltLength: number;

  constructor(name: "RSA-PSS", saltLength: number) {
    super(name);
    this.saltLength = saltLength;
  }
}

/** Web Cryptography §22.3. An absent label becomes empty at the operation step. */
export class RsaOaepParams extends Algorithm<"RSA-OAEP"> {
  readonly label: Uint8Array | undefined;

  constructor(name: "RSA-OAEP", label: Uint8Array | undefined) {
    super(name);
    this.label = label;
  }
}

/** Web Cryptography §23.3. The hash is selected for each signature operation. */
export class EcdsaParams extends Algorithm<"ECDSA"> {
  readonly hash: DigestAlgorithm;

  constructor(name: "ECDSA", hash: DigestAlgorithm) {
    super(name);
    this.hash = hash;
  }
}

/** Web Cryptography §23.4. Curve support is checked by the key operation. */
export class EcKeyGenParams extends Algorithm<EcAlgorithmName> {
  readonly namedCurve: string;

  constructor(name: EcAlgorithmName, namedCurve: string) {
    super(name);
    this.namedCurve = namedCurve;
  }
}

/** Web Cryptography §23.6, shared by ECDSA and ECDH import. */
export class EcKeyImportParams extends Algorithm<EcAlgorithmName> {
  readonly namedCurve: string;

  constructor(name: EcAlgorithmName, namedCurve: string) {
    super(name);
    this.namedCurve = namedCurve;
  }
}

/** Web Cryptography §§24.3, 26.2. ECDH and X25519 use the same dictionary. */
export class EcdhKeyDeriveParams extends Algorithm<"ECDH" | "X25519"> {
  readonly public: CryptoKey;

  constructor(name: "ECDH" | "X25519", publicKey: CryptoKey) {
    super(name);
    this.public = publicKey;
  }
}

/** Web Cryptography §33.3. Hash normalization precedes the salt and info snapshots. */
export class HkdfParams extends Algorithm<"HKDF"> {
  readonly hash: DigestAlgorithm;
  readonly salt: Uint8Array;
  readonly info: Uint8Array;

  constructor(name: "HKDF", hash: DigestAlgorithm, salt: Uint8Array, info: Uint8Array) {
    super(name);
    this.hash = hash;
    this.salt = salt;
    this.info = info;
  }
}

/** Web Cryptography §34.3. A zero iteration count is rejected by the operation. */
export class Pbkdf2Params extends Algorithm<"PBKDF2"> {
  readonly hash: DigestAlgorithm;
  readonly salt: Uint8Array;
  readonly iterations: number;

  constructor(name: "PBKDF2", hash: DigestAlgorithm, salt: Uint8Array, iterations: number) {
    super(name);
    this.hash = hash;
    this.salt = salt;
    this.iterations = iterations;
  }
}

export type NormalizedAlgorithm =
  | DigestAlgorithm
  | Algorithm<SecretAlgorithmName | RsaAlgorithmName | EcAlgorithmName | OkpAlgorithmName | KdfAlgorithmName>
  | AesKeyGenParams
  | AesDerivedKeyParams
  | AesCtrParams
  | AesCbcParams
  | AesGcmParams
  | HmacKeyGenParams
  | HmacImportParams
  | RsaHashedKeyGenParams
  | RsaHashedImportParams
  | RsaPssParams
  | RsaOaepParams
  | EcdsaParams
  | EcKeyGenParams
  | EcKeyImportParams
  | EcdhKeyDeriveParams
  | HkdfParams
  | Pbkdf2Params;

class AlgorithmRegistration {
  readonly name: RegisteredAlgorithmName;
  readonly operation: CryptoOperation;

  constructor(name: RegisteredAlgorithmName, operation: CryptoOperation) {
    this.name = name;
    this.operation = operation;
  }
}

// §18.4.2's supportedAlgorithms. Register only operations implemented by this
// increment: a future primitive contract is not an implemented Web algorithm.
const registeredAlgorithms: readonly AlgorithmRegistration[] = [
  new AlgorithmRegistration("SHA-1", "digest"),
  new AlgorithmRegistration("SHA-256", "digest"),
  new AlgorithmRegistration("SHA-384", "digest"),
  new AlgorithmRegistration("SHA-512", "digest"),
  new AlgorithmRegistration("AES-CTR", "encrypt"),
  new AlgorithmRegistration("AES-CTR", "decrypt"),
  new AlgorithmRegistration("AES-CTR", "generateKey"),
  new AlgorithmRegistration("AES-CTR", "importKey"),
  new AlgorithmRegistration("AES-CTR", "exportKey"),
  new AlgorithmRegistration("AES-CTR", "get key length"),
  new AlgorithmRegistration("AES-CBC", "encrypt"),
  new AlgorithmRegistration("AES-CBC", "decrypt"),
  new AlgorithmRegistration("AES-CBC", "generateKey"),
  new AlgorithmRegistration("AES-CBC", "importKey"),
  new AlgorithmRegistration("AES-CBC", "exportKey"),
  new AlgorithmRegistration("AES-CBC", "get key length"),
  new AlgorithmRegistration("AES-GCM", "encrypt"),
  new AlgorithmRegistration("AES-GCM", "decrypt"),
  new AlgorithmRegistration("AES-GCM", "generateKey"),
  new AlgorithmRegistration("AES-GCM", "importKey"),
  new AlgorithmRegistration("AES-GCM", "exportKey"),
  new AlgorithmRegistration("AES-GCM", "get key length"),
  new AlgorithmRegistration("AES-KW", "wrapKey"),
  new AlgorithmRegistration("AES-KW", "unwrapKey"),
  new AlgorithmRegistration("AES-KW", "generateKey"),
  new AlgorithmRegistration("AES-KW", "importKey"),
  new AlgorithmRegistration("AES-KW", "exportKey"),
  new AlgorithmRegistration("AES-KW", "get key length"),
  new AlgorithmRegistration("HMAC", "sign"),
  new AlgorithmRegistration("HMAC", "verify"),
  new AlgorithmRegistration("HMAC", "generateKey"),
  new AlgorithmRegistration("HMAC", "importKey"),
  new AlgorithmRegistration("HMAC", "exportKey"),
  new AlgorithmRegistration("HMAC", "get key length"),
  new AlgorithmRegistration("RSASSA-PKCS1-v1_5", "sign"),
  new AlgorithmRegistration("RSASSA-PKCS1-v1_5", "verify"),
  new AlgorithmRegistration("RSASSA-PKCS1-v1_5", "generateKey"),
  new AlgorithmRegistration("RSASSA-PKCS1-v1_5", "importKey"),
  new AlgorithmRegistration("RSASSA-PKCS1-v1_5", "exportKey"),
  new AlgorithmRegistration("RSA-PSS", "sign"),
  new AlgorithmRegistration("RSA-PSS", "verify"),
  new AlgorithmRegistration("RSA-PSS", "generateKey"),
  new AlgorithmRegistration("RSA-PSS", "importKey"),
  new AlgorithmRegistration("RSA-PSS", "exportKey"),
  new AlgorithmRegistration("RSA-OAEP", "encrypt"),
  new AlgorithmRegistration("RSA-OAEP", "decrypt"),
  new AlgorithmRegistration("RSA-OAEP", "generateKey"),
  new AlgorithmRegistration("RSA-OAEP", "importKey"),
  new AlgorithmRegistration("RSA-OAEP", "exportKey"),
  new AlgorithmRegistration("ECDSA", "sign"),
  new AlgorithmRegistration("ECDSA", "verify"),
  new AlgorithmRegistration("ECDSA", "generateKey"),
  new AlgorithmRegistration("ECDSA", "importKey"),
  new AlgorithmRegistration("ECDSA", "exportKey"),
  new AlgorithmRegistration("ECDH", "deriveBits"),
  new AlgorithmRegistration("ECDH", "generateKey"),
  new AlgorithmRegistration("ECDH", "importKey"),
  new AlgorithmRegistration("ECDH", "exportKey"),
  new AlgorithmRegistration("Ed25519", "sign"),
  new AlgorithmRegistration("Ed25519", "verify"),
  new AlgorithmRegistration("Ed25519", "generateKey"),
  new AlgorithmRegistration("Ed25519", "importKey"),
  new AlgorithmRegistration("Ed25519", "exportKey"),
  new AlgorithmRegistration("X25519", "deriveBits"),
  new AlgorithmRegistration("X25519", "generateKey"),
  new AlgorithmRegistration("X25519", "importKey"),
  new AlgorithmRegistration("X25519", "exportKey"),
  new AlgorithmRegistration("HKDF", "deriveBits"),
  new AlgorithmRegistration("HKDF", "importKey"),
  new AlgorithmRegistration("HKDF", "get key length"),
  new AlgorithmRegistration("PBKDF2", "deriveBits"),
  new AlgorithmRegistration("PBKDF2", "importKey"),
  new AlgorithmRegistration("PBKDF2", "get key length"),
];

/** Web IDL's (object or DOMString) union conversion, before later argument conversions. */
export function toAlgorithmIdentifier(value: unknown): AlgorithmIdentifier {
  if ((typeof value === "object" && value !== null) || typeof value === "function") {
    return value;
  }
  return coerceToDOMString(value);
}

function algorithmName(algorithm: object): string {
  // The specification passes an arbitrary object. One ordinary Get, followed
  // by required-member validation and DOMString conversion, is observable.
  const name: unknown = (algorithm as { readonly name?: unknown }).name;
  if (name === undefined) throw new TypeError("Algorithm.name is required");
  return coerceToDOMString(name);
}

function equalIgnoringASCIICase(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index++) {
    let code = left.charCodeAt(index);
    let expected = right.charCodeAt(index);
    if (code >= 0x61 && code <= 0x7a) code -= 0x20;
    if (expected >= 0x61 && expected <= 0x7a) expected -= 0x20;
    if (code !== expected) return false;
  }
  return true;
}

function findRegistration(name: string, operation: CryptoOperation): AlgorithmRegistration | undefined {
  for (let index = 0; index < registeredAlgorithms.length; index++) {
    const registration = registeredAlgorithms[index]!;
    if (registration.operation === operation && equalIgnoringASCIICase(name, registration.name)) {
      return registration;
    }
  }
  return undefined;
}

/** Internal operation lookup, including exportKey's registry check (§14.3.10). */
export function supportsCryptoOperation(name: string, operation: CryptoOperation): boolean {
  return findRegistration(name, operation) !== undefined;
}

function requiredMember(value: unknown, name: string): unknown {
  if (value === undefined) throw new TypeError(name + " is required");
  return value;
}

function normalizedBytes(source: CryptoBufferSource, copyBuffers: boolean): Uint8Array {
  return copyBuffers ? copyCryptoBytes(source) : cryptoBytes(source);
}

function agreementParameters(algorithm: object, name: "ECDH" | "X25519"): EcdhKeyDeriveParams {
  const input = algorithm as { readonly public?: unknown };
  const publicKey = requiredMember(input.public, name + ".public");
  // Web IDL validates the interface brand here. Algorithm, kind and permission
  // checks belong to the later operation and preserve their specified ordering.
  getCryptoKeySlots(publicKey);
  return new EcdhKeyDeriveParams(name, publicKey as CryptoKey);
}

function normalizeRegisteredAlgorithm(
  algorithm: object,
  name: RegisteredAlgorithmName,
  operation: CryptoOperation,
  copyBuffers: boolean,
): NormalizedAlgorithm {
  // Every desired dictionary inherits Algorithm: its name is read and converted
  // first, even though normalization subsequently restores the initial match.
  algorithmName(algorithm);

  if (name === "SHA-1" || name === "SHA-256" || name === "SHA-384" || name === "SHA-512") {
    return new DigestAlgorithm(name);
  }

  if (name === "Ed25519") return new Algorithm(name);
  if (name === "X25519") {
    return operation === "deriveBits" ? agreementParameters(algorithm, name) : new Algorithm(name);
  }

  if (name === "HKDF") {
    if (operation !== "deriveBits") return new Algorithm(name);
    const input = algorithm as { readonly hash?: unknown; readonly salt?: unknown; readonly info?: unknown };
    // Web IDL visits members lexicographically; §18.4.4 then processes their
    // declared order: hash normalization, salt snapshot, info snapshot.
    const hash = toAlgorithmIdentifier(requiredMember(input.hash, "HKDF.hash"));
    const info = toCryptoBufferSource(requiredMember(input.info, "HKDF.info"));
    const salt = toCryptoBufferSource(requiredMember(input.salt, "HKDF.salt"));
    const normalizedHash = normalizeAlgorithm(hash, "digest");
    const saltBytes = normalizedBytes(salt, copyBuffers);
    const infoBytes = normalizedBytes(info, copyBuffers);
    return new HkdfParams(name, normalizedHash, saltBytes, infoBytes);
  }

  if (name === "PBKDF2") {
    if (operation !== "deriveBits") return new Algorithm(name);
    const input = algorithm as { readonly hash?: unknown; readonly salt?: unknown; readonly iterations?: unknown };
    const hash = toAlgorithmIdentifier(requiredMember(input.hash, "PBKDF2.hash"));
    const iterations = toCryptoUnsignedInteger(requiredMember(input.iterations, "PBKDF2.iterations"), 32);
    const salt = toCryptoBufferSource(requiredMember(input.salt, "PBKDF2.salt"));
    // PBKDF2 declares salt before hash. An object hash may execute script during
    // recursive normalization, so its salt must be copied even for immediate use.
    const saltBytes = normalizedBytes(salt, copyBuffers || typeof hash !== "string");
    const normalizedHash = normalizeAlgorithm(hash, "digest");
    return new Pbkdf2Params(name, normalizedHash, saltBytes, iterations);
  }

  if (name === "HMAC") {
    if (operation !== "generateKey" && operation !== "importKey" && operation !== "get key length") return new Algorithm(name);
    const input = algorithm as { readonly hash?: unknown; readonly length?: unknown };
    const hash = toAlgorithmIdentifier(requiredMember(input.hash, "HMAC.hash"));
    const lengthValue = input.length;
    const length = lengthValue === undefined ? undefined : toCryptoUnsignedInteger(lengthValue, 32);
    // Dictionary conversion is complete before §18.4.4 recursively normalizes
    // HashAlgorithmIdentifier. In particular, length's coercion precedes hash.name.
    const normalizedHash = normalizeAlgorithm(hash, "digest");
    return operation === "generateKey"
      ? new HmacKeyGenParams(name, normalizedHash, length)
      : new HmacImportParams(name, normalizedHash, length);
  }

  if (name === "RSASSA-PKCS1-v1_5" || name === "RSA-PSS" || name === "RSA-OAEP") {
    if (operation === "generateKey") {
      const input = algorithm as {
        readonly modulusLength?: unknown;
        readonly publicExponent?: unknown;
        readonly hash?: unknown;
      };
      // RsaKeyGenParams members precede its derived RsaHashedKeyGenParams.hash.
      const modulusLength = toCryptoUnsignedInteger(requiredMember(input.modulusLength, "RSA.modulusLength"), 32);
      const publicExponent = toCryptoArrayBufferView(requiredMember(input.publicExponent, "RSA.publicExponent"));
      if (cryptoTypedArrayName(publicExponent) !== "Uint8Array") throw new TypeError("RSA.publicExponent must be a Uint8Array");
      const hash = toAlgorithmIdentifier(requiredMember(input.hash, "RSA.hash"));
      const normalizedHash = normalizeAlgorithm(hash, "digest");
      // BigInteger is a Uint8Array typedef, not BufferSource. §18.4.4 does not
      // snapshot it: recursive hash normalization can still change its bytes.
      return new RsaHashedKeyGenParams(name, modulusLength, cryptoBytes(publicExponent), normalizedHash);
    }
    if (operation === "importKey") {
      const input = algorithm as { readonly hash?: unknown };
      const hash = toAlgorithmIdentifier(requiredMember(input.hash, "RSA.hash"));
      return new RsaHashedImportParams(name, normalizeAlgorithm(hash, "digest"));
    }
    if (operation === "exportKey" || name === "RSASSA-PKCS1-v1_5") return new Algorithm(name);
    if (name === "RSA-PSS") {
      const input = algorithm as { readonly saltLength?: unknown };
      const saltLength = toCryptoUnsignedInteger(requiredMember(input.saltLength, "RSA-PSS.saltLength"), 32);
      return new RsaPssParams(name, saltLength);
    }
    const input = algorithm as { readonly label?: unknown };
    const labelValue = input.label;
    const label = labelValue === undefined ? undefined : toCryptoBufferSource(labelValue);
    return new RsaOaepParams(name, label === undefined ? undefined : normalizedBytes(label, copyBuffers));
  }

  if (name === "ECDSA" || name === "ECDH") {
    if (operation === "generateKey" || operation === "importKey") {
      const input = algorithm as { readonly namedCurve?: unknown };
      const namedCurve = coerceToDOMString(requiredMember(input.namedCurve, "EC.namedCurve"));
      return operation === "generateKey" ? new EcKeyGenParams(name, namedCurve) : new EcKeyImportParams(name, namedCurve);
    }
    if (operation === "exportKey") return new Algorithm(name);
    if (name === "ECDSA") {
      const input = algorithm as { readonly hash?: unknown };
      const hash = toAlgorithmIdentifier(requiredMember(input.hash, "ECDSA.hash"));
      return new EcdsaParams(name, normalizeAlgorithm(hash, "digest"));
    }
    return agreementParameters(algorithm, name);
  }

  if (operation === "generateKey" || operation === "get key length") {
    const input = algorithm as { readonly length?: unknown };
    const length = toCryptoUnsignedInteger(requiredMember(input.length, "AES.length"), 16);
    return operation === "generateKey" ? new AesKeyGenParams(name, length) : new AesDerivedKeyParams(name, length);
  }
  if (operation === "importKey" || operation === "exportKey" || name === "AES-KW") {
    return new Algorithm(name);
  }

  if (name === "AES-CTR") {
    const input = algorithm as { readonly counter?: unknown; readonly length?: unknown };
    const counter = toCryptoBufferSource(requiredMember(input.counter, "AES-CTR.counter"));
    const length = toCryptoUnsignedInteger(requiredMember(input.length, "AES-CTR.length"), 8);
    return new AesCtrParams(name, normalizedBytes(counter, copyBuffers), length);
  }
  if (name === "AES-CBC") {
    const input = algorithm as { readonly iv?: unknown };
    const iv = toCryptoBufferSource(requiredMember(input.iv, "AES-CBC.iv"));
    return new AesCbcParams(name, normalizedBytes(iv, copyBuffers));
  }

  const input = algorithm as {
    readonly additionalData?: unknown;
    readonly iv?: unknown;
    readonly tagLength?: unknown;
  };
  // Web IDL converts inherited members first, then own members lexicographically:
  // name, additionalData, iv, tagLength, regardless of declaration/property order.
  const additionalDataValue = input.additionalData;
  const additionalData = additionalDataValue === undefined ? undefined : toCryptoBufferSource(additionalDataValue);
  const iv = toCryptoBufferSource(requiredMember(input.iv, "AES-GCM.iv"));
  const tagLengthValue = input.tagLength;
  const tagLength = tagLengthValue === undefined ? undefined : toCryptoUnsignedInteger(tagLengthValue, 8);
  // All getters and conversions finish before any BufferSource snapshot is made.
  const ivBytes = normalizedBytes(iv, copyBuffers);
  const additionalBytes = additionalData === undefined ? undefined : normalizedBytes(additionalData, copyBuffers);
  return new AesGcmParams(name, ivBytes, additionalBytes, tagLength);
}

/**
 * Web Cryptography §18.4.4, https://w3c.github.io/webcrypto/#algorithm-normalization.
 * The initial Algorithm conversion and the registered dictionary conversion
 * are separate: a supported object's name getter and coercion run twice.
 * Borrow bytes only when no script can run before synchronous primitive use.
 * unwrapKey needs snapshots because a second algorithm is normalized afterward.
 */
export function normalizeAlgorithm(
  value: AlgorithmIdentifier,
  operation: "digest",
  copyBuffers?: boolean,
): DigestAlgorithm;
export function normalizeAlgorithm(
  value: AlgorithmIdentifier,
  operation: CryptoOperation,
  copyBuffers?: boolean,
): NormalizedAlgorithm;
export function normalizeAlgorithm(
  value: AlgorithmIdentifier,
  operation: CryptoOperation,
  copyBuffers = false,
): NormalizedAlgorithm {
  const algorithm = typeof value === "string" ? new Algorithm(value) : value;
  const name = algorithmName(algorithm);
  const registration = findRegistration(name, operation);
  if (registration !== undefined) {
    return normalizeRegisteredAlgorithm(algorithm, registration.name, operation, copyBuffers);
  }
  throw new DOMException("The algorithm is not supported for " + operation, "NotSupportedError");
}
