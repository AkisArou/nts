/* What `crypto.c` shares with the other translation units of `node:crypto`:
 * the error record, which every failing native writes and the TypeScript
 * takes with `nts_crypto_take_errors`. Not part of the ABI -- nothing in
 * `src/native.d.ts` names these. */
#ifndef NTS_NODE_CRYPTO_INTERNAL_H
#define NTS_NODE_CRYPTO_INTERNAL_H

/* Record the calling thread's OpenSSL error queue as the last failure,
 * draining it. Called on the loop thread. */
void nts_crypto_record_failure(void);

#endif
