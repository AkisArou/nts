/**
 * The native crypto ABI.
 *
 * These declarations emit no wrappers. Each name is supplied by
 * `bindings.node.mjs` during the TypeScript oracle run and by `crypto.c` in a
 * compiled profile; `nts_crypto.h` is the contract both keep.
 */

/** The digest registry: -1 for a name OpenSSL does not know. */
/** @ntsAbi managed */
declare function nts_crypto_digest_id(name: string): number;
/** @ntsAbi managed */
declare function nts_crypto_digest_size(id: number): number;
/** @ntsAbi managed */
declare function nts_crypto_digest_is_xof(id: number): boolean;
/** @ntsAbi managed */
declare function nts_crypto_hash_names(): string[];

/** Contexts: 0 is a failure whose cause is on the error record. */
/** @ntsAbi managed */
declare function nts_crypto_hash_new(id: number, xofLength: number): number;
/** @ntsAbi managed */
declare function nts_crypto_hash_copy(handle: number, xofLength: number): number;
/** @ntsAbi managed */
declare function nts_crypto_hmac_new(id: number, key: Uint8Array): number;
/** @ntsAbi managed */
declare function nts_crypto_update(handle: number, data: Uint8Array): boolean;
/** @ntsAbi managed */
declare function nts_crypto_update_utf8(handle: number, data: string): boolean;
/** @ntsAbi managed */
declare function nts_crypto_final(handle: number): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_release(handle: number): void;

/** `crypto.hash()`; null is a failure whose cause is on the error record. */
/** @ntsAbi managed */
declare function nts_crypto_digest(id: number, input: Uint8Array, length: number): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_digest_utf8(id: number, input: string, length: number): Uint8Array | null;

/** `[library, reason, code, error...]`, oldest error first; taking clears it. */
/** @ntsAbi managed */
declare function nts_crypto_take_errors(): string[];

/** @ntsAbi managed */
declare function nts_crypto_random_fill(target: Uint8Array, offset: number, size: number): boolean;
/** @ntsAbi managed */
declare function nts_crypto_random_fill_job(
  target: Uint8Array,
  offset: number,
  size: number,
  done: (ok: boolean) => void,
): void;

/** @ntsAbi managed */
declare function nts_crypto_pbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  length: number,
  id: number,
): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_pbkdf2_job(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  length: number,
  id: number,
  done: (ok: boolean, bytes: Uint8Array) => void,
): void;

