// Web Crypto's algorithm registry and normalization, from node v24.20.0
// `lib/internal/crypto/util.js`, with the helpers the operations share.
//
// The registry holds the algorithms this module implements; one it does not
// yet is unrecognized, as it is to a node whose OpenSSL lacks it.

import { domException, domExceptionWithCause } from "../../../internal/dom-exception.ts";
import { emitExperimentalWarning } from "../../../internal/process-warning.ts";
import { validateArray } from "../../../internal/validators.ts";
import type { IdlDictionary } from "../../../internal/webidl.ts";
import { isDataView } from "../../../util/src/types.ts";
import { cipherId, jobError } from "../util.ts";
import type { CryptoKey } from "./key.ts";
import { getUsagesMask, usageMask } from "./key.ts";
import { convertAlgorithm, dictionaryConverter } from "./webidl.ts";

export { numBitsToBytes, validateMaxBufferLength } from "./webidl.ts";

/** The operations an algorithm can be registered for. */
export type Operation =
  | "digest"
  | "generateKey"
  | "importKey"
  | "exportKey"
  | "sign"
  | "verify"
  | "encrypt"
  | "decrypt"
  | "deriveBits"
  | "get key length"
  | "wrapKey"
  | "unwrapKey"
  | "encapsulate"
  | "decapsulate";

type Definitions = Record<string, Partial<Record<Operation, string | null>>>;

/**
 * Each algorithm's operations, and the dictionary each operation's parameters
 * convert through -- null for none beyond `Algorithm`.
 */
const kAlgorithmDefinitions: Definitions = {
  "AES-CBC": {
    generateKey: "AesKeyGenParams",
    exportKey: null,
    importKey: null,
    encrypt: "AesCbcParams",
    decrypt: "AesCbcParams",
    "get key length": "AesDerivedKeyParams",
  },
  "AES-CTR": {
    generateKey: "AesKeyGenParams",
    exportKey: null,
    importKey: null,
    encrypt: "AesCtrParams",
    decrypt: "AesCtrParams",
    "get key length": "AesDerivedKeyParams",
  },
  "AES-GCM": {
    generateKey: "AesKeyGenParams",
    exportKey: null,
    importKey: null,
    encrypt: "AeadParams",
    decrypt: "AeadParams",
    "get key length": "AesDerivedKeyParams",
  },
  "AES-KW": {
    generateKey: "AesKeyGenParams",
    exportKey: null,
    importKey: null,
    "get key length": "AesDerivedKeyParams",
    wrapKey: null,
    unwrapKey: null,
  },
  "AES-OCB": {
    generateKey: "AesKeyGenParams",
    exportKey: null,
    importKey: null,
    encrypt: "AeadParams",
    decrypt: "AeadParams",
    "get key length": "AesDerivedKeyParams",
  },
  HKDF: {
    importKey: null,
    deriveBits: "HkdfParams",
    "get key length": null,
  },
  HMAC: {
    generateKey: "HmacKeyGenParams",
    exportKey: null,
    importKey: "HmacImportParams",
    sign: null,
    verify: null,
    "get key length": "HmacImportParams",
  },
  PBKDF2: {
    importKey: null,
    deriveBits: "Pbkdf2Params",
    "get key length": null,
  },
  "RSA-OAEP": {
    generateKey: "RsaHashedKeyGenParams",
    exportKey: null,
    importKey: "RsaHashedImportParams",
    encrypt: "RsaOaepParams",
    decrypt: "RsaOaepParams",
  },
  "RSA-PSS": {
    generateKey: "RsaHashedKeyGenParams",
    exportKey: null,
    importKey: "RsaHashedImportParams",
    sign: "RsaPssParams",
    verify: "RsaPssParams",
  },
  "RSASSA-PKCS1-v1_5": {
    generateKey: "RsaHashedKeyGenParams",
    exportKey: null,
    importKey: "RsaHashedImportParams",
    sign: null,
    verify: null,
  },
  "SHA-1": { digest: null },
  "SHA-256": { digest: null },
  "SHA-384": { digest: null },
  "SHA-512": { digest: null },
  "SHA3-256": { digest: null },
  "SHA3-384": { digest: null },
  "SHA3-512": { digest: null },
};

