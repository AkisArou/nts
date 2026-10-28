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

export type CryptoDigestName = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512" | "SHA3-256" | "SHA3-384" | "SHA3-512";

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
export type CryptoMlDsaName = "ML-DSA-44" | "ML-DSA-65" | "ML-DSA-87";
export type CryptoMlKemName = "ML-KEM-512" | "ML-KEM-768" | "ML-KEM-1024";
export type CryptoMlAlgorithmName = CryptoMlDsaName | CryptoMlKemName;

/** FIPS 203/204 keys retain their seed as well as native expanded material. */
export interface CryptoMlKeyInfo {
  readonly family: "ML";
  readonly type: "public" | "private";
  readonly name: CryptoMlAlgorithmName;
}

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
  | CryptoOkpKeyInfo
  | CryptoMlKeyInfo;

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

/** Encoded public key and, for private keys, the original key-generation seed. */
export interface CryptoMlComponents {
  readonly family: "ML";
  readonly name: CryptoMlAlgorithmName;
  readonly pub: Uint8Array;
  readonly seed?: Uint8Array;
}

export type CryptoKeyComponents =
  | CryptoSecretComponents
  | CryptoRsaComponents
  | CryptoEcComponents
  | CryptoOkpComponents
  | CryptoMlComponents;

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

export interface CryptoRawMlImport {
  readonly format: "raw-public" | "raw-seed";
  readonly family: "ML";
  readonly name: CryptoMlAlgorithmName;
  readonly bytes: Uint8Array;
  /**
   * A decoded PKCS8 `both` value also supplies its expanded private encoding.
   * With raw-seed, the primitive must validate that these bytes correspond to
   * native expansion of the seed, or return invalid-key. Never trust two unrelated
   * encodings merely because a permissive decoder accepts their container.
   */
  readonly expanded?: Uint8Array;
}

export interface CryptoComponentsImport {
  readonly format: "components";
  readonly components: CryptoKeyComponents;
}

export type CryptoKeyImport =
  | CryptoRawSecretImport
  | CryptoRawEcImport
  | CryptoRawOkpImport
  | CryptoRawMlImport
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

/** FIPS 204 key generation and seed expansion are entirely native. */
export interface CryptoMlGeneration {
  readonly family: "ML";
  readonly name: CryptoMlAlgorithmName;
}

export type CryptoKeyPairGeneration =
  | CryptoRsaGeneration
  | CryptoEcGeneration
  | CryptoOkpGeneration
  | CryptoMlGeneration;

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

/** Modern Algorithms §§10–11. Encryption and tag authentication stay native. */
export interface CryptoAeadParameters {
  readonly name: "AES-OCB" | "ChaCha20-Poly1305";
  /** AES-OCB: at most 15 octets; ChaCha20-Poly1305: exactly 12 octets. */
  readonly iv: Uint8Array;
  readonly additionalData: Uint8Array;
  /** Bits: AES-OCB accepts 64/96/128; ChaCha20-Poly1305 requires 128. */
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
  | CryptoAeadParameters
  | CryptoAesKwParameters
  | CryptoRsaOaepParameters;

/** AEAD tags are separate so concatenation/splitting remains shared policy. */
export interface CryptoCiphertext {
  readonly bytes: Uint8Array;
  readonly tag: Uint8Array | null;
}

/** Modern Algorithms §13: native cSHAKE includes N/S domain separation and squeezing. */
export interface CryptoCshakeParameters {
  readonly name: "cSHAKE128" | "cSHAKE256";
  readonly functionName: Uint8Array;
  readonly customization: Uint8Array;
  /** Requested bits, encoded least-significant-bit first as in Modern Algorithms §2.1. */
  readonly outputLength: number;
}

/** Modern Algorithms §16: the primitive owns KMAC and constant-time verification. */
export interface CryptoKmacParameters {
  readonly name: "KMAC128" | "KMAC256";
  /** Logical bits in the secret handle; unused high bits of the last byte are zero. */
  readonly keyLength: number;
  readonly outputLength: number;
  readonly customization: Uint8Array;
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

/** Pure ML-DSA with its FIPS 204 context, never HashML-DSA or a prehashed input. */
export interface CryptoMlDsaParameters {
  readonly name: CryptoMlDsaName;
  readonly context: Uint8Array;
}

export type CryptoSignatureParameters =
  | CryptoHashSignatureParameters
  | CryptoRsaPssParameters
  | CryptoEd25519Parameters
  | CryptoEd448Parameters
  | CryptoKmacParameters
  | CryptoMlDsaParameters;

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

/** FIPS 203 parameter set; key validation and all KEM computations stay native. */
export interface CryptoKemParameters {
  readonly name: CryptoMlKemName;
}

/** Independently owned complete outputs: a 32-byte shared key and ciphertext. */
export interface CryptoEncapsulation {
  readonly sharedKey: Uint8Array;
  readonly ciphertext: Uint8Array;
}

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

/**
 * RFC 9106's Argon2 v1.3. The native primitive performs the complete
 * memory-hard derivation, including Blake2b and all memory/lane processing.
 * Memory is measured in KiB; RFC 9106 rounds it down internally to a multiple
 * of four times parallelism. Empty optional inputs are equivalent to absence.
 * The nonce and all input/output bounds belong to the native RFC operation;
 * failure, including allocation failure, returns a CryptoFailure value.
 * https://wicg.github.io/webcrypto-modern-algos/#argon2-operations-derive-bits
 */
export interface CryptoArgon2Parameters {
  readonly name: "Argon2d" | "Argon2i" | "Argon2id";
  readonly nonce: Uint8Array;
  readonly parallelism: number;
  readonly memory: number;
  readonly passes: number;
  readonly version: 0x13;
  readonly secretValue: Uint8Array | undefined;
  readonly associatedData: Uint8Array | undefined;
  readonly byteLength: number;
}

export type CryptoDerivationParameters =
  | CryptoAgreementParameters
  | CryptoHkdfParameters
  | CryptoPbkdf2Parameters
  | CryptoArgon2Parameters;

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
 * Verification distinguishes an invalid-signature false result from a reported
 * native failure. The shared caller alone selects observable errors and their order.
 */
export interface CryptoProvider extends CryptoDigestProvider {
  /** One whole-message cSHAKE call; SHAKE-equivalent empty N/S stays native too. */
  digestXof(parameters: CryptoCshakeParameters, bytes: Uint8Array): Uint8Array | CryptoFailure;

