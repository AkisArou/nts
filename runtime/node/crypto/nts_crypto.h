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

/* FIPS mode: whether OpenSSL's default properties ask for FIPS, and setting
 * them. False from `set` is a failure whose cause is on the error record. */
bool nts_crypto_fips_enabled(void);
bool nts_crypto_set_fips(bool enable);

/* `OPENSSL_VERSION_NUMBER` of the library this process linked. */
double nts_crypto_openssl_version_number(void);

#endif
