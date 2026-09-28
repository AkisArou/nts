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