  /**
   * Shared code validates the original DER's structure, exact consumption, OIDs,
   * versions and parameter presence before calling this method. Native parsers can
   * accept trailing bytes or normalize AlgorithmIdentifier parameters, so successful
   * native import is not evidence that the original encoding meets the specification.
   * Components have already been decoded from JWK and checked by shared code.
   * Report the actual type, curve, modulus and exponent in info. Mathematical
   * decoding must not strengthen the API's import requirements: in particular,
   * OKP public imports retain the supplied encoded point without imposing an
   * on-curve, canonical-encoding or small-order test. ML-KEM public imports also
   * preserve the supplied encoded key: FIPS 203's encapsulation-key check belongs
   * to encapsulation. Verification/agreement/encapsulation apply the requested
   * cryptographic operation's rules when the key is used. Shared
   * code is responsible for any format-specific public/private consistency check.
   */
  importKey(input: CryptoKeyImport): CryptoKeyRecord | CryptoFailure;

  /**
   * Shared code selects the permitted format and checks extractability first.
   * DER output uses the standard key's SPKI/PKCS #8 structures, never encrypted
   * PKCS #8, PEM, native structs or a provider-specific algorithm identifier.
   * Modern Algorithms §8.4.5: ML-DSA raw export returns public-key bytes, and
   * raw-seed returns the original private seed. Its PKCS #8 export must use
   * RFC 9881's seed-only [0] IMPLICIT OCTET STRING, never expandedKey or both.
   */
  exportKey(key: CryptoKeyHandle, format: "raw" | "raw-seed" | "spki" | "pkcs8"): Uint8Array | CryptoFailure;

  /**
   * Derive a public handle from a private handle without exporting secret bytes.
   * The returned record has actual public metadata and an independently owned
   * handle. No Web Crypto usage or extractability policy crosses this boundary.
   */
  getPublicKey(key: CryptoKeyHandle): CryptoKeyRecord | CryptoFailure;

  /** Return decoded components; the shared layer constructs and validates JWK. */
  exportComponents(key: CryptoKeyHandle): CryptoKeyComponents | CryptoFailure;

  generateKeyPair(parameters: CryptoKeyPairGeneration): CryptoKeyPairRecord | CryptoFailure;

  /** CBC input is already padded; AEAD returns its tag separately, others use null. */
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
  ): boolean | CryptoFailure;

  /**
   * FIPS 203 §7.2: check the encoded encapsulation key and perform ML-KEM.Encaps
   * using native secure randomness. Return both complete outputs in one call.
   * An invalid key or native failure is a failure value, never partial output.
   */
  encapsulate(parameters: CryptoKemParameters, key: CryptoKeyHandle): CryptoEncapsulation | CryptoFailure;

  /**
   * FIPS 203 §7.3: check the decapsulation input and perform ML-KEM.Decaps in one
   * native call. Implicit rejection is part of this primitive: a correctly sized
   * altered ciphertext normally yields the complete 32-byte rejection secret,
   * not an authentication error. Input-check or native failures return a value.
   */
  decapsulate(parameters: CryptoKemParameters, key: CryptoKeyHandle, ciphertext: Uint8Array): Uint8Array | CryptoFailure;

  /**
   * Agreement returns the complete fixed-width secret; shared code applies the
   * requested bit length and X25519/X448's all-zero rule. It must do that comparison
   * without data-dependent early exit. KDF requests specify the complete byte count;
   * shared code validates their bit-length/iteration rules before the single call.
   */
  derive(parameters: CryptoDerivationParameters, key: CryptoKeyHandle): Uint8Array | CryptoFailure;
}
