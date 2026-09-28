/* What `crypto.c` shares with the other translation units of `node:crypto`:
 * the error record, which every failing native writes and the TypeScript
 * takes with `nts_crypto_take_errors`. Not part of the ABI -- nothing in
 * `src/native.d.ts` names these. */
#ifndef NTS_NODE_CRYPTO_INTERNAL_H
#define NTS_NODE_CRYPTO_INTERNAL_H

/* Record the calling thread's OpenSSL error queue as the last failure,
 * draining it. Called on the loop thread. */
void nts_crypto_record_failure(void);

/* OpenSSL's objects by the ids the TypeScript holds. Declared through their
 * struct tags rather than OpenSSL's headers: `build.sh` includes every header
 * here into the generated program too, and OpenSSL's names do not belong in
 * its namespace. */
struct evp_cipher_st;
struct evp_pkey_st;

/* `cipher.c`'s registry: the cipher an id names, or NULL. */
const struct evp_cipher_st *nts_crypto_cipher_at(double id);

/* `keys.c`'s handles: the key a handle names, or NULL. */
struct evp_pkey_st *nts_crypto_key_at(double handle);

#endif
