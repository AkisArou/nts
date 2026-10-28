/**
 * Synchronous native cryptography, below the Web Cryptography API's algorithms.
 * https://w3c.github.io/webcrypto/#algorithms
 * https://wicg.github.io/webcrypto-secure-curves/
 *
 * Shared TypeScript owns Web IDL conversion, normalization, the operation registry,
 * CryptoKey slots, usages, extractability, JWK parsing and all specification checks
 * and DOMException selection. A primitive receives only typed parameters, bytes and
 * opaque key handles. It neither receives nor returns a JsonWebKey or CryptoKey.
 *
 * Inputs are borrowed until the synchronous call returns. Do not retain or mutate
 * them, invoke script, or enqueue work. Imported material must survive subsequent
 * mutation of the source bytes. Outputs transfer ownership to the caller: fresh,
 * ordinary ArrayBuffers, with no alias to a key, an input, another result or provider
 * scratch memory. Byte results occupy their complete backing buffer. Native handle
 * resources follow the runtime's object lifetime; they are not numeric pointers or
 * script-managed resources.
 *
 * One call processes the whole input, including cryptographic hashing, counter
 * handling and constant-time authentication. No per-byte or per-block calls cross
 * this interface. The caller settles its promise through Scheduler.enqueue after
 * the primitive returns; primitives know nothing about tasks or promises.
 * Failures cross as CryptoFailure values, never native exceptions. The shared
 * operation maps each failure to the specification's error at the required step.
 *
 * RandomSource in primitives.ts remains the randomness capability. Symmetric key
 * generation fills raw bytes with it before importing a secret handle. Randomized
 * native operations use the host's secure randomness as configured by the provider;
 * this contract adds neither a generator nor a seed or deterministic-RNG promise.
 *
 * This contract is intended for OpenSSL 3 and JCA bindings. Their parameter and
 * encoding defaults are not Web Crypto policy: in particular MGF1 must use the
 * requested hash, CTR increments only the requested low bits, and no native padding
 * may be enabled for AES-CBC. The shared layer supplies and checks CBC padding.
 */

export type CryptoDigestName = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

/**
 * The digest portion of CryptoProvider can be bound and tested independently.
 * Fetch's existing DigestProvider is asynchronous and remains unchanged; a host
 * serving both interfaces needs a small adapter instead of changing that contract.
 */
export interface CryptoDigestProvider {
  digest(algorithm: CryptoDigestName, bytes: Uint8Array): Uint8Array | CryptoFailure;
}

declare const cryptoKeyHandleBrand: unique symbol;

/** An uninspectable reference owned by the provider that created it. */
export interface CryptoKeyHandle {
  readonly [cryptoKeyHandleBrand]: true;
}

export type CryptoKeyType = "secret" | "public" | "private";
export type CryptoNamedCurve = "P-256" | "P-384" | "P-521";
export type CryptoOkpCurve = "Ed25519" | "X25519" | "Ed448" | "X448";

export interface CryptoSecretKeyInfo {
  readonly family: "secret";
  readonly type: "secret";
  /** Stored octet length in bits; any logical HMAC length stays in CryptoKey. */
  readonly length: number;
}

export interface CryptoRsaKeyInfo {
  readonly family: "RSA";
  readonly type: "public" | "private";
  readonly modulusLength: number;
  /** Unsigned, minimal big-endian octets, not a JavaScript integer. */
  readonly publicExponent: Uint8Array;
}

export interface CryptoEcKeyInfo {
  readonly family: "EC";
  readonly type: "public" | "private";
  /** Actual decoded curve; may be one shared code must reject. */
  readonly namedCurve: string;
}

export interface CryptoOkpKeyInfo {
  readonly family: "OKP";
  readonly type: "public" | "private";
  readonly namedCurve: CryptoOkpCurve;
}

export type CryptoKeyInfo =
  | CryptoSecretKeyInfo
  | CryptoRsaKeyInfo
  | CryptoEcKeyInfo
  | CryptoOkpKeyInfo;

/** Metadata describes actual imported/generated material, never requested policy. */
export interface CryptoKeyRecord {
  readonly handle: CryptoKeyHandle;
  readonly info: CryptoKeyInfo;
}

export interface CryptoKeyPairRecord {
  readonly publicKey: CryptoKeyRecord;
  readonly privateKey: CryptoKeyRecord;
}

export interface CryptoSecretComponents {
  readonly family: "secret";
  readonly k: Uint8Array;
}

export interface CryptoRsaOtherPrime {
  readonly r: Uint8Array;
  readonly d: Uint8Array;
  readonly t: Uint8Array;
}

