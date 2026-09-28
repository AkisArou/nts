/* `node:crypto`'s RSA encryption: `publicEncrypt`, `privateDecrypt`,
 * `privateEncrypt` and `publicDecrypt` -- node's `PublicKeyCipher` in
 * `src/crypto/crypto_cipher.cc`, with ncrypto's `Cipher::encrypt`, `decrypt`,
 * `sign` and `recover`, over OpenSSL 3's `EVP_PKEY`.
 *
 * The four are one routine with a different pair of OpenSSL calls each: the
 * "private encrypt" of old is `EVP_PKEY_sign` over bytes the caller has
 * already formatted, and "public decrypt" is `EVP_PKEY_verify_recover`. */
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/rsa.h>
#include <stdlib.h>
#include <string.h>
#include "crypto_internal.h"
#include "nts_crypto.h"
#include "shared.h"

/* Mirrored as `RsaOperation` in `src/cipher.ts`. */
enum { kPublicEncrypt = 0, kPrivateDecrypt = 1, kPrivateEncrypt = 2, kPublicDecrypt = 3 };

/* Mirrored as `ImplicitRejection` in `src/cipher.ts`. */
enum { kImplicitRejectionFailed = 0, kImplicitRejectionSupported = 1, kImplicitRejectionUnsupported = -1 };

/* Node's check before a PKCS#1 v1.5 private decryption, which is safe only
 * with OpenSSL 3.2's implicit rejection -- without it the padding check is a
 * Bleichenbacher oracle, and node refuses the padding outright. A probe on a
 * context of its own: the setting does not carry over, OpenSSL's default is
 * on, and a program that turned it off is not overridden. */
double nts_crypto_rsa_implicit_rejection(double key) {
    ERR_clear_error();
    EVP_PKEY *pkey = nts_crypto_key_at(key);
    EVP_PKEY_CTX *ctx = pkey == NULL ? NULL : EVP_PKEY_CTX_new(pkey, NULL);
    if (ctx == NULL || EVP_PKEY_decrypt_init(ctx) != 1) {
        EVP_PKEY_CTX_free(ctx);
        nts_crypto_record_failure();
        return kImplicitRejectionFailed;
    }
    bool supported = EVP_PKEY_CTX_ctrl_str(ctx, "rsa_pkcs1_implicit_rejection", "1") > 0;
    EVP_PKEY_CTX_free(ctx);
    ERR_clear_error();
    return supported ? kImplicitRejectionSupported : kImplicitRejectionUnsupported;
}

typedef int (*CipherInit)(EVP_PKEY_CTX *ctx);
typedef int (*CipherRun)(EVP_PKEY_CTX *ctx, unsigned char *out, size_t *out_length,
                         const unsigned char *in, size_t in_length);

/* ncrypto's `RSA_Cipher`: padding, and for OAEP the digest for both the
 * label hash and MGF1, then the label if there is one. Everything is sized by
 * asking first. */
static NtsView *rsa_cipher(EVP_PKEY *pkey, CipherInit init, CipherRun run, int padding,
                           const EVP_MD *md, NtsView *label, NtsView *data) {
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new(pkey, NULL);
    bool ok = ctx != NULL && init(ctx) > 0 && EVP_PKEY_CTX_set_rsa_padding(ctx, padding) > 0 &&
              (md == NULL || (EVP_PKEY_CTX_set_rsa_oaep_md(ctx, md) > 0 &&
                              EVP_PKEY_CTX_set_rsa_mgf1_md(ctx, md) > 0));
    size_t label_length = (size_t)nts_view_byte_length(label);
    if (ok && label_length > 0) {
        /* `set0` takes ownership of an allocation of OpenSSL's. */
        unsigned char *copy = OPENSSL_memdup(nts_view_bytes(label), label_length);
        ok = copy != NULL && EVP_PKEY_CTX_set0_rsa_oaep_label(ctx, copy, (int)label_length) > 0;
        if (!ok) OPENSSL_free(copy);
    }
    const unsigned char *in = nts_view_bytes(data);
    size_t in_length = (size_t)nts_view_byte_length(data);
    size_t out_length = 0;
    ok = ok && run(ctx, NULL, &out_length, in, in_length) > 0;
    unsigned char *out = ok ? malloc(out_length == 0 ? 1 : out_length) : NULL;
    ok = out != NULL && run(ctx, out, &out_length, in, in_length) > 0;
    EVP_PKEY_CTX_free(ctx);
    NtsView *result = ok ? nts_view_from_bytes(out, (double)out_length) : NULL;
    free(out);
    return result;
}

/* Node's `PublicKeyCipher::Cipher`, after the TypeScript has parsed the key,
 * coerced the padding, made the implicit-rejection check and refused an
 * unknown OAEP digest. `digest` -1 is none, which is SHA-1 for OAEP. NULL is
 * a failure whose cause is on the error record. */