/** @ntsAbi managed */
declare function nts_crypto_hkdf_length_ok(id: number, length: number): boolean;
/** @ntsAbi managed */
declare function nts_crypto_hkdf(
  id: number,
  key: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_hkdf_job(
  id: number,
  key: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
  done: (ok: boolean, bytes: Uint8Array) => void,
): void;

/** @ntsAbi managed */
declare function nts_crypto_scrypt_valid(n: number, r: number, p: number, maxmem: number): boolean;
/** @ntsAbi managed */
declare function nts_crypto_scrypt(
  password: Uint8Array,
  salt: Uint8Array,
  n: number,
  r: number,
  p: number,
  maxmem: number,
  length: number,
): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_scrypt_job(
  password: Uint8Array,
  salt: Uint8Array,
  n: number,
  r: number,
  p: number,
  maxmem: number,
  length: number,
  done: (ok: boolean, bytes: Uint8Array) => void,
): void;

/** @ntsAbi managed */
declare function nts_crypto_timing_safe_equal(a: Uint8Array, b: Uint8Array): boolean;

/** @ntsAbi managed */
declare function nts_crypto_openssl_version_number(): number;
/** @ntsAbi managed */
declare function nts_crypto_fips_enabled(): boolean;
/** @ntsAbi managed */
declare function nts_crypto_set_fips(enable: boolean): boolean;

/** Symmetric ciphers: a negative id is an unknown name; statuses are `CipherStatus`. */
/** @ntsAbi managed */
declare function nts_crypto_cipher_id(name: string): number;
/** @ntsAbi managed */
declare function nts_crypto_cipher_id_of_nid(nid: number): number;
/** @ntsAbi managed */
declare function nts_crypto_cipher_names(): string[];
/** @ntsAbi managed */
declare function nts_crypto_cipher_name(id: number): string;
/** @ntsAbi managed */
declare function nts_crypto_cipher_mode(id: number): string;
/** @ntsAbi managed */
declare function nts_crypto_cipher_info(id: number, keyLength: number, ivLength: number): number[];
/** @ntsAbi managed */
declare function nts_crypto_cipher_new(
  id: number,
  encrypt: boolean,
  key: Uint8Array,
  iv: Uint8Array,
  authTagLength: number,
): number;
/** @ntsAbi managed */
declare function nts_crypto_cipher_update(handle: number, data: Uint8Array): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_cipher_update_utf8(handle: number, data: string): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_cipher_final(handle: number): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_cipher_status(): number;
/** @ntsAbi managed */
declare function nts_crypto_cipher_set_auto_padding(handle: number, padding: boolean): boolean;
/** @ntsAbi managed */
declare function nts_crypto_cipher_auth_tag(handle: number): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_cipher_set_auth_tag(handle: number, tag: Uint8Array): number;
/** @ntsAbi managed */
declare function nts_crypto_cipher_set_aad(handle: number, aad: Uint8Array, plaintextLength: number): number;
/** @ntsAbi managed */
declare function nts_crypto_cipher_release(handle: number): void;

/** Asymmetric keys: a handle, or a `KeyStatus`. */
/** @ntsAbi managed */
declare function nts_crypto_key_parse_private(
  format: number,
  type: number,
  data: Uint8Array,
  passphrase: Uint8Array,
  hasPassphrase: boolean,
): number;
/** @ntsAbi managed */
declare function nts_crypto_key_parse_public(
  format: number,
  type: number,
  data: Uint8Array,
  passphrase: Uint8Array,
  hasPassphrase: boolean,
): number;
/** @ntsAbi managed */
declare function nts_crypto_key_from_jwk_rsa(components: Uint8Array[], privateKey: boolean): number;
/** @ntsAbi managed */
declare function nts_crypto_key_curve_known(curve: string): boolean;
/** @ntsAbi managed */
declare function nts_crypto_curve_names(): string[];
/** @ntsAbi managed */
declare function nts_crypto_key_from_jwk_ec(
  curve: string,
  x: Uint8Array,
  y: Uint8Array,
  d: Uint8Array,
  privateKey: boolean,
): number;
/** @ntsAbi managed */
declare function nts_crypto_key_from_okp(curve: string, raw: Uint8Array, privateKey: boolean): number;
/** @ntsAbi managed */
declare function nts_crypto_key_from_raw_ec(curve: string, raw: Uint8Array, privateKey: boolean): number;
/** A post-quantum key from its raw form: 0 public, 1 private, 2 seed. */
/** @ntsAbi managed */
declare function nts_crypto_key_from_post_quantum(type: string, raw: Uint8Array, form: number): number;
/** @ntsAbi managed */
declare function nts_crypto_key_status(): number;
/** @ntsAbi managed */
declare function nts_crypto_key_type(handle: number): string;
/** @ntsAbi managed */
declare function nts_crypto_key_details(handle: number): number[];
/** @ntsAbi managed */
declare function nts_crypto_key_detail_names(handle: number): string[];
/** @ntsAbi managed */
declare function nts_crypto_key_public_exponent(handle: number): Uint8Array;
/** @ntsAbi managed */
declare function nts_crypto_key_equals(a: number, b: number): boolean;
/** @ntsAbi managed */
declare function nts_crypto_key_export_private(
  handle: number,
  format: number,
  type: number,
  cipherId: number,
  passphrase: Uint8Array,
): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_key_export_public(handle: number, format: number, type: number): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_key_export_jwk(handle: number, privateKey: boolean): Uint8Array[];
/** @ntsAbi managed */
declare function nts_crypto_key_export_raw(handle: number, privateKey: boolean, compressed: boolean): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_key_export_seed(handle: number): Uint8Array | null;

/** Signatures: a NaN padding or salt length is "not given"; a digest id of -1 is none. */
/** @ntsAbi managed */
declare function nts_crypto_sign_init(digest: number): number;
/** @ntsAbi managed */
declare function nts_crypto_key_is_one_shot(key: number): boolean;
/** @ntsAbi managed */
declare function nts_crypto_key_dsa_size(key: number): number;
/** @ntsAbi managed */
declare function nts_crypto_signature_to_p1363(size: number, der: Uint8Array): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_signature_to_der(size: number, p1363: Uint8Array): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_sign_final(hash: number, key: number, padding: number, saltLength: number): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_verify_final(
  hash: number,
  key: number,
  signature: Uint8Array,
  padding: number,
  saltLength: number,
): number;
/** @ntsAbi managed */
declare function nts_crypto_sign_status(): number;
/** @ntsAbi managed */
declare function nts_crypto_sign_job_sync(
  verify: boolean,
  key: number,
  data: Uint8Array,
  digest: number,
  saltLength: number,
  padding: number,
  context: Uint8Array,
  signature: Uint8Array,
): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_sign_job(
  verify: boolean,
  key: number,
  data: Uint8Array,
  digest: number,
  saltLength: number,
  padding: number,
  context: Uint8Array,
  signature: Uint8Array,
  done: (ok: boolean, bytes: Uint8Array) => void,
): void;

/** RSA encryption: operations are `RsaOperation`; a digest id of -1 is none. */
/** @ntsAbi managed */
declare function nts_crypto_rsa_implicit_rejection(key: number): number;
/** @ntsAbi managed */
declare function nts_crypto_public_key_cipher(
  operation: number,
  key: number,
  data: Uint8Array,
  padding: number,
  digest: number,
  label: Uint8Array,
): Uint8Array | null;

/** Key-pair generation: a job's handle (0: not configured), then its key's handle. */
/** @ntsAbi managed */
declare function nts_crypto_keygen_rsa(
  pss: boolean,
  bits: number,
  exponent: number,
  digest: number,
  mgf1Digest: number,
  saltLength: number,
): number;
/** @ntsAbi managed */
declare function nts_crypto_keygen_dsa(bits: number, divisorBits: number): number;
/** @ntsAbi managed */
declare function nts_crypto_keygen_ec(curve: string, explicitParameters: boolean): number;
/** @ntsAbi managed */
declare function nts_crypto_keygen_nid(type: string): number;
/** @ntsAbi managed */
declare function nts_crypto_keygen_dh_group(group: string): number;
/** @ntsAbi managed */
declare function nts_crypto_keygen_dh_prime(prime: Uint8Array, generator: number): number;
/** @ntsAbi managed */
declare function nts_crypto_keygen_dh_size(bits: number, generator: number): number;
/** @ntsAbi managed */
declare function nts_crypto_keygen_run(job: number): number;
/** @ntsAbi managed */
declare function nts_crypto_keygen_release(job: number): void;
/** @ntsAbi managed */
declare function nts_crypto_keygen_queue(job: number, done: (ok: boolean, key: number) => void): void;

/** Key agreement: `DiffieHellman` and `ECDH` handles, and the stateless form. */
/** @ntsAbi managed */
declare function nts_crypto_dh_status(): number;
/** @ntsAbi managed */
declare function nts_crypto_dh_new_size(bits: number, generator: number): number;
/** @ntsAbi managed */
declare function nts_crypto_dh_new_prime(prime: Uint8Array, generator: number): number;
/** @ntsAbi managed */
declare function nts_crypto_dh_new_prime_generator(prime: Uint8Array, generator: Uint8Array): number;
/** @ntsAbi managed */
declare function nts_crypto_dh_group(name: string): number;
/** @ntsAbi managed */
declare function nts_crypto_dh_check(handle: number): number;
/** @ntsAbi managed */
declare function nts_crypto_dh_generate_keys(handle: number): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_dh_get(handle: number, which: number): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_dh_set_key(handle: number, key: Uint8Array, privateKey: boolean): boolean;
/** @ntsAbi managed */
declare function nts_crypto_dh_compute_secret(handle: number, key: Uint8Array): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_ecdh_new(curve: string): number;
/** @ntsAbi managed */
declare function nts_crypto_ecdh_generate_keys(handle: number): boolean;
/** @ntsAbi managed */
declare function nts_crypto_ecdh_compute_secret(handle: number, key: Uint8Array): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_ecdh_get_public_key(handle: number, form: number): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_ecdh_get_private_key(handle: number): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_ecdh_set_private_key(handle: number, key: Uint8Array): number;
/** @ntsAbi managed */
declare function nts_crypto_ecdh_set_public_key(handle: number, key: Uint8Array): number;
/** @ntsAbi managed */
declare function nts_crypto_ecdh_convert_key(key: Uint8Array, curve: string, form: number): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_dh_stateless(privateKey: number, publicKey: number): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_dh_stateless_job(
  privateKey: number,
  publicKey: number,
  done: (ok: boolean, secret: Uint8Array) => void,
): void;

/** Primes: `add` and `rem` are given when their flags say so. */
/** @ntsAbi managed */
declare function nts_crypto_prime_options(
  bits: number,
  add: Uint8Array,
  hasAdd: boolean,
  rem: Uint8Array,
  hasRem: boolean,
): number;
/** @ntsAbi managed */
declare function nts_crypto_prime_generate(
  bits: number,
  safe: boolean,
  add: Uint8Array,
  hasAdd: boolean,
  rem: Uint8Array,
  hasRem: boolean,
): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_prime_generate_job(
  bits: number,
  safe: boolean,
  add: Uint8Array,
  hasAdd: boolean,
  rem: Uint8Array,
  hasRem: boolean,
  done: (ok: boolean, prime: Uint8Array) => void,
): void;
/** @ntsAbi managed */
declare function nts_crypto_prime_candidate_ok(candidate: Uint8Array): boolean;
/** @ntsAbi managed */
declare function nts_crypto_prime_check(candidate: Uint8Array, checks: number): number;
/** @ntsAbi managed */
declare function nts_crypto_prime_check_job(
  candidate: Uint8Array,
  checks: number,
  done: (ok: boolean, answer: Uint8Array) => void,
): void;

/** Argon2: types are `Argon2Type`. */
/** @ntsAbi managed */
declare function nts_crypto_argon2_supported(): boolean;
/** @ntsAbi managed */
declare function nts_crypto_argon2(
  type: number,
  pass: Uint8Array,
  salt: Uint8Array,
  lanes: number,
  keylen: number,
  memcost: number,
  iter: number,
  secret: Uint8Array,
  ad: Uint8Array,
): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_argon2_job(
  type: number,
  pass: Uint8Array,
  salt: Uint8Array,
  lanes: number,
  keylen: number,
  memcost: number,
  iter: number,
  secret: Uint8Array,
  ad: Uint8Array,
  done: (ok: boolean, tag: Uint8Array) => void,
): void;

/** Key encapsulation: `[sharedKey, ciphertext]`, empty for a failure. */
/** @ntsAbi managed */
declare function nts_crypto_kem_encapsulate(key: number): Uint8Array[];
/** @ntsAbi managed */
declare function nts_crypto_kem_decapsulate(key: number, ciphertext: Uint8Array): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_kem_encapsulate_job(
  key: number,
  done: (ok: boolean, sharedKey: Uint8Array, ciphertext: Uint8Array) => void,
): void;
/** @ntsAbi managed */
declare function nts_crypto_kem_decapsulate_job(
  key: number,
  ciphertext: Uint8Array,
  done: (ok: boolean, sharedKey: Uint8Array) => void,
): void;

/** SPKAC: null is no SPKAC. */
/** @ntsAbi managed */
declare function nts_crypto_spkac_verify(input: Uint8Array): boolean;
/** @ntsAbi managed */
declare function nts_crypto_spkac_public_key(input: Uint8Array): Uint8Array | null;
/** @ntsAbi managed */
declare function nts_crypto_spkac_challenge(input: Uint8Array): Uint8Array | null;