/** All RSA integers are unsigned, minimal big-endian octets. */
export interface CryptoRsaComponents {
  readonly family: "RSA";
  readonly n: Uint8Array;
  readonly e: Uint8Array;
  readonly d?: Uint8Array;
  readonly p?: Uint8Array;
  readonly q?: Uint8Array;
  readonly dp?: Uint8Array;
  readonly dq?: Uint8Array;
  readonly qi?: Uint8Array;
  readonly oth?: readonly CryptoRsaOtherPrime[];
}

/** Coordinates and scalar are fixed-width unsigned big-endian octets. */
export interface CryptoEcComponents {
  readonly family: "EC";
  readonly namedCurve: CryptoNamedCurve;
  readonly x: Uint8Array;
  readonly y: Uint8Array;
  readonly d?: Uint8Array;
}

/** RFC 8032/RFC 7748 encodings, preserving their specified byte order. */
export interface CryptoOkpComponents {
  readonly family: "OKP";
  readonly namedCurve: CryptoOkpCurve;
  readonly x: Uint8Array;
  readonly d?: Uint8Array;
}

export type CryptoKeyComponents =
  | CryptoSecretComponents
  | CryptoRsaComponents
  | CryptoEcComponents
  | CryptoOkpComponents;

export interface CryptoRawSecretImport {
  readonly format: "raw";
  readonly family: "secret";
  readonly bytes: Uint8Array;
}

export interface CryptoRawEcImport {
  readonly format: "raw";
  readonly family: "EC";
  readonly namedCurve: CryptoNamedCurve;
  /** SEC 1 uncompressed public point; shared code checks the encoding. */
  readonly bytes: Uint8Array;
}

export interface CryptoRawOkpImport {
  readonly format: "raw";
  readonly family: "OKP";
  readonly namedCurve: CryptoOkpCurve;
  readonly bytes: Uint8Array;
}

export interface CryptoDerImport {
  readonly format: "spki" | "pkcs8";
  readonly bytes: Uint8Array;
}

export interface CryptoComponentsImport {
  readonly format: "components";
  readonly components: CryptoKeyComponents;
}

export type CryptoKeyImport =
  | CryptoRawSecretImport
  | CryptoRawEcImport
  | CryptoRawOkpImport
  | CryptoDerImport
  | CryptoComponentsImport;

export interface CryptoRsaGeneration {
  readonly family: "RSA";
  readonly modulusLength: number;
  readonly publicExponent: Uint8Array;
}

export interface CryptoEcGeneration {
  readonly family: "EC";
  readonly namedCurve: CryptoNamedCurve;
}

export interface CryptoOkpGeneration {
  readonly family: "OKP";
  readonly namedCurve: CryptoOkpCurve;
}

export type CryptoKeyPairGeneration =
  | CryptoRsaGeneration
  | CryptoEcGeneration
  | CryptoOkpGeneration;

export interface CryptoAesCtrParameters {
  readonly name: "AES-CTR";
  readonly counter: Uint8Array;
  /** Low-order counter bits, 1..128; higher nonce bits never change. */
  readonly counterLength: number;
}

export interface CryptoAesCbcParameters {
  readonly name: "AES-CBC";
  readonly iv: Uint8Array;
}

export interface CryptoAesGcmParameters {
  readonly name: "AES-GCM";
  readonly iv: Uint8Array;
  readonly additionalData: Uint8Array;
  /** Authentication tag length in bits. */
  readonly tagLength: number;
}

export interface CryptoAesKwParameters {
  /** RFC 3394 with its standard fixed initial value. */
  readonly name: "AES-KW";
}

export interface CryptoRsaOaepParameters {
  readonly name: "RSA-OAEP";
  readonly hash: CryptoDigestName;
  readonly label: Uint8Array;
}

export type CryptoCipherParameters =
  | CryptoAesCtrParameters
  | CryptoAesCbcParameters
  | CryptoAesGcmParameters
  | CryptoAesKwParameters
  | CryptoRsaOaepParameters;

/** GCM's tag is separate so its concatenation/splitting remains shared policy. */
export interface CryptoCiphertext {
  readonly bytes: Uint8Array;
  readonly tag: Uint8Array | null;
}

export interface CryptoHashSignatureParameters {
  readonly name: "HMAC" | "RSASSA-PKCS1-v1_5" | "ECDSA";
  readonly hash: CryptoDigestName;
}

export interface CryptoRsaPssParameters {
  readonly name: "RSA-PSS";
  readonly hash: CryptoDigestName;
  /** Salt length in octets; the same hash is used for MGF1. */
  readonly saltLength: number;
}

export interface CryptoEd25519Parameters {
  readonly name: "Ed25519";
}

export interface CryptoEd448Parameters {
  readonly name: "Ed448";
  readonly context: Uint8Array;
}