NtsView *nts_crypto_public_key_cipher(double operation, double key, NtsView *data, double padding,
                                      double digest, NtsView *label) {
    ERR_clear_error();
    EVP_PKEY *pkey = nts_crypto_key_at(key);
    const EVP_MD *md = digest < 0 ? NULL : nts_crypto_digest_at(digest);
    /* A `uint32_t` in node, handed on as an `int`. */
    int pad = (int)(uint32_t)padding;
    NtsView *result = NULL;
    if (pkey != NULL) {
        switch ((int)operation) {
        case kPublicEncrypt:
            result = rsa_cipher(pkey, EVP_PKEY_encrypt_init, EVP_PKEY_encrypt, pad, md, label, data);
            break;
        case kPrivateDecrypt:
            result = rsa_cipher(pkey, EVP_PKEY_decrypt_init, EVP_PKEY_decrypt, pad, md, label, data);
            break;
        case kPrivateEncrypt:
            result = rsa_cipher(pkey, EVP_PKEY_sign_init, EVP_PKEY_sign, pad, md, label, data);
            break;
        case kPublicDecrypt:
            result = rsa_cipher(pkey, EVP_PKEY_verify_recover_init, EVP_PKEY_verify_recover, pad, md,
                                label, data);
            break;
        default: break;
        }
    }
    if (result == NULL) nts_crypto_record_failure();
    return result;
}

/* ---------------------------------------------------------- Web Crypto's OAEP */

/* A Web Crypto RSA-OAEP job's key, digest, label and input, and its output. */
typedef struct {
    EVP_PKEY *pkey;
    bool encrypt;
    const EVP_MD *md;
    unsigned char *label;
    size_t label_length;
    unsigned char *in;
    size_t in_length;
    unsigned char *out;
    size_t out_length;
} OaepJob;

static void oaep_dispose(void *state) {
    OaepJob *job = state;
    EVP_PKEY_free(job->pkey);
    free(job->label);
    free(job->in);
    OPENSSL_clear_free(job->out, job->out_length);
    free(job);
}

/* ncrypto's `RSA_Cipher` as node's `RSACipherJob` runs it: OAEP, the key's
 * digest for both the label hash and MGF1, and the label if there is one. */
static bool oaep_run(void *state) {
    OaepJob *job = state;
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new(job->pkey, NULL);
    bool ok = ctx != NULL &&
              (job->encrypt ? EVP_PKEY_encrypt_init(ctx) : EVP_PKEY_decrypt_init(ctx)) > 0 &&
              EVP_PKEY_CTX_set_rsa_padding(ctx, RSA_PKCS1_OAEP_PADDING) > 0 &&
              EVP_PKEY_CTX_set_rsa_oaep_md(ctx, job->md) > 0 && EVP_PKEY_CTX_set_rsa_mgf1_md(ctx, job->md) > 0;
    if (ok && job->label_length > 0) {
        unsigned char *copy = OPENSSL_memdup(job->label, job->label_length);
        ok = copy != NULL && EVP_PKEY_CTX_set0_rsa_oaep_label(ctx, copy, (int)job->label_length) > 0;
        if (!ok) OPENSSL_free(copy);
    }
    size_t length = 0;
    ok = ok && (job->encrypt ? EVP_PKEY_encrypt(ctx, NULL, &length, job->in, job->in_length)
                             : EVP_PKEY_decrypt(ctx, NULL, &length, job->in, job->in_length)) > 0;
    job->out = ok ? malloc(length == 0 ? 1 : length) : NULL;
    ok = ok && job->out != NULL &&
         (job->encrypt ? EVP_PKEY_encrypt(ctx, job->out, &length, job->in, job->in_length)
                       : EVP_PKEY_decrypt(ctx, job->out, &length, job->in, job->in_length)) > 0;
    job->out_length = ok ? length : 0;
    EVP_PKEY_CTX_free(ctx);
    return ok;
}

static void oaep_deliver(void *state, bool ok, NtsHeader *done) {
    OaepJob *job = state;
    nts_crypto_deliver_bytes(done, ok, job->out, job->out_length);
}

static const NtsCryptoWork oaep_work = {oaep_run, oaep_deliver, oaep_dispose};

static unsigned char *copy_bytes(NtsView *view, size_t *length) {
    *length = (size_t)nts_view_byte_length(view);
    unsigned char *copy = malloc(*length == 0 ? 1 : *length);
    if (copy != NULL && *length > 0) memcpy(copy, nts_view_bytes(view), *length);
    return copy;
}

/* Web Crypto's RSA-OAEP `encrypt` or `decrypt` on the thread pool, delivered
 * to `done(ok, bytes)`. */
void nts_crypto_rsa_oaep_job(bool encrypt, double key, double digest, NtsView *label, NtsView *data, NtsHeader *done) {
    EVP_PKEY *pkey = nts_crypto_key_at(key);
    const EVP_MD *md = nts_crypto_digest_at(digest);
    OaepJob *job = pkey == NULL || md == NULL ? NULL : calloc(1, sizeof(OaepJob));
    if (job == NULL) return;
    EVP_PKEY_up_ref(pkey);
    job->pkey = pkey;
    job->encrypt = encrypt;
    job->md = md;
    job->label = copy_bytes(label, &job->label_length);
    job->in = copy_bytes(data, &job->in_length);
    if (job->label == NULL || job->in == NULL) {
        oaep_dispose(job);
        return;
    }
    nts_crypto_queue_work(&oaep_work, job, done);
}
