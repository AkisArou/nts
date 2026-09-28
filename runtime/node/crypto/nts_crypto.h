/* The native half of `node:crypto`, over OpenSSL 3's libcrypto.
 *
 * The TypeScript owns validation, encodings, streams and every public error.
 * This file owns what only OpenSSL can answer -- which digests exist, the
 * digest, MAC, KDF and random-byte computations themselves -- and the one
 * piece of OpenSSL state a program can observe: its error queue, captured at
 * each failure in the shape node reads it. Every signature mirrors
 * `src/native.d.ts` exactly.
 *
 * # Which OpenSSL
 *
 * The machine's. Node vendors its own under `deps/openssl` and this checkout
 * does not carry that tree, so `process.versions.openssl` and this module can
 * name different releases. Digests, MACs and KDFs are specified functions, so
 * a release difference changes no output here; it can change the set
 * `getHashes()` lists and the wording of an OpenSSL error string.
 *
 * # Contexts are handles, and a handle is freed by its last operation
 *
 * A hash or HMAC in progress is an OpenSSL context behind a number. `final`
 * frees it, and so does `release`, which the TypeScript calls when a context
 * is abandoned in a way it can see -- a copy that failed, a stream destroyed.
 * A `Hash` dropped undigested holds its context until the process exits,
 * because this runtime has no collection hook to free it from: see
 * `nts_on_collected` in `internal/async.c`, which is the gap, stated.
 *
 * # Asynchronous jobs copy their inputs
 *
 * `pbkdf2`, `hkdf`, `scrypt` and `randomFill` without `Sync` run on libuv's
 * thread pool, as node's `CryptoJob`s do. Inputs are copied on the loop thread
 * before the job is queued -- node's `ToCopy` -- because a reference count is
 * not atomic and the program may reuse its buffer meanwhile. The result is
 * handed back, and the callback called, on the loop thread. */
#ifndef NTS_NODE_CRYPTO_H
#define NTS_NODE_CRYPTO_H

#include "nts_runtime.h"

/* The digest registry. An id is an index into a cache of fetched `EVP_MD`s,
 * stable for the process; -1 is a name OpenSSL does not know. */
double nts_crypto_digest_id(NtsString *name);
double nts_crypto_digest_size(double id);
bool nts_crypto_digest_is_xof(double id);
NtsArray *nts_crypto_hash_names(void);

/* Hash and HMAC contexts. 0 is a failure whose cause is on the error record. */
double nts_crypto_hash_new(double id, double xof_length);
double nts_crypto_hash_copy(double handle, double xof_length);
double nts_crypto_hmac_new(double id, NtsView *key);
bool nts_crypto_update(double handle, NtsView *data);
bool nts_crypto_update_utf8(double handle, NtsString *data);
NtsView *nts_crypto_final(double handle);
void nts_crypto_release(double handle);

/* `crypto.hash()`. NULL is a failure whose cause is on the error record. */
NtsView *nts_crypto_digest(double id, NtsView *input, double length);
NtsView *nts_crypto_digest_utf8(double id, NtsString *input, double length);

/* The error record: `[library, reason, code, error...]`, the errors oldest
 * first, and taking it clears it. */
NtsArray *nts_crypto_take_errors(void);

/* Random bytes, from OpenSSL's CSPRNG. */
bool nts_crypto_random_fill(NtsView *target, double offset, double size);
void nts_crypto_random_fill_job(NtsView *target, double offset, double size,
                                NtsHeader *done);

/* Key derivation. The synchronous forms answer NULL on failure. A job calls
 * `done(ok, bytes)` -- `randomFill`'s with `ok` alone -- and a failed one
 * leaves its cause on the error record for `done` to take. */
NtsView *nts_crypto_pbkdf2(NtsView *password, NtsView *salt, double iterations,
                           double length, double id);
void nts_crypto_pbkdf2_job(NtsView *password, NtsView *salt, double iterations,
                           double length, double id, NtsHeader *done);
/* HKDF-Expand's bound: at most 255 blocks of the digest's size. */
bool nts_crypto_hkdf_length_ok(double id, double length);
NtsView *nts_crypto_hkdf(double id, NtsView *key, NtsView *salt, NtsView *info,
                         double length);
void nts_crypto_hkdf_job(double id, NtsView *key, NtsView *salt, NtsView *info,
                         double length, NtsHeader *done);
bool nts_crypto_scrypt_valid(double n, double r, double p, double maxmem);
NtsView *nts_crypto_scrypt(NtsView *password, NtsView *salt, double n,
                           double r, double p, double maxmem, double length);
void nts_crypto_scrypt_job(NtsView *password, NtsView *salt, double n, double r,
                           double p, double maxmem, double length,
                           NtsHeader *done);

bool nts_crypto_timing_safe_equal(NtsView *a, NtsView *b);

/* Symmetric ciphers (`cipher.c`). A negative id is a name OpenSSL does not
 * know; a status is one of `cipher.c`'s, mirrored by `src/cipher.ts`. */