export type CryptoSignatureParameters =
  | CryptoHashSignatureParameters
  | CryptoRsaPssParameters
  | CryptoEd25519Parameters
  | CryptoEd448Parameters;

export interface CryptoByteSignature {
  readonly kind: "bytes";
  readonly bytes: Uint8Array;
}

/**
 * Unsigned big-endian ECDSA integers. Signing returns minimal encodings; shared
 * code pads each to the curve width and concatenates them. Verification receives
 * the two fixed-width slices of the public signature, without big-integer work.
 */
export interface CryptoEcdsaSignature {
  readonly kind: "ecdsa";
  readonly r: Uint8Array;
  readonly s: Uint8Array;
}

export type CryptoSignature = CryptoByteSignature | CryptoEcdsaSignature;

export interface CryptoAgreementParameters {
  readonly name: "ECDH" | "X25519" | "X448";
  readonly publicKey: CryptoKeyHandle;
}

export interface CryptoHkdfParameters {
  readonly name: "HKDF";
  readonly hash: CryptoDigestName;
  readonly salt: Uint8Array;
  readonly info: Uint8Array;
  readonly byteLength: number;
}

export interface CryptoPbkdf2Parameters {
  readonly name: "PBKDF2";
  readonly hash: CryptoDigestName;
  readonly salt: Uint8Array;
  readonly iterations: number;
  readonly byteLength: number;
}

export type CryptoDerivationParameters =
  | CryptoAgreementParameters
  | CryptoHkdfParameters
  | CryptoPbkdf2Parameters;

/** A native failure value; the shared operation selects its specified DOMException. */
export interface CryptoFailure {
  readonly failure: "invalid-key" | "operation";
}

/**
 * Complete seam proposed for review before implementing the remaining algorithms.
 * No method performs Web Crypto's operation registration, input conversion, usage,
 * extractability or format-policy checks. Invalid mathematical key material may
 * return { failure: "invalid-key" }; other native failures return
 * { failure: "operation" }. Native code does not throw across this interface.
 * Verification returns a boolean. The shared caller alone selects observable
 * errors and their order.
 */
export interface CryptoProvider extends CryptoDigestProvider {
  /**
   * Shared code validates the original DER's structure, exact consumption, OIDs,
   * versions and parameter presence before calling this method. Native parsers can
   * accept trailing bytes or normalize AlgorithmIdentifier parameters, so successful
   * native import is not evidence that the original encoding meets the specification.
   * Components have already been decoded from JWK and checked by shared code.
   * Report the actual type, curve, modulus and exponent in info. Mathematical
   * decoding must not strengthen the API's import requirements: in particular,
   * OKP public imports retain the supplied encoded point without imposing an
   * on-curve, canonical-encoding or small-order test. Verification/agreement apply
   * the requested cryptographic operation's rules when the key is used. Shared
   * code is responsible for any format-specific public/private consistency check.
   */
  importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure;

  /**
   * Shared code selects the permitted format and checks extractability first.
   * DER output uses the standard key's SPKI/PKCS #8 structures, never encrypted
   * PKCS #8, PEM, native structs or a provider-specific algorithm identifier.
   */
  exportKey(key: CryptoKeyHandle, format: "raw" | "spki" | "pkcs8"): Uint8Array | CryptoFailure;

  /** Return decoded components; the shared layer constructs and validates JWK. */
  exportComponents(key: CryptoKeyHandle): CryptoKeyComponents | CryptoFailure;

  generateKeyPair(parameters: CryptoKeyPairGeneration): CryptoKeyPairRecord | CryptoFailure;

  /** CBC input is already padded; GCM returns its tag separately, others use null. */
  encrypt(parameters: CryptoCipherParameters, key: CryptoKeyHandle, data: Uint8Array): CryptoCiphertext | CryptoFailure;

  /** CBC output remains padded. Authentication failure must not return plaintext. */
  decrypt(parameters: CryptoCipherParameters, key: CryptoKeyHandle, data: CryptoCiphertext): Uint8Array | CryptoFailure;

  sign(parameters: CryptoSignatureParameters, key: CryptoKeyHandle, data: Uint8Array): CryptoSignature | CryptoFailure;

  /** Invalid signatures return false; HMAC comparison must be constant-time. */
  verify(
    parameters: CryptoSignatureParameters,
    key: CryptoKeyHandle,
    signature: CryptoSignature,
    data: Uint8Array,
  ): boolean;

  /**
   * Agreement returns the complete fixed-width secret; shared code applies the
   * requested bit length and X25519/X448's all-zero rule. It must do that comparison
   * without data-dependent early exit. KDF requests specify the complete byte count;
   * shared code validates their bit-length/iteration rules before the single call.
   */
  derive(parameters: CryptoDerivationParameters, key: CryptoKeyHandle): Uint8Array | CryptoFailure;
}