/** Node's experimental algorithms: looking one up warns, once. */
const experimentalAlgorithms = [
  "AES-OCB",
  "Argon2d",
  "Argon2i",
  "Argon2id",
  "ChaCha20-Poly1305",
  "cSHAKE128",
  "cSHAKE256",
  "Ed448",
  "KMAC128",
  "KMAC256",
  "ML-DSA-44",
  "ML-DSA-65",
  "ML-DSA-87",
  "ML-KEM-512",
  "ML-KEM-768",
  "ML-KEM-1024",
  "SHA3-256",
  "SHA3-384",
  "SHA3-512",
  "TurboSHAKE128",
  "TurboSHAKE256",
  "KT128",
  "KT256",
  "X448",
];

/** Node's registry lookup, which warns for an experimental algorithm as its getter does. */
function registeredDictionary(name: string, operation: Operation): string | null | undefined {
  const dictionary = kAlgorithmDefinitions[name]?.[operation];
  if (dictionary !== undefined && experimentalAlgorithms.includes(name)) {
    emitExperimentalWarning(`The ${name} Web Crypto API algorithm`);
  }
  return dictionary;
}

/**
 * Node's `conditionalAlgorithms`, for the names this registry holds: an
 * algorithm this OpenSSL lacks is left out, as node leaves it out.
 */
function isSupported(name: string): boolean {
  if (name === "AES-OCB") return cipherId("aes-128-ocb") >= 0;
  return true;
}

/** The registry's names by their upper case, made on first use. */
let upperCaseNames: Record<string, string> | null = null;

/** The canonical name of an algorithm an operation has, by a case-insensitive match. */
function canonicalName(name: string, operation: Operation): string | undefined {
  if (upperCaseNames === null) {
    const index: Record<string, string> = {};
    for (const candidate of Object.keys(kAlgorithmDefinitions)) {
      if (isSupported(candidate)) index[candidate.toUpperCase()] = candidate;
    }
    upperCaseNames = index;
  }
  const candidate = Object.hasOwn(upperCaseNames, name.toUpperCase()) ? upperCaseNames[name.toUpperCase()] : undefined;
  return candidate !== undefined && kAlgorithmDefinitions[candidate]![operation] !== undefined ? candidate : undefined;
}

/**
 * Node's `kSupportedAlgorithms`, for the tests that read it: by operation,
 * then name, each experimental one behind a getter that warns.
 */
export function supportedAlgorithms(): Record<string, Record<string, string | null>> {
  const table: Record<string, Record<string, string | null>> = {};
  for (const name of Object.keys(kAlgorithmDefinitions)) {
    if (!isSupported(name)) continue;
    const operations = kAlgorithmDefinitions[name]!;
    for (const operation of Object.keys(operations) as Operation[]) {
      const dictionary = operations[operation] ?? null;
      const registered = (table[operation] ??= {});
      if (experimentalAlgorithms.includes(name)) {
        Object.defineProperty(registered, name, {
          get: () => registeredDictionary(name, operation) ?? null,
          enumerable: true,
        });
      } else {
        registered[name] = dictionary;
      }
    }
  }
  return table;
}

/** The members of each dictionary normalization copies or normalizes again. */
const simpleAlgorithmDictionaries: Record<string, Record<string, string>> = {
  AesCbcParams: { iv: "BufferSource" },
  AesCtrParams: { counter: "BufferSource" },
  AeadParams: { iv: "BufferSource", additionalData: "BufferSource" },
  // `publicExponent` is a BigInteger, a Uint8Array, and is copied as a buffer is.
  RsaHashedKeyGenParams: { hash: "HashAlgorithmIdentifier", publicExponent: "BufferSource" },
  EcKeyGenParams: {},
  HmacKeyGenParams: { hash: "HashAlgorithmIdentifier" },
  RsaPssParams: {},
  EcdsaParams: { hash: "HashAlgorithmIdentifier" },
  HmacImportParams: { hash: "HashAlgorithmIdentifier" },
  HkdfParams: { hash: "HashAlgorithmIdentifier", salt: "BufferSource", info: "BufferSource" },
  ContextParams: { context: "BufferSource" },
  Pbkdf2Params: { hash: "HashAlgorithmIdentifier", salt: "BufferSource" },
  RsaOaepParams: { label: "BufferSource" },
  RsaHashedImportParams: { hash: "HashAlgorithmIdentifier" },
  EcKeyImportParams: {},
  CShakeParams: { functionName: "BufferSource", customization: "BufferSource" },
  Argon2Params: { associatedData: "BufferSource", nonce: "BufferSource", secretValue: "BufferSource" },
  KmacParams: { customization: "BufferSource" },
  KangarooTwelveParams: { customization: "BufferSource" },
  TurboShakeParams: {},
};

