/* What `crypto.c` shares with the other translation units of `node:crypto`:
 * the error record, which every failing native writes and the TypeScript
 * takes with `nts_crypto_take_errors`. Not part of the ABI -- nothing in
 * `src/native.d.ts` names these. */
#ifndef NTS_NODE_CRYPTO_INTERNAL_H
#define NTS_NODE_CRYPTO_INTERNAL_H

#include <stdbool.h>
#include <stddef.h>

/* Record the calling thread's OpenSSL error queue as the last failure,
 * draining it. Called on the loop thread. */
void nts_crypto_record_failure(void);

/* Work for the thread pool, as another translation unit defines it: `run`
 * off the loop thread, where a failure leaves its cause on that thread's
 * OpenSSL queue; `deliver` on the loop thread, which calls the program's
 * `done` as its type needs; `dispose` last. */
struct NtsHeader;
typedef struct {
    bool (*run)(void *state);
    void (*deliver)(void *state, bool ok, struct NtsHeader *done);
    void (*dispose)(void *state);
} NtsCryptoWork;

/* `crypto.c`'s job queue, for the other translation units' jobs. */
void nts_crypto_queue_work(const NtsCryptoWork *work, void *state, struct NtsHeader *done);

/* The two shapes of `done` the jobs use: `(ok, bytes)`, the bytes copied into
 * a view the call borrows, and `(ok, value)`. */
void nts_crypto_deliver_bytes(struct NtsHeader *done, bool ok, const unsigned char *bytes,
                              size_t length);
void nts_crypto_deliver_number(struct NtsHeader *done, bool ok, double value);

/* OpenSSL's objects by the ids the TypeScript holds. Declared through their
 * struct tags rather than OpenSSL's headers: `build.sh` includes every header
 * here into the generated program too, and OpenSSL's names do not belong in
 * its namespace. */
struct evp_cipher_st;
struct evp_md_st;
struct evp_pkey_st;

/* `cipher.c`'s registry: the cipher an id names, or NULL. */
const struct evp_cipher_st *nts_crypto_cipher_at(double id);

/* `crypto.c`'s digest registry: the digest an id names, or NULL. */
const struct evp_md_st *nts_crypto_digest_at(double id);

/* Finish a hash context and free it: the digest's bytes (malloc'd, NULL on a
 * failure left on the OpenSSL queue) and the digest that made them. */
unsigned char *nts_crypto_hash_take(double handle, size_t *length, const struct evp_md_st **md);

/* `keys.c`'s handles: the key a handle names, or NULL; and a new handle for a
 * key, which the table then owns (0 when it cannot, and the key is freed).
 * Loop thread only. */
struct evp_pkey_st *nts_crypto_key_at(double handle);
double nts_crypto_key_claim(struct evp_pkey_st *pkey);

/* A key's family as node's `EVPKeyPointer::id` reads it: the base id, or for
 * a post-quantum key, which has none, its family's NID. */
int nts_crypto_key_id(const struct evp_pkey_st *pkey);

/* Node's `Ec::GetCurveIdFromName`: a NIST name, else a short name; `NID_undef`
 * for neither. */
int nts_crypto_curve_nid(const char *name);

#endif
