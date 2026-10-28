import { DOMException } from "../core/errors.ts";
import { coerceToDOMString } from "../core/webidl.ts";
import type { CryptoDigestName } from "../provider/crypto.ts";
import { copyCryptoBytes, cryptoBytes, toCryptoBufferSource } from "./buffer-source.ts";
import type { CryptoBufferSource } from "./buffer-source.ts";
import { toCryptoUnsignedInteger } from "./webidl.ts";

const stringCodeUnit = Function.prototype.call.bind(String.prototype.charCodeAt) as
  (value: string, index: number) => number;

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
type RegisteredAlgorithmName = CryptoDigestName | SecretAlgorithmName;

/** Web Cryptography §27.5. Validation of AES key sizes is an operation step. */
export class AesKeyGenParams extends Algorithm<AesAlgorithmName> {
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

export type NormalizedAlgorithm =
  | DigestAlgorithm
  | Algorithm<SecretAlgorithmName>
  | AesKeyGenParams
  | AesCtrParams
  | AesCbcParams
  | AesGcmParams
  | HmacKeyGenParams
  | HmacImportParams;

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
  new AlgorithmRegistration("AES-CBC", "encrypt"),
  new AlgorithmRegistration("AES-CBC", "decrypt"),
  new AlgorithmRegistration("AES-CBC", "generateKey"),
  new AlgorithmRegistration("AES-CBC", "importKey"),
  new AlgorithmRegistration("AES-CBC", "exportKey"),
  new AlgorithmRegistration("AES-GCM", "encrypt"),
  new AlgorithmRegistration("AES-GCM", "decrypt"),
  new AlgorithmRegistration("AES-GCM", "generateKey"),
  new AlgorithmRegistration("AES-GCM", "importKey"),
  new AlgorithmRegistration("AES-GCM", "exportKey"),
  new AlgorithmRegistration("AES-KW", "wrapKey"),
  new AlgorithmRegistration("AES-KW", "unwrapKey"),
  new AlgorithmRegistration("AES-KW", "generateKey"),
  new AlgorithmRegistration("AES-KW", "importKey"),
  new AlgorithmRegistration("AES-KW", "exportKey"),
  new AlgorithmRegistration("HMAC", "sign"),
  new AlgorithmRegistration("HMAC", "verify"),
  new AlgorithmRegistration("HMAC", "generateKey"),
  new AlgorithmRegistration("HMAC", "importKey"),
  new AlgorithmRegistration("HMAC", "exportKey"),
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
    let code = stringCodeUnit(left, index);
    let expected = stringCodeUnit(right, index);
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

  if (name === "HMAC") {
    if (operation !== "generateKey" && operation !== "importKey") return new Algorithm(name);
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

  if (operation === "generateKey") {
    const input = algorithm as { readonly length?: unknown };
    const length = toCryptoUnsignedInteger(requiredMember(input.length, "AES.length"), 16);
    return new AesKeyGenParams(name, length);
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
