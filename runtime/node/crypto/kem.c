/* `node:crypto`'s key encapsulation: `encapsulate` and `decapsulate`, node's
 * `KEMEncapsulateJob` and `KEMDecapsulateJob` (`src/crypto/crypto_kem.cc`) over
 * ncrypto's `KEM`, which is OpenSSL 3.2's `EVP_PKEY_encapsulate`.
 *
 * ML-KEM is a KEM of its own; RSA, EC and X25519/X448 keys become one through
 * the operation OpenSSL names for them, RSASVE and DHKEM, which ncrypto sets
 * before each use. Like ncrypto's, a failure leaves nothing on OpenSSL's queue:
 * node reports its own words for it. */
#include <openssl/core_names.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <stdlib.h>
#include <string.h>
#include "crypto_internal.h"
#include "nts_crypto.h"
#include "shared.h"

/* ncrypto's `SetOperationParameter`: the KEM operation a key's family needs,
 * or none for a family that is a KEM already. */
static bool set_operation(EVP_PKEY_CTX *ctx, EVP_PKEY *pkey) {
    const char *operation = NULL;
    switch (nts_crypto_key_id(pkey)) {
    case EVP_PKEY_RSA: operation = OSSL_KEM_PARAM_OPERATION_RSASVE; break;
    case EVP_PKEY_EC:
    case EVP_PKEY_X25519:
    case EVP_PKEY_X448: operation = OSSL_KEM_PARAM_OPERATION_DHKEM; break;
    default: return true;
    }
    OSSL_PARAM params[] = {
        OSSL_PARAM_construct_utf8_string(OSSL_KEM_PARAM_OPERATION, (char *)operation, 0),
        OSSL_PARAM_construct_end(),
    };
    return EVP_PKEY_CTX_set_params(ctx, params) > 0;
}

/* A job's key, input and answers. The key is referenced for the job's life. */
typedef struct {
    EVP_PKEY *pkey;
    unsigned char *ciphertext;
    size_t ciphertext_length;
    unsigned char *shared_key;
    size_t shared_key_length;
} KemJob;

static void kem_dispose(void *state) {
    KemJob *job = state;
    EVP_PKEY_free(job->pkey);
    free(job->ciphertext);
    OPENSSL_clear_free(job->shared_key, job->shared_key_length);
    free(job);
}

static KemJob *kem_new(double key, NtsView *ciphertext) {
    EVP_PKEY *pkey = nts_crypto_key_at(key);
    KemJob *job = pkey == NULL ? NULL : calloc(1, sizeof(KemJob));
    if (job == NULL) return NULL;
    EVP_PKEY_up_ref(pkey);
    job->pkey = pkey;
    if (ciphertext != NULL) {
        size_t length = (size_t)nts_view_byte_length(ciphertext);
        job->ciphertext = malloc(length == 0 ? 1 : length);
        job->ciphertext_length = length;
        if (job->ciphertext == NULL) {
            kem_dispose(job);
            return NULL;
        }
        if (length > 0) memcpy(job->ciphertext, nts_view_bytes(ciphertext), length);
    }
    return job;
}

/* ncrypto's `KEM::Encapsulate`: both lengths asked first, then both made. */
static bool encapsulate_run(void *state) {
    KemJob *job = state;
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new(job->pkey, NULL);
    bool ok = ctx != NULL && EVP_PKEY_encapsulate_init(ctx, NULL) > 0 && set_operation(ctx, job->pkey) &&
              EVP_PKEY_encapsulate(ctx, NULL, &job->ciphertext_length, NULL, &job->shared_key_length) > 0;
    if (ok) {
        job->ciphertext = malloc(job->ciphertext_length == 0 ? 1 : job->ciphertext_length);
        job->shared_key = malloc(job->shared_key_length == 0 ? 1 : job->shared_key_length);
        ok = job->ciphertext != NULL && job->shared_key != NULL &&
             EVP_PKEY_encapsulate(ctx, job->ciphertext, &job->ciphertext_length, job->shared_key,
                                  &job->shared_key_length) > 0;
    }
    EVP_PKEY_CTX_free(ctx);
    ERR_clear_error();
    return ok;
}

/* ncrypto's `KEM::Decapsulate`. */
static bool decapsulate_run(void *state) {
    KemJob *job = state;
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new(job->pkey, NULL);
    bool ok = ctx != NULL && EVP_PKEY_decapsulate_init(ctx, NULL) > 0 && set_operation(ctx, job->pkey) &&
              EVP_PKEY_decapsulate(ctx, NULL, &job->shared_key_length, job->ciphertext,
                                   job->ciphertext_length) > 0;
    if (ok) {
        job->shared_key = malloc(job->shared_key_length == 0 ? 1 : job->shared_key_length);
        ok = job->shared_key != NULL && EVP_PKEY_decapsulate(ctx, job->shared_key, &job->shared_key_length,
                                                             job->ciphertext, job->ciphertext_length) > 0;
    }
    EVP_PKEY_CTX_free(ctx);
    ERR_clear_error();
    return ok;
}

/* `encapsulate(key)`: `[sharedKey, ciphertext]`, or empty for a failure. */
NtsArray *nts_crypto_kem_encapsulate(double key) {
    KemJob *job = kem_new(key, NULL);
    bool ok = job != NULL && encapsulate_run(job);
    NtsArray *result = nts_array_new(&nts_desc_ref, ok ? 2 : 0);
    if (ok) {
        NtsView **items = NTS_ITEMS(result, NtsView *);
        items[0] = nts_view_from_bytes(job->shared_key, (double)job->shared_key_length);
        items[1] = nts_view_from_bytes(job->ciphertext, (double)job->ciphertext_length);
    }
    if (job != NULL) kem_dispose(job);
    return result;
}

/* `decapsulate(key, ciphertext)`: the shared key, or NULL for a failure. */
NtsView *nts_crypto_kem_decapsulate(double key, NtsView *ciphertext) {
    KemJob *job = kem_new(key, ciphertext);
    NtsView *result = job != NULL && decapsulate_run(job)
                          ? nts_view_from_bytes(job->shared_key, (double)job->shared_key_length)
                          : NULL;
    if (job != NULL) kem_dispose(job);
    return result;
}

static void encapsulate_deliver(void *state, bool ok, NtsHeader *done) {
    KemJob *job = state;
    nts_crypto_deliver_pair(done, ok, job->shared_key, job->shared_key_length, job->ciphertext,
                            job->ciphertext_length);
}

static void decapsulate_deliver(void *state, bool ok, NtsHeader *done) {
    KemJob *job = state;
    nts_crypto_deliver_bytes(done, ok, job->shared_key, job->shared_key_length);
}

static const NtsCryptoWork encapsulate_work = {encapsulate_run, encapsulate_deliver, kem_dispose};
static const NtsCryptoWork decapsulate_work = {decapsulate_run, decapsulate_deliver, kem_dispose};

/* The same on the thread pool: `done(ok, sharedKey, ciphertext)`. */
void nts_crypto_kem_encapsulate_job(double key, NtsHeader *done) {
    KemJob *job = kem_new(key, NULL);
    if (job != NULL) nts_crypto_queue_work(&encapsulate_work, job, done);
}

/* The same on the thread pool: `done(ok, sharedKey)`. */
void nts_crypto_kem_decapsulate_job(double key, NtsView *ciphertext, NtsHeader *done) {
    KemJob *job = kem_new(key, ciphertext);
    if (job != NULL) nts_crypto_queue_work(&decapsulate_work, job, done);
}
