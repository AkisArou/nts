/* `node:crypto`'s Argon2: `argon2` and `argon2Sync`, node's `Argon2Job`
 * (`src/crypto/crypto_argon2.cc`) over ncrypto's `argon2`, which is OpenSSL
 * 3.2's `ARGON2D`, `ARGON2I` and `ARGON2ID` key derivations.
 *
 * As ncrypto does, each derivation fetches its KDF in a library context of
 * its own: Argon2 runs its lanes on threads, which OpenSSL allows per context,
 * and a private context keeps concurrent derivations from contending for the
 * default one. */
#include <openssl/core_names.h>
#include <openssl/crypto.h>
#include <openssl/err.h>
#include <openssl/kdf.h>
#include <openssl/params.h>
#include <openssl/thread.h>
#include <stdlib.h>
#include <string.h>
#include "crypto_internal.h"
#include "nts_crypto.h"
#include "shared.h"

/* Mirrored as `Argon2Type` in `src/kdf.ts`. */
static const char *const algorithms[] = {"ARGON2D", "ARGON2I", "ARGON2ID"};

/* Whether this OpenSSL has Argon2 at all -- node decides the same at build
 * time, by version, and then publishes no job. */
bool nts_crypto_argon2_supported(void) {
    ERR_set_mark();
    EVP_KDF *kdf = EVP_KDF_fetch(NULL, "ARGON2ID", NULL);
    EVP_KDF_free(kdf);
    ERR_pop_to_mark();
    return kdf != NULL;
}

/* A derivation's inputs, copied: a job outlives the call that made it. */
typedef struct {
    int type;
    unsigned char *inputs[4];
    size_t lengths[4];
    uint32_t lanes;
    uint32_t memcost;
    uint32_t iter;
    size_t keylen;
    unsigned char *out;
} Argon2Job;

enum { kPass = 0, kSalt = 1, kSecret = 2, kAd = 3 };

static void argon2_dispose(void *state) {
    Argon2Job *job = state;
    for (int i = 0; i < 4; i++) {
        OPENSSL_cleanse(job->inputs[i], job->lengths[i]);
        free(job->inputs[i]);
    }
    free(job->out);
    free(job);
}

static Argon2Job *argon2_new(double type, NtsView *pass, NtsView *salt, double lanes, double keylen,
                             double memcost, double iter, NtsView *secret, NtsView *ad) {
    Argon2Job *job = calloc(1, sizeof(Argon2Job));
    if (job == NULL) return NULL;
    NtsView *views[4] = {pass, salt, secret, ad};
    for (int i = 0; i < 4; i++) {
        size_t length = (size_t)nts_view_byte_length(views[i]);
        job->inputs[i] = malloc(length == 0 ? 1 : length);
        job->lengths[i] = length;
        if (job->inputs[i] == NULL) {
            argon2_dispose(job);
            return NULL;
        }
        if (length > 0) memcpy(job->inputs[i], nts_view_bytes(views[i]), length);
    }
    job->type = (int)type;
    job->lanes = (uint32_t)lanes;
    job->keylen = (size_t)keylen;
    job->memcost = (uint32_t)memcost;
    job->iter = (uint32_t)iter;
    return job;
}

/* ncrypto's `argon2`. A tag of no length is no derivation, and succeeds. */
static bool argon2_run(void *state) {
    Argon2Job *job = state;
    job->out = malloc(job->keylen == 0 ? 1 : job->keylen);
    if (job->out == NULL) return false;
    if (job->keylen == 0) return true;
    if (job->type < 0 || job->type > 2) return false;
    OSSL_LIB_CTX *libctx = OSSL_LIB_CTX_new();
    EVP_KDF *kdf = NULL;
    EVP_KDF_CTX *kctx = NULL;
    bool ok = libctx != NULL && (job->lanes <= 1 || OSSL_set_max_threads(libctx, job->lanes) == 1);
    if (ok) kdf = EVP_KDF_fetch(libctx, algorithms[job->type], NULL);
    if (kdf != NULL) kctx = EVP_KDF_CTX_new(kdf);
    ok = ok && kctx != NULL;
    if (ok) {
        OSSL_PARAM params[9];
        size_t n = 0;
        params[n++] = OSSL_PARAM_construct_octet_string(OSSL_KDF_PARAM_PASSWORD, job->inputs[kPass],
                                                        job->lengths[kPass]);
        params[n++] = OSSL_PARAM_construct_octet_string(OSSL_KDF_PARAM_SALT, job->inputs[kSalt],
                                                        job->lengths[kSalt]);
        params[n++] = OSSL_PARAM_construct_uint32(OSSL_KDF_PARAM_THREADS, &job->lanes);
        params[n++] = OSSL_PARAM_construct_uint32(OSSL_KDF_PARAM_ARGON2_LANES, &job->lanes);
        params[n++] = OSSL_PARAM_construct_uint32(OSSL_KDF_PARAM_ARGON2_MEMCOST, &job->memcost);
        params[n++] = OSSL_PARAM_construct_uint32(OSSL_KDF_PARAM_ITER, &job->iter);
        if (job->lengths[kSecret] > 0) {
            params[n++] = OSSL_PARAM_construct_octet_string(OSSL_KDF_PARAM_SECRET, job->inputs[kSecret],
                                                            job->lengths[kSecret]);
        }
        if (job->lengths[kAd] > 0) {
            params[n++] = OSSL_PARAM_construct_octet_string(OSSL_KDF_PARAM_ARGON2_AD, job->inputs[kAd],
                                                            job->lengths[kAd]);
        }
        params[n] = OSSL_PARAM_construct_end();
        ok = EVP_KDF_derive(kctx, job->out, job->keylen, params) == 1;
    }
    EVP_KDF_CTX_free(kctx);
    EVP_KDF_free(kdf);
    OSSL_LIB_CTX_free(libctx);
    return ok;
}

/* `argon2Sync`: the tag, or NULL with the cause on the error record. */
NtsView *nts_crypto_argon2(double type, NtsView *pass, NtsView *salt, double lanes, double keylen,
                           double memcost, double iter, NtsView *secret, NtsView *ad) {
    ERR_clear_error();
    Argon2Job *job = argon2_new(type, pass, salt, lanes, keylen, memcost, iter, secret, ad);
    NtsView *result = job != NULL && argon2_run(job) ? nts_view_from_bytes(job->out, (double)job->keylen) : NULL;
    if (result == NULL) nts_crypto_record_failure();
    if (job != NULL) argon2_dispose(job);
    return result;
}

static void argon2_deliver(void *state, bool ok, NtsHeader *done) {
    Argon2Job *job = state;
    nts_crypto_deliver_bytes(done, ok, job->out, job->keylen);
}

static const NtsCryptoWork argon2_work = {argon2_run, argon2_deliver, argon2_dispose};

/* `argon2`, delivered to `done(ok, bytes)`. */
void nts_crypto_argon2_job(double type, NtsView *pass, NtsView *salt, double lanes, double keylen,
                           double memcost, double iter, NtsView *secret, NtsView *ad, NtsHeader *done) {
    Argon2Job *job = argon2_new(type, pass, salt, lanes, keylen, memcost, iter, secret, ad);
    if (job != NULL) nts_crypto_queue_work(&argon2_work, job, done);
}
