import { DOMException } from "../core/errors.ts";
import { coerceToDOMString } from "../core/webidl.ts";
import type { CryptoDigestName, CryptoMlAlgorithmName, CryptoMlDsaName } from "../provider/crypto.ts";
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
  | "get key length"
  | "encapsulate"
  | "decapsulate"
  | "get shared key length";

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

export type AesAlgorithmName = "AES-CTR" | "AES-CBC" | "AES-GCM" | "AES-KW" | "AES-OCB";
export type KmacAlgorithmName = "KMAC128" | "KMAC256";
export type CshakeAlgorithmName = "cSHAKE128" | "cSHAKE256";
export type SecretAlgorithmName = AesAlgorithmName | "HMAC" | KmacAlgorithmName | "ChaCha20-Poly1305";
export type RsaAlgorithmName = "RSASSA-PKCS1-v1_5" | "RSA-PSS" | "RSA-OAEP";
export type EcAlgorithmName = "ECDSA" | "ECDH";
export type OkpAlgorithmName = "Ed25519" | "X25519" | "Ed448" | "X448";
export type Argon2AlgorithmName = "Argon2d" | "Argon2i" | "Argon2id";
export type KdfAlgorithmName = "HKDF" | "PBKDF2" | Argon2AlgorithmName;
type RegisteredAlgorithmName = CryptoMlAlgorithmName | CryptoDigestName | CshakeAlgorithmName | SecretAlgorithmName | RsaAlgorithmName | EcAlgorithmName | OkpAlgorithmName | KdfAlgorithmName;

/** Modern Algorithms §13.3. Dictionary conversion precedes BufferSource snapshots. */
export class CShakeParams extends Algorithm<CshakeAlgorithmName> {
  readonly outputLength: number;
  readonly functionName: Uint8Array | undefined;
  readonly customization: Uint8Array | undefined;

  constructor(name: CshakeAlgorithmName, outputLength: number, functionName: Uint8Array | undefined, customization: Uint8Array | undefined) {
    super(name);
    this.outputLength = outputLength;
    this.functionName = functionName;
    this.customization = customization;
  }
}

/** Modern Algorithms §§16.3–16.4: generation and import share optional bit length. */
export class KmacKeyGenParams extends Algorithm<KmacAlgorithmName> {
  readonly length: number | undefined;

  constructor(name: KmacAlgorithmName, length: number | undefined) {
    super(name);
    this.length = length;
  }
}

export class KmacImportParams extends Algorithm<KmacAlgorithmName> {
  readonly length: number | undefined;

  constructor(name: KmacAlgorithmName, length: number | undefined) {
    super(name);
    this.length = length;
  }
}

/** Modern Algorithms §16.6. Output length is in bits, not the key's length. */
export class KmacParams extends Algorithm<KmacAlgorithmName> {
  readonly outputLength: number;
  readonly customization: Uint8Array | undefined;

  constructor(name: KmacAlgorithmName, outputLength: number, customization: Uint8Array | undefined) {
    super(name);
    this.outputLength = outputLength;
    this.customization = customization;
  }
}

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

/** Modern Algorithms §10.3, used by AES-OCB and ChaCha20-Poly1305. */
export class AeadParams extends Algorithm<"AES-OCB" | "ChaCha20-Poly1305"> {
  readonly iv: Uint8Array;
  readonly additionalData: Uint8Array | undefined;
  readonly tagLength: number | undefined;