/**
 * A normalized algorithm: its canonical name and the members its dictionary
 * has, each buffer copied and each hash normalized in turn.
 */
export interface NormalizedAlgorithm {
  name: string;
  hash?: NormalizedAlgorithm;
  length?: number;
  iv?: Uint8Array;
  additionalData?: Uint8Array;
  tagLength?: number;
  counter?: Uint8Array;
  salt?: Uint8Array;
  info?: Uint8Array;
  iterations?: number;
  namedCurve?: string;
  modulusLength?: number;
  publicExponent?: Uint8Array;
  saltLength?: number;
  label?: Uint8Array;
  public?: CryptoKey;
  context?: Uint8Array;
  outputLength?: number;
  functionName?: Uint8Array;
  customization?: Uint8Array;
  nonce?: Uint8Array;
  parallelism?: number;
  memory?: number;
  passes?: number;
  version?: number;
  secretValue?: Uint8Array;
  associatedData?: Uint8Array;
  domainSeparation?: number;
}

const kNormalizeAlgorithmOptions = { prefix: "Failed to normalize algorithm", context: "passed algorithm" };

/** A buffer's bytes, copied: normalization takes a snapshot of the caller's. */
function copyBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  const bytes = ArrayBuffer.isView(value)
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value, 0, value.byteLength);
  return bytes.slice();
}

/**
 * Web Crypto's "normalize an algorithm" for an operation: the canonical name
 * by a case-insensitive lookup, then the operation's dictionary, read from an
 * object inheriting the caller's -- so its `name` getter runs once -- with
 * buffers copied and hashes normalized as digests.
 */
export function normalizeAlgorithm(algorithm: unknown, operation: Operation): NormalizedAlgorithm {
  if (typeof algorithm === "string") return normalizeAlgorithm({ name: algorithm }, operation);
  const initial = convertAlgorithm(algorithm, kNormalizeAlgorithmOptions) as { name: string };
  const name = canonicalName(initial.name, operation);
  if (name === undefined) throw domException("Unrecognized algorithm name", "NotSupportedError");
  const dictionary = registeredDictionary(name, operation);
  if (dictionary === null || dictionary === undefined) return { name };

  const derived = Object.create(algorithm as object) as IdlDictionary;
  derived.name = name;
  const normalized = dictionaryConverter(dictionary)(derived, kNormalizeAlgorithmOptions);
  normalized.name = name;
  const members = simpleAlgorithmDictionaries[dictionary];
  if (members !== undefined) {
    for (const member of Object.keys(members)) {
      const value = normalized[member];
      if (members[member] === "BufferSource" && value) {
        normalized[member] = copyBytes(value as ArrayBuffer | ArrayBufferView);
      } else if (members[member] === "HashAlgorithmIdentifier") {
        normalized[member] = normalizeAlgorithm(value, "digest");
      }
    }
  }
  return normalized as unknown as NormalizedAlgorithm;
}

/** Node's `normalizeHashName` for Web Crypto's names: OpenSSL's, or undefined. */
export function webCryptoHashName(name: string): string | undefined {
  switch (name) {
    case "SHA-1":
      return "sha1";
    case "SHA-256":
      return "sha256";
    case "SHA-384":
      return "sha384";
    case "SHA-512":
      return "sha512";
    case "SHA3-256":
      return "sha3-256";
    case "SHA3-384":
      return "sha3-384";
    case "SHA3-512":
      return "sha3-512";
    case "cSHAKE128":
      return "shake128";
    case "cSHAKE256":
      return "shake256";
    default:
      return undefined;
  }
}

