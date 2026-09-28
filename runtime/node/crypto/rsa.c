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