double nts_crypto_cipher_id(NtsString *name);
double nts_crypto_cipher_id_of_nid(double nid);
NtsArray *nts_crypto_cipher_names(void);
NtsString *nts_crypto_cipher_name(double id);
NtsString *nts_crypto_cipher_mode(double id);
NtsArray *nts_crypto_cipher_info(double id, double key_length, double iv_length);
double nts_crypto_cipher_new(double id, bool encrypt, NtsView *key, NtsView *iv, double auth_tag_length);
NtsView *nts_crypto_cipher_update(double handle, NtsView *data);
NtsView *nts_crypto_cipher_update_utf8(double handle, NtsString *data);
NtsView *nts_crypto_cipher_final(double handle);
double nts_crypto_cipher_status(void);
bool nts_crypto_cipher_set_auto_padding(double handle, bool padding);
NtsView *nts_crypto_cipher_auth_tag(double handle);
double nts_crypto_cipher_set_auth_tag(double handle, NtsView *tag);
double nts_crypto_cipher_set_aad(double handle, NtsView *aad, double plaintext_length);
void nts_crypto_cipher_release(double handle);

/* Asymmetric keys (`keys.c`). A handle, or a status mirrored by
 * `src/keys.ts`; formats and encodings are numbered as it numbers them. */
double nts_crypto_key_parse_private(double format, double type, NtsView *data, NtsView *passphrase,
                                    bool has_passphrase);
double nts_crypto_key_parse_public(double format, double type, NtsView *data, NtsView *passphrase,
                                   bool has_passphrase);
double nts_crypto_key_from_jwk_rsa(NtsArray *components, bool private_key);
bool nts_crypto_key_curve_known(NtsString *curve);
NtsArray *nts_crypto_curve_names(void);
double nts_crypto_key_from_jwk_ec(NtsString *curve, NtsView *x, NtsView *y, NtsView *d, bool private_key);
double nts_crypto_key_from_okp(NtsString *curve, NtsView *raw, bool private_key);
double nts_crypto_key_from_raw_ec(NtsString *curve, NtsView *raw, bool private_key);
double nts_crypto_key_from_post_quantum(NtsString *type, NtsView *raw, double form);
double nts_crypto_key_status(void);
NtsString *nts_crypto_key_type(double handle);
NtsArray *nts_crypto_key_details(double handle);
NtsArray *nts_crypto_key_detail_names(double handle);
NtsView *nts_crypto_key_public_exponent(double handle);
bool nts_crypto_key_equals(double a, double b);
NtsView *nts_crypto_key_export_private(double handle, double format, double type, double cipher_id,
                                       NtsView *passphrase);
NtsView *nts_crypto_key_export_public(double handle, double format, double type);
NtsArray *nts_crypto_key_export_jwk(double handle, bool private_key);
NtsView *nts_crypto_key_export_raw(double handle, bool private_key, bool compressed);
NtsView *nts_crypto_key_export_seed(double handle);

/* Signatures (`sig.c`). The stream forms finish a hash context from
 * `nts_crypto_hash_new`; the one-shot forms are node's `SignJob`, whose
 * verification answers a byte. A NaN padding or salt length is "not given";
 * a digest id of -1 is none. Statuses are mirrored by `src/sig.ts`. */
double nts_crypto_sign_init(double digest);
bool nts_crypto_key_is_one_shot(double key);
double nts_crypto_key_dsa_size(double key);
NtsView *nts_crypto_signature_to_p1363(double size, NtsView *der);
NtsView *nts_crypto_signature_to_der(double size, NtsView *p1363);
NtsView *nts_crypto_sign_final(double hash, double key, double padding, double salt_length);
double nts_crypto_verify_final(double hash, double key, NtsView *signature, double padding,
                               double salt_length);
double nts_crypto_sign_status(void);
NtsView *nts_crypto_sign_job_sync(bool verify, double key, NtsView *data, double digest,
                                  double salt_length, double padding, NtsView *context,
                                  NtsView *signature);
void nts_crypto_sign_job(bool verify, double key, NtsView *data, double digest,
                         double salt_length, double padding, NtsView *context, NtsView *signature,
                         NtsHeader *done);

/* RSA encryption (`rsa.c`): an operation, numbered as `src/cipher.ts`
 * numbers them, and the implicit-rejection check before a PKCS#1 v1.5
 * private decryption. A digest id of -1 is none. */
double nts_crypto_rsa_implicit_rejection(double key);
NtsView *nts_crypto_public_key_cipher(double operation, double key, NtsView *data, double padding,
                                      double digest, NtsView *label);

/* Key-pair generation (`keygen.c`): a job configured, then generated inline
 * or on the thread pool. 0 is a job that could not be configured; a digest id
 * of -1 is none, and a salt or divisor length of -1 is not given. */
double nts_crypto_keygen_rsa(bool pss, double bits, double exponent, double digest,
                             double mgf1_digest, double salt_length);
double nts_crypto_keygen_dsa(double bits, double divisor_bits);
double nts_crypto_keygen_ec(NtsString *curve, bool explicit_parameters);
double nts_crypto_keygen_nid(NtsString *type);
double nts_crypto_keygen_dh_group(NtsString *group);
double nts_crypto_keygen_dh_prime(NtsView *prime, double generator);
double nts_crypto_keygen_dh_size(double bits, double generator);
double nts_crypto_keygen_run(double job);
void nts_crypto_keygen_release(double job);
void nts_crypto_keygen_queue(double job, NtsHeader *done);

/* FIPS mode: whether OpenSSL's default properties ask for FIPS, and setting
 * them. False from `set` is a failure whose cause is on the error record. */
bool nts_crypto_fips_enabled(void);
bool nts_crypto_set_fips(bool enable);

/* `OPENSSL_VERSION_NUMBER` of the library this process linked. */
double nts_crypto_openssl_version_number(void);

#endif