/** Node's `getBlockSize`: HMAC's default key length, in bits. */
export function getBlockSize(name: string): number {
  switch (name) {
    case "SHA-1":
    case "SHA-256":
      return 512;
    case "SHA-384":
    case "SHA-512":
      return 1024;
    default:
      // SHA-3's interaction is not yet defined (WICG webcrypto-modern-algos #23).
      throw domException("Explicit algorithm length member is required", "NotSupportedError");
  }
}

/** Node's `getDigestSizeInBytes`. */
export function getDigestSizeInBytes(name: string): number | undefined {
  switch (name) {
    case "SHA-1":
      return 20;
    case "SHA-256":
    case "SHA3-256":
      return 32;
    case "SHA-384":
    case "SHA3-384":
      return 48;
    case "SHA-512":
    case "SHA3-512":
      return 64;
    default:
      return undefined;
  }
}

/** Node's `truncateToBitLength`: the bytes `length` bits need, the unused low bits cleared. */
export function truncateToBitLength(length: number, bytes: ArrayBuffer | ArrayBufferView): Uint8Array {
  const lengthBytes = Math.floor(length / 8) + Math.floor((7 + (length % 8)) / 8);
  const view = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes, 0, bytes.byteLength);
  const result = view.slice(0, lengthBytes);
  const remainder = length % 8;
  if (remainder !== 0) result[lengthBytes - 1]! &= (0xff << (8 - remainder)) & 0xff;
  return result;
}

/**
 * Node's `bigIntArrayToUnsignedInt`: a big-endian BigInteger as an unsigned
 * 32-bit number, or undefined for one that does not fit.
 */
export function bigIntArrayToUnsignedInt(input: Uint8Array): number | undefined {
  let result = 0;
  for (let n = 0; n < input.length; ++n) {
    const reversed = input.length - n - 1;
    if (reversed >= 4 && input[n]) return undefined;
    result |= input[n]! << (8 * reversed);
  }
  return result >>> 0;
}

/** Node's `bigIntArrayToUnsignedBigInt`. */
export function bigIntArrayToUnsignedBigInt(input: Uint8Array): bigint {
  let result = 0n;
  for (let n = 0; n < input.length; ++n) {
    const reversed = input.length - n - 1;
    result |= BigInt(input[n]!) << (8n * BigInt(reversed));
  }
  return result;
}

/**
 * Node's `validateKeyOps`: a JWK's `key_ops`, each known one once, and
 * covering every usage asked for.
 */
export function validateKeyOps(keyOps: unknown, usages?: Iterable<string>): void {
  if (keyOps === undefined) return;
  validateArray(keyOps, "keyData.key_ops");
  let keyOpsMask = 0;
  for (const op of keyOps) {
    const mask = typeof op === "string" ? usageMask(op) : 0;
    if (mask === 0) continue;
    if (keyOpsMask & mask) throw domException("Duplicate key operation", "DataError");
    keyOpsMask |= mask;
  }
  if (usages !== undefined) {
    const usagesMask = getUsagesMask(usages);
    if ((keyOpsMask & usagesMask) !== usagesMask) throw domException("Key operations and usage mismatch", "DataError");
  }
}

/**
 * A buffer source's bytes as a view, without copying. A view on a detached
 * buffer is empty, as node's `ArrayBufferViewContents` reads one.
 */
export function bytesOfSource(source: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (ArrayBuffer.isView(source) || isDataView(source)) {
    const buffer = source.buffer as ArrayBuffer;
    if (buffer.detached) return new Uint8Array(0);
    return source instanceof Uint8Array ? source : new Uint8Array(buffer, source.byteOffset, source.byteLength);
  }
  if (source.detached) return new Uint8Array(0);
  return new Uint8Array(source);
}