  constructor(name: "AES-OCB" | "ChaCha20-Poly1305", iv: Uint8Array,
    additionalData: Uint8Array | undefined, tagLength: number | undefined) {
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

/** Web Cryptography §§24.3, 26.2 / Secure Curves §4.2 share one dictionary. */
export class EcdhKeyDeriveParams extends Algorithm<"ECDH" | "X25519" | "X448"> {
  readonly public: CryptoKey;

  constructor(name: "ECDH" | "X25519" | "X448", publicKey: CryptoKey) {
    super(name);
    this.public = publicKey;
  }
}

/** Secure Curves §6.3. Context length and its empty default are operation policy. */
export class Ed448Params extends Algorithm<"Ed448"> {
  readonly context: Uint8Array | undefined;

  constructor(name: "Ed448", context: Uint8Array | undefined) {
    super(name);
    this.context = context;
  }
}

/** Modern Algorithms §8.3; the optional context defaults at the operation step. */
export class ContextParams extends Algorithm<CryptoMlDsaName> {
  readonly context: Uint8Array | undefined;

  constructor(name: CryptoMlDsaName, context: Uint8Array | undefined) {
    super(name);
    this.context = context;
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

/** Modern Algorithms §17.3. RFC bounds and version defaults are operation policy. */
export class Argon2Params extends Algorithm<Argon2AlgorithmName> {
  readonly nonce: Uint8Array;
  readonly parallelism: number;
  readonly memory: number;
  readonly passes: number;
  readonly version: number | undefined;
  readonly secretValue: Uint8Array | undefined;
  readonly associatedData: Uint8Array | undefined;

  constructor(
    name: Argon2AlgorithmName,
    nonce: Uint8Array,
    parallelism: number,
    memory: number,
    passes: number,
    version: number | undefined,
    secretValue: Uint8Array | undefined,
    associatedData: Uint8Array | undefined,
  ) {
    super(name);
    this.nonce = nonce;
    this.parallelism = parallelism;
    this.memory = memory;
    this.passes = passes;
    this.version = version;
    this.secretValue = secretValue;
    this.associatedData = associatedData;
  }
}

export type NormalizedAlgorithm =
  | DigestAlgorithm
  | CShakeParams
  | KmacKeyGenParams
  | KmacImportParams
  | KmacParams
  | Algorithm<CryptoMlAlgorithmName | SecretAlgorithmName | RsaAlgorithmName | EcAlgorithmName | OkpAlgorithmName | KdfAlgorithmName>
  | AesKeyGenParams
  | AesDerivedKeyParams
  | AesCtrParams
  | AesCbcParams
  | AesGcmParams
  | AeadParams
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
  | Ed448Params
  | ContextParams
  | HkdfParams
  | Pbkdf2Params
  | Argon2Params;

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
  new AlgorithmRegistration("ML-KEM-512", "encapsulate"),
  new AlgorithmRegistration("ML-KEM-512", "decapsulate"),
  new AlgorithmRegistration("ML-KEM-512", "get shared key length"),
  new AlgorithmRegistration("ML-KEM-512", "generateKey"),
  new AlgorithmRegistration("ML-KEM-512", "importKey"),
  new AlgorithmRegistration("ML-KEM-512", "exportKey"),
  new AlgorithmRegistration("ML-KEM-768", "encapsulate"),
  new AlgorithmRegistration("ML-KEM-768", "decapsulate"),
  new AlgorithmRegistration("ML-KEM-768", "get shared key length"),
  new AlgorithmRegistration("ML-KEM-768", "generateKey"),
  new AlgorithmRegistration("ML-KEM-768", "importKey"),
  new AlgorithmRegistration("ML-KEM-768", "exportKey"),
  new AlgorithmRegistration("ML-KEM-1024", "encapsulate"),
  new AlgorithmRegistration("ML-KEM-1024", "decapsulate"),
  new AlgorithmRegistration("ML-KEM-1024", "get shared key length"),
  new AlgorithmRegistration("ML-KEM-1024", "generateKey"),
  new AlgorithmRegistration("ML-KEM-1024", "importKey"),
  new AlgorithmRegistration("ML-KEM-1024", "exportKey"),

  new AlgorithmRegistration("ML-DSA-44", "sign"),
  new AlgorithmRegistration("ML-DSA-44", "verify"),
  new AlgorithmRegistration("ML-DSA-44", "generateKey"),
  new AlgorithmRegistration("ML-DSA-44", "importKey"),
  new AlgorithmRegistration("ML-DSA-44", "exportKey"),
  new AlgorithmRegistration("ML-DSA-65", "sign"),
  new AlgorithmRegistration("ML-DSA-65", "verify"),
  new AlgorithmRegistration("ML-DSA-65", "generateKey"),
  new AlgorithmRegistration("ML-DSA-65", "importKey"),
  new AlgorithmRegistration("ML-DSA-65", "exportKey"),
  new AlgorithmRegistration("ML-DSA-87", "sign"),
  new AlgorithmRegistration("ML-DSA-87", "verify"),
  new AlgorithmRegistration("ML-DSA-87", "generateKey"),
  new AlgorithmRegistration("ML-DSA-87", "importKey"),
  new AlgorithmRegistration("ML-DSA-87", "exportKey"),

  new AlgorithmRegistration("SHA-1", "digest"),
  new AlgorithmRegistration("SHA-256", "digest"),
  new AlgorithmRegistration("SHA-384", "digest"),
  new AlgorithmRegistration("SHA-512", "digest"),
  new AlgorithmRegistration("SHA3-256", "digest"),
  new AlgorithmRegistration("SHA3-384", "digest"),
  new AlgorithmRegistration("SHA3-512", "digest"),
  new AlgorithmRegistration("cSHAKE128", "digest"),
  new AlgorithmRegistration("cSHAKE256", "digest"),
  new AlgorithmRegistration("KMAC128", "sign"),
  new AlgorithmRegistration("KMAC128", "verify"),
  new AlgorithmRegistration("KMAC128", "generateKey"),
  new AlgorithmRegistration("KMAC128", "importKey"),
  new AlgorithmRegistration("KMAC128", "exportKey"),
  new AlgorithmRegistration("KMAC128", "get key length"),
  new AlgorithmRegistration("KMAC256", "sign"),
  new AlgorithmRegistration("KMAC256", "verify"),
  new AlgorithmRegistration("KMAC256", "generateKey"),
  new AlgorithmRegistration("KMAC256", "importKey"),
  new AlgorithmRegistration("KMAC256", "exportKey"),
  new AlgorithmRegistration("KMAC256", "get key length"),
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
  new AlgorithmRegistration("AES-OCB", "encrypt"),
  new AlgorithmRegistration("AES-OCB", "decrypt"),
  new AlgorithmRegistration("AES-OCB", "generateKey"),
  new AlgorithmRegistration("AES-OCB", "importKey"),
  new AlgorithmRegistration("AES-OCB", "exportKey"),
  new AlgorithmRegistration("AES-OCB", "get key length"),
  new AlgorithmRegistration("ChaCha20-Poly1305", "encrypt"),
  new AlgorithmRegistration("ChaCha20-Poly1305", "decrypt"),
  new AlgorithmRegistration("ChaCha20-Poly1305", "generateKey"),
  new AlgorithmRegistration("ChaCha20-Poly1305", "importKey"),
  new AlgorithmRegistration("ChaCha20-Poly1305", "exportKey"),
  new AlgorithmRegistration("ChaCha20-Poly1305", "get key length"),
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
  new AlgorithmRegistration("Ed448", "sign"),
  new AlgorithmRegistration("Ed448", "verify"),
  new AlgorithmRegistration("Ed448", "generateKey"),
  new AlgorithmRegistration("Ed448", "importKey"),
  new AlgorithmRegistration("Ed448", "exportKey"),
  new AlgorithmRegistration("X448", "deriveBits"),
  new AlgorithmRegistration("X448", "generateKey"),
  new AlgorithmRegistration("X448", "importKey"),
  new AlgorithmRegistration("X448", "exportKey"),
  new AlgorithmRegistration("HKDF", "deriveBits"),
  new AlgorithmRegistration("HKDF", "importKey"),
  new AlgorithmRegistration("HKDF", "get key length"),
  new AlgorithmRegistration("PBKDF2", "deriveBits"),
  new AlgorithmRegistration("PBKDF2", "importKey"),
  new AlgorithmRegistration("PBKDF2", "get key length"),
  new AlgorithmRegistration("Argon2d", "deriveBits"),
  new AlgorithmRegistration("Argon2d", "importKey"),
  new AlgorithmRegistration("Argon2d", "get key length"),
  new AlgorithmRegistration("Argon2i", "deriveBits"),
  new AlgorithmRegistration("Argon2i", "importKey"),
  new AlgorithmRegistration("Argon2i", "get key length"),
  new AlgorithmRegistration("Argon2id", "deriveBits"),
  new AlgorithmRegistration("Argon2id", "importKey"),
  new AlgorithmRegistration("Argon2id", "get key length"),
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

function agreementParameters(algorithm: object, name: "ECDH" | "X25519" | "X448"): EcdhKeyDeriveParams {
  const input = algorithm as { readonly public?: unknown };
  const publicKey = requiredMember(input.public, name + ".public");
  // Web IDL validates the interface brand here. Algorithm, kind and permission
  // checks belong to the later operation and preserve their specified ordering.
  getCryptoKeySlots(publicKey);
  return new EcdhKeyDeriveParams(name, publicKey as CryptoKey);
}

function aeadParameters(algorithm: object, name: "AES-OCB" | "ChaCha20-Poly1305", copyBuffers: boolean): AeadParams {
  const input = algorithm as { readonly additionalData?: unknown; readonly iv?: unknown; readonly tagLength?: unknown };
  // Web IDL converts dictionary members lexicographically; normalization then
  // snapshots BufferSources in their declared order, after all getters finish.
  const additionalDataValue = input.additionalData;
  const additionalData = additionalDataValue === undefined ? undefined : toCryptoBufferSource(additionalDataValue);
  const iv = toCryptoBufferSource(requiredMember(input.iv, name + ".iv"));
  const tagLengthValue = input.tagLength;
  const tagLength = tagLengthValue === undefined ? undefined : toCryptoUnsignedInteger(tagLengthValue, 8);
  return new AeadParams(name, normalizedBytes(iv, copyBuffers),
    additionalData === undefined ? undefined : normalizedBytes(additionalData, copyBuffers), tagLength);
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

  if (name === "SHA-1" || name === "SHA-256" || name === "SHA-384" || name === "SHA-512"
    || name === "SHA3-256" || name === "SHA3-384" || name === "SHA3-512") {
    return new DigestAlgorithm(name);
  }

  if (name === "cSHAKE128" || name === "cSHAKE256") {
    const input = algorithm as { readonly customization?: unknown; readonly functionName?: unknown; readonly outputLength?: unknown };
    const customizationValue = input.customization;
    const customization = customizationValue === undefined ? undefined : toCryptoBufferSource(customizationValue);
    const functionNameValue = input.functionName;
    const functionName = functionNameValue === undefined ? undefined : toCryptoBufferSource(functionNameValue);
    const outputLength = toCryptoUnsignedInteger(requiredMember(input.outputLength, "cSHAKE.outputLength"), 32);
    // The declared BufferSource order is functionName then customization.
    const functionBytes = functionName === undefined ? undefined : normalizedBytes(functionName, copyBuffers);
    const customizationBytes = customization === undefined ? undefined : normalizedBytes(customization, copyBuffers);
    return new CShakeParams(name, outputLength, functionBytes, customizationBytes);
  }

  if (name === "KMAC128" || name === "KMAC256") {
    if (operation === "generateKey" || operation === "importKey" || operation === "get key length") {
      const input = algorithm as { readonly length?: unknown };
      const lengthValue = input.length;
      const length = lengthValue === undefined ? undefined : toCryptoUnsignedInteger(lengthValue, 32);
      return operation === "generateKey" ? new KmacKeyGenParams(name, length) : new KmacImportParams(name, length);
    }
    if (operation === "exportKey") return new Algorithm(name);
    const input = algorithm as { readonly customization?: unknown; readonly outputLength?: unknown };
    const customizationValue = input.customization;
    const customization = customizationValue === undefined ? undefined : toCryptoBufferSource(customizationValue);
    const outputLength = toCryptoUnsignedInteger(requiredMember(input.outputLength, "KMAC.outputLength"), 32);
    return new KmacParams(name, outputLength, customization === undefined ? undefined : normalizedBytes(customization, copyBuffers));
  }

  if (name === "ChaCha20-Poly1305") {
    return operation === "encrypt" || operation === "decrypt"
      ? aeadParameters(algorithm, name, copyBuffers) : new Algorithm(name);
  }

  if (name === "ML-KEM-512" || name === "ML-KEM-768" || name === "ML-KEM-1024") return new Algorithm(name);

  if (name === "ML-DSA-44" || name === "ML-DSA-65" || name === "ML-DSA-87") {
    if (operation !== "sign" && operation !== "verify") return new Algorithm(name);
    const input = algorithm as { readonly context?: unknown };
    const value = input.context;
    const context = value === undefined ? undefined : toCryptoBufferSource(value);
    return new ContextParams(name, context === undefined ? undefined : normalizedBytes(context, copyBuffers));
  }

  if (name === "Ed25519") return new Algorithm(name);
  if (name === "X25519" || name === "X448") {
    return operation === "deriveBits" ? agreementParameters(algorithm, name) : new Algorithm(name);
  }
  if (name === "Ed448") {
    if (operation !== "sign" && operation !== "verify") return new Algorithm(name);
    const input = algorithm as { readonly context?: unknown };
    const contextValue = input.context;
    const context = contextValue === undefined ? undefined : toCryptoBufferSource(contextValue);
    return new Ed448Params(name, context === undefined ? undefined : normalizedBytes(context, copyBuffers));
  }

  if (name === "HKDF") {
    if (operation !== "deriveBits") return new Algorithm(name);
    const input = algorithm as { readonly hash?: unknown; readonly salt?: unknown; readonly info?: unknown };
    // Web IDL visits members lexicographically; §18.4.4 then processes their
    // declared order: hash normalization, salt snapshot, info snapshot.
    const hash = toAlgorithmIdentifier(requiredMember(input.hash, "HKDF.hash"));
    const info = toCryptoBufferSource(requiredMember(input.info, "HKDF.info"));
    const salt = toCryptoBufferSource(requiredMember(input.salt, "HKDF.salt"));
    const normalizedHash = normalizeHashAlgorithm(hash);
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
    const normalizedHash = normalizeHashAlgorithm(hash);
    return new Pbkdf2Params(name, normalizedHash, saltBytes, iterations);
  }

  if (name === "Argon2d" || name === "Argon2i" || name === "Argon2id") {
    if (operation !== "deriveBits") return new Algorithm(name);
    const input = algorithm as {
      readonly nonce?: unknown;
      readonly parallelism?: unknown;
      readonly memory?: unknown;
      readonly passes?: unknown;
      readonly version?: unknown;
      readonly secretValue?: unknown;
      readonly associatedData?: unknown;
    };
    // Web IDL converts the inherited name, then own members lexicographically.
    // Every getter/conversion finishes before any BufferSource snapshot.
    const associatedDataValue = input.associatedData;
    const associatedData = associatedDataValue === undefined ? undefined : toCryptoBufferSource(associatedDataValue);
    const memory = toCryptoUnsignedInteger(requiredMember(input.memory, "Argon2.memory"), 32);
    const nonce = toCryptoBufferSource(requiredMember(input.nonce, "Argon2.nonce"));
    const parallelism = toCryptoUnsignedInteger(requiredMember(input.parallelism, "Argon2.parallelism"), 32);
    const passes = toCryptoUnsignedInteger(requiredMember(input.passes, "Argon2.passes"), 32);
    const secretValueInput = input.secretValue;
    const secretValue = secretValueInput === undefined ? undefined : toCryptoBufferSource(secretValueInput);
    const versionValue = input.version;
    const version = versionValue === undefined ? undefined : toCryptoUnsignedInteger(versionValue, 8);
    // §18.4.4 takes snapshots in declared member order after conversion.
    const nonceBytes = normalizedBytes(nonce, copyBuffers);
    const secretBytes = secretValue === undefined ? undefined : normalizedBytes(secretValue, copyBuffers);
    const associatedBytes = associatedData === undefined ? undefined : normalizedBytes(associatedData, copyBuffers);
    return new Argon2Params(name, nonceBytes, parallelism, memory, passes, version, secretBytes, associatedBytes);
  }

  if (name === "HMAC") {
    if (operation !== "generateKey" && operation !== "importKey" && operation !== "get key length") return new Algorithm(name);
    const input = algorithm as { readonly hash?: unknown; readonly length?: unknown };
    const hash = toAlgorithmIdentifier(requiredMember(input.hash, "HMAC.hash"));
    const lengthValue = input.length;
    const length = lengthValue === undefined ? undefined : toCryptoUnsignedInteger(lengthValue, 32);
    // Dictionary conversion is complete before §18.4.4 recursively normalizes
    // HashAlgorithmIdentifier. In particular, length's coercion precedes hash.name.
    const normalizedHash = normalizeHashAlgorithm(hash);
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
      const normalizedHash = normalizeHashAlgorithm(hash);
      // BigInteger is a Uint8Array typedef, not BufferSource. §18.4.4 does not
      // snapshot it: recursive hash normalization can still change its bytes.
      return new RsaHashedKeyGenParams(name, modulusLength, cryptoBytes(publicExponent), normalizedHash);
    }
    if (operation === "importKey") {
      const input = algorithm as { readonly hash?: unknown };
      const hash = toAlgorithmIdentifier(requiredMember(input.hash, "RSA.hash"));
      return new RsaHashedImportParams(name, normalizeHashAlgorithm(hash));
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
      return new EcdsaParams(name, normalizeHashAlgorithm(hash));
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

  if (name === "AES-OCB") return aeadParameters(algorithm, name, copyBuffers);

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
): DigestAlgorithm | CShakeParams;
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

/** Fixed-size hash choices supported by the native RSA/HMAC/EC/KDF operations. */
export function normalizeHashAlgorithm(value: AlgorithmIdentifier): DigestAlgorithm {
  const algorithm = normalizeAlgorithm(value, "digest");
  if (!(algorithm instanceof DigestAlgorithm)) {
    throw new DOMException("An extensible-output digest is not supported as a hash parameter", "NotSupportedError");
  }
  return algorithm;
}
