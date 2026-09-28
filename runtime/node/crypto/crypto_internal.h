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

/* Work for the thread pool: runs off the loop thread, and on success leaves
 * `*out` (malloc'd, owned by the job from then on) and `*length`. A failure
 * leaves its cause on the calling thread's OpenSSL queue. */
typedef bool (*NtsCryptoWork)(void *state, unsigned char **out, size_t *length);

/* `crypto.c`'s job queue, for the other translation units' jobs. `done` is a
 * program closure `(ok: boolean, bytes: Uint8Array) => void`. */
struct NtsHeader;
void nts_crypto_queue_work(NtsCryptoWork work, void (*dispose)(void *state), void *state,
                           struct NtsHeader *done);

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

/* `keys.c`'s handles: the key a handle names, or NULL. */
struct evp_pkey_st *nts_crypto_key_at(double handle);

#endif