// -- jobs ---------------------------------------------------------------------------
//
// A program may replace `Promise.prototype.then`, put accessors on
// `Promise.prototype.constructor` or `Promise[Symbol.species]`, or a `then`
// on any prototype a result inherits, and none of it may observe Web
// Crypto's intermediate values (`test-webcrypto-promise-prototype-pollution`).
// Node keeps to that with primordials. Here nothing chains promises at all:
// work is a `Job`, started with the callbacks that settle it, composed before
// it starts, and made into one promise at the end -- whose result is
// resolved with its inherited `then` shadowed.

/** Work not yet started: started with the callbacks that settle it. */
export type Job<T> = (succeed: (value: T) => void, fail: (reason: unknown) => void) => void;

/** A job whose value is already known. */
export function resolvedJob<T>(value: T): Job<T> {
  return (succeed) => succeed(value);
}

/** Node's `jobPromiseThen`: a job's value transformed, a throw from the transform its failure. */
export function mapJob<T, R>(job: Job<T>, transform: (value: T) => R): Job<R> {
  return (succeed, fail) =>
    job((value) => {
      let result: R;
      try {
        result = transform(value);
      } catch (error) {
        fail(error);
        return;
      }
      succeed(result);
    }, fail);
}

/**
 * What a Web Crypto job rejects with when its native work fails: node's
 * `CreateWebCryptoJobError`, an `OperationError` carrying the cause.
 */
export function operationError(cause: unknown): Error {
  return domExceptionWithCause("The operation failed for an operation-specific reason", "OperationError", cause);
}

/**
 * Node's `jobPromise`: a job made as it starts, where a failure to make it --
 * its native configuration refusing -- fails with an `OperationError`.
 */
export function jobPromise<T>(make: () => Job<T>): Job<T> {
  return (succeed, fail) => {
    let job: Job<T>;
    try {
      job = make();
    } catch (error) {
      fail(operationError(error));
      return;
    }
    job(succeed, fail);
  };
}

/**
 * Native pool work: its value, or an `OperationError` whose cause is the
 * job's error -- OpenSSL's, or node's `fallback` for a job that queued nothing.
 */
export function nativeJob<T>(fallback: string, start: (succeed: (value: T) => void, fail: () => void) => void): Job<T> {
  return (succeed, fail) => start(succeed, () => fail(operationError(jobError(fallback))));
}

/** Native work delivering bytes, as an `ArrayBuffer` of their own. */
export function bytesJob(fallback: string, start: (done: (ok: boolean, bytes: Uint8Array) => void) => void): Job<ArrayBuffer> {
  return nativeJob<ArrayBuffer>(fallback, (succeed, fail) =>
    start((ok, bytes) => (ok ? succeed(arrayBufferOf(bytes)) : fail())),
  );
}

/**
 * Node's `prepareWebCryptoResult`: an own, undefined `then` on an object
 * result for the length of its resolution, so thenable assimilation reads
 * that rather than an inherited accessor. False where nothing was added.
 */
function prepareWebCryptoResult(value: unknown): boolean {
  if ((value === null || typeof value !== "object") && typeof value !== "function") return false;
  if (value instanceof Promise || Object.hasOwn(value as object, "then")) return false;
  Object.defineProperty(value, "then", { configurable: true, enumerable: true, writable: true, value: undefined });
  return true;
}

/** Node's `resolveWebCryptoResult`. */
function resolveWebCryptoResult<T>(resolve: (value: T) => void, value: T): void {
  const shadowed = prepareWebCryptoResult(value);
  try {
    resolve(value);
  } finally {
    if (shadowed) delete (value as { then?: unknown }).then;
  }
}

/**
 * Node's `callSubtleCryptoMethod`: a method's job as its promise -- a throw
 * while it runs, a rejection; its value resolved as a Web Crypto result.
 */
export function callSubtleCryptoMethod<T>(method: () => Job<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    method()((value) => resolveWebCryptoResult(resolve, value), reject);
  });
}

/** Bytes in an `ArrayBuffer` of their own, copied only when they are part of a larger one. */
export function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  const buffer = bytes.buffer as ArrayBuffer;
  if (bytes.byteOffset === 0 && bytes.byteLength === buffer.byteLength) return buffer;
  return buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
