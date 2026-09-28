/* `node:crypto`'s signatures: node's `src/crypto/crypto_sig.cc` -- `Sign`,
 * `Verify` and `SignJob` -- with the ncrypto helpers they call, over OpenSSL
 * 3's `EVP_PKEY`.
 *
 * The stream classes are a hash whose last step is a key operation: `crypto.c`
 * keeps the context, and `nts_crypto_hash_take` hands this file the digest to
 * sign with `EVP_PKEY_sign`, as node's `Node_SignFinal` does. The one-shot
 * functions sign the data itself with `EVP_DigestSign`, on the loop thread or
 * as a pool job through `crypto.c`'s queue.
 *
 * The checks node makes in JavaScript, and the order it makes them in, are the
 * TypeScript's (`src/sig.ts`); so are the signature-format conversions'
 * placement, because node converts at different moments in the stream and the
 * one-shot paths, and a malformed signature throws in one and verifies false in
 * the other. */
#include <math.h>
#include <openssl/core_names.h>
#include <openssl/ec.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/rsa.h>
#include <stdlib.h>
#include <string.h>
#include "crypto_internal.h"
#include "nts_crypto.h"
#include "shared.h"

/* Mirrored as `SignStatus` in `src/sig.ts`. */
enum {
    kSignOk = 0,
    kSignInit = -1,
    kSignPrivateKey = -2,
    kSignContextUnsupported = -3,
};

/* Mirrored as `VerifyResult` in `src/sig.ts`. */
enum { kVerifyFalse = 0, kVerifyTrue = 1, kVerifyPublicKey = -1 };

static double last_status;

double nts_crypto_sign_status(void) { return last_status; }

/* ------------------------------------------------------------ the key kinds */

static bool is_rsa_variant(EVP_PKEY *pkey) {
    int id = EVP_PKEY_get_base_id(pkey);
    return id == EVP_PKEY_RSA || id == EVP_PKEY_RSA2 || id == EVP_PKEY_RSA_PSS;
}

/* ncrypto's `isOneShotVariant`: a key that signs the message, not a digest of
 * it, and so cannot finish a stream. */
static bool is_one_shot_variant(EVP_PKEY *pkey) {
    switch (nts_crypto_key_id(pkey)) {
    case EVP_PKEY_ED25519:
    case EVP_PKEY_ED448:
    case EVP_PKEY_ML_DSA_44:
    case EVP_PKEY_ML_DSA_65:
    case EVP_PKEY_ML_DSA_87: return true;
    default: return false;
    }
}

bool nts_crypto_key_is_one_shot(double key) {
    EVP_PKEY *pkey = nts_crypto_key_at(key);
    return pkey != NULL && is_one_shot_variant(pkey);
}

static int bits_of(EVP_PKEY *pkey, const char *param) {
    BIGNUM *value = NULL;
    if (EVP_PKEY_get_bn_param(pkey, param, &value) != 1) return 0;
    int bits = BN_num_bits(value);
    BN_free(value);
    return bits;
}

/* ncrypto's `getBytesOfRS`: the width of each of a DSA or ECDSA signature's
 * two integers, which are reduced modulo the group order -- `q` for DSA, the
 * curve's order for EC (which is what `EVP_PKEY_get_bits` reports for an EC
 * key). 0 for a key that makes no such signature. */
double nts_crypto_key_dsa_size(double key) {
    EVP_PKEY *pkey = nts_crypto_key_at(key);
    if (pkey == NULL) return 0;
    int bits;
    switch (EVP_PKEY_get_base_id(pkey)) {
    case EVP_PKEY_DSA: bits = bits_of(pkey, OSSL_PKEY_PARAM_FFC_Q); break;
    case EVP_PKEY_EC: bits = EVP_PKEY_get_bits(pkey); break;
    default: return 0;
    }
    return (double)((bits + 7) / 8);
}

/* ncrypto's `validateDsaParameters`: in FIPS mode, a DSA key must have one of
 * FIPS 186-4's four (L, N) sizes. */
static bool dsa_parameters_valid(EVP_PKEY *pkey) {
    if (EVP_default_properties_is_fips_enabled(NULL) != 1) return true;
    if (EVP_PKEY_get_base_id(pkey) != EVP_PKEY_DSA) return true;
    int l = bits_of(pkey, OSSL_PKEY_PARAM_FFC_P);
    int n = bits_of(pkey, OSSL_PKEY_PARAM_FFC_Q);
    return (l == 1024 && n == 160) || (l == 2048 && n == 224) || (l == 2048 && n == 256) ||
           (l == 3072 && n == 256);
}

/* ncrypto's `getDefaultSignPadding`. */
static int default_padding(EVP_PKEY *pkey) {
    return EVP_PKEY_get_base_id(pkey) == EVP_PKEY_RSA_PSS ? RSA_PKCS1_PSS_PADDING
                                                          : RSA_PKCS1_PADDING;
}

/* Node's `ApplyRSAOptions` over ncrypto's `setRsaPadding`. A NaN salt length
 * is "not given", which leaves OpenSSL's default. */
static bool apply_rsa_options(EVP_PKEY *pkey, EVP_PKEY_CTX *ctx, int padding, double salt_length) {
    if (!is_rsa_variant(pkey)) return true;
    if (EVP_PKEY_CTX_set_rsa_padding(ctx, padding) <= 0) return false;
    if (padding == RSA_PKCS1_PSS_PADDING && !isnan(salt_length)) {
        return EVP_PKEY_CTX_set_rsa_pss_saltlen(ctx, (int)salt_length) > 0;
    }
    return true;
}

/* ------------------------------------------------- the signature encodings */

/* Node's `ConvertSignatureToP1363` over ncrypto's `extractP1363`: a DER
 * `SEQUENCE { r, s }` as `r || s`, each padded to `size` bytes. NULL for
 * bytes that do not parse, or an integer wider than `size`. */
NtsView *nts_crypto_signature_to_p1363(double size, NtsView *der) {
    size_t n = (size_t)size;
    const unsigned char *p = nts_view_bytes(der);
    ECDSA_SIG *sig = d2i_ECDSA_SIG(NULL, &p, (long)nts_view_byte_length(der));
    if (sig == NULL) return NULL;
    unsigned char *out = calloc(2 * n, 1);
    bool ok = out != NULL && BN_bn2binpad(ECDSA_SIG_get0_r(sig), out, (int)n) > 0 &&
              BN_bn2binpad(ECDSA_SIG_get0_s(sig), out + n, (int)n) > 0;
    ECDSA_SIG_free(sig);
    NtsView *result = ok ? nts_view_from_bytes(out, (double)(2 * n)) : NULL;
    free(out);
    return result;
}

/* Node's `ConvertSignatureToDER`: the reverse. NULL when the bytes are not
 * exactly two integers' width. */
NtsView *nts_crypto_signature_to_der(double size, NtsView *p1363) {
    size_t n = (size_t)size;
    if ((size_t)nts_view_byte_length(p1363) != 2 * n) return NULL;
    const unsigned char *bytes = nts_view_bytes(p1363);
    ECDSA_SIG *sig = ECDSA_SIG_new();
    BIGNUM *r = BN_bin2bn(bytes, (int)n, NULL);
    BIGNUM *s = BN_bin2bn(bytes + n, (int)n, NULL);
    if (sig == NULL || r == NULL || s == NULL || ECDSA_SIG_set0(sig, r, s) != 1) {
        ECDSA_SIG_free(sig);
        BN_free(r);
        BN_free(s);
        return NULL;
    }
    unsigned char *der = NULL;
    int length = i2d_ECDSA_SIG(sig, &der);
    ECDSA_SIG_free(sig);
    NtsView *result = length > 0 ? nts_view_from_bytes(der, (double)length) : NULL;
    OPENSSL_free(der);
    return result;
}

/* ------------------------------------------------------ Sign and Verify */

/* `SignBase::Init`: a context for the stream's digest, which
 * `nts_crypto_update` feeds and `nts_crypto_sign_final` or
 * `nts_crypto_verify_final` finishes. 0 is a failure on the error record. */
double nts_crypto_sign_init(double digest) { return nts_crypto_hash_new(digest, -1); }

/* Node's `Sign::SignFinal`, after the TypeScript has refused a one-shot key and
 * a finished stream: the digest so far, signed with `EVP_PKEY_sign` under the
 * stream's digest. The hash context is consumed either way. NULL is node's
 * `Error::PrivateKey`, whose cause is on the error record. */
NtsView *nts_crypto_sign_final(double hash, double key, double padding, double salt_length) {
    ERR_clear_error();
    EVP_PKEY *pkey = nts_crypto_key_at(key);
    size_t length = 0;
    const EVP_MD *md = NULL;
    unsigned char *digest = nts_crypto_hash_take(hash, &length, &md);
    if (pkey == NULL || digest == NULL || !dsa_parameters_valid(pkey)) {
        free(digest);
        nts_crypto_record_failure();
        return NULL;
    }
    int pad = isnan(padding) ? default_padding(pkey) : (int)padding;
    size_t size = (size_t)EVP_PKEY_get_size(pkey);
    unsigned char *sig = malloc(size == 0 ? 1 : size);
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new(pkey, NULL);
    bool ok = sig != NULL && ctx != NULL && EVP_PKEY_sign_init(ctx) > 0 &&
              apply_rsa_options(pkey, ctx, pad, salt_length) &&
              EVP_PKEY_CTX_set_signature_md(ctx, md) == 1 &&
              EVP_PKEY_sign(ctx, sig, &size, digest, length) == 1;
    EVP_PKEY_CTX_free(ctx);
    free(digest);
    NtsView *result = ok ? nts_view_from_bytes(sig, (double)size) : NULL;
    if (!ok) nts_crypto_record_failure();
    free(sig);
    return result;
}

/* Node's `Verify::VerifyFinal`, given a DER signature: a `VerifyResult`. A key
 * that cannot verify at all is `kVerifyPublicKey`; any other refusal along
 * the way is a signature that does not verify. */
double nts_crypto_verify_final(double hash, double key, NtsView *signature, double padding,
                               double salt_length) {
    ERR_clear_error();
    EVP_PKEY *pkey = nts_crypto_key_at(key);
    size_t length = 0;
    const EVP_MD *md = NULL;
    unsigned char *digest = nts_crypto_hash_take(hash, &length, &md);
    if (pkey == NULL || digest == NULL) {
        free(digest);
        nts_crypto_record_failure();
        return kVerifyPublicKey;
    }
    int pad = isnan(padding) ? default_padding(pkey) : (int)padding;
    double result = kVerifyFalse;
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new(pkey, NULL);
    if (ctx != NULL) {
        int init = EVP_PKEY_verify_init(ctx);
        if (init == -2) {
            result = kVerifyPublicKey;
            nts_crypto_record_failure();
        } else if (init > 0 && apply_rsa_options(pkey, ctx, pad, salt_length) &&
                   EVP_PKEY_CTX_set_signature_md(ctx, md) == 1 &&
                   EVP_PKEY_verify(ctx, nts_view_bytes(signature),
                                   (size_t)nts_view_byte_length(signature), digest, length) == 1) {
            result = kVerifyTrue;
        }
    }
    EVP_PKEY_CTX_free(ctx);
    free(digest);
    /* Node's `ClearErrorOnReturn`: a signature that does not verify leaves
     * nothing behind for the next failure to report. */
    ERR_clear_error();
    return result;
}

/* ------------------------------------------------------------- SignJob */

/* Ed25519 has cofactor 8, so the first eight entries are the full canonical
 * small-order subgroup: the identity, one point of order 2, two of order 4 and
 * four of order 8. The rest are non-canonical encodings of the same points. */
static const unsigned char ed25519_small_order[][32] = {
    {0x01},
    {0xec, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
     0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f},
    {[31] = 0x80},
    {0},
    {0xc7, 0x17, 0x6a, 0x70, 0x3d, 0x4d, 0xd8, 0x4f, 0xba, 0x3c, 0x0b, 0x76, 0x0d, 0x10, 0x67, 0x0f,
     0x2a, 0x20, 0x53, 0xfa, 0x2c, 0x39, 0xcc, 0xc6, 0x4e, 0xc7, 0xfd, 0x77, 0x92, 0xac, 0x03, 0x7a},
    {0xc7, 0x17, 0x6a, 0x70, 0x3d, 0x4d, 0xd8, 0x4f, 0xba, 0x3c, 0x0b, 0x76, 0x0d, 0x10, 0x67, 0x0f,
     0x2a, 0x20, 0x53, 0xfa, 0x2c, 0x39, 0xcc, 0xc6, 0x4e, 0xc7, 0xfd, 0x77, 0x92, 0xac, 0x03, 0xfa},
    {0x26, 0xe8, 0x95, 0x8f, 0xc2, 0xb2, 0x27, 0xb0, 0x45, 0xc3, 0xf4, 0x89, 0xf2, 0xef, 0x98, 0xf0,
     0xd5, 0xdf, 0xac, 0x05, 0xd3, 0xc6, 0x33, 0x39, 0xb1, 0x38, 0x02, 0x88, 0x6d, 0x53, 0xfc, 0x05},
    {0x26, 0xe8, 0x95, 0x8f, 0xc2, 0xb2, 0x27, 0xb0, 0x45, 0xc3, 0xf4, 0x89, 0xf2, 0xef, 0x98, 0xf0,
     0xd5, 0xdf, 0xac, 0x05, 0xd3, 0xc6, 0x33, 0x39, 0xb1, 0x38, 0x02, 0x88, 0x6d, 0x53, 0xfc, 0x85},
    {0x01, [31] = 0x80},
    {0xec, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
     0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff},
    {0xee, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
     0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f},
    {0xee, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
     0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff},
    {0xed, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
     0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff},
    {0xed, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
     0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f},
};

/* Ed448 has cofactor 4: the identity, one point of order 2 and two of order
 * 4. */
static const unsigned char ed448_small_order[][57] = {
    {0x01},
    {0xfe, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
     0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe, 0xff,
     0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
     0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x00},
    {0},
    {[56] = 0x80},
};

static bool contains_point(const unsigned char *candidate, const void *points, size_t count,
                           size_t size) {
    for (size_t i = 0; i < count; i++) {
        if (memcmp(candidate, (const unsigned char *)points + i * size, size) == 0) return true;
    }
    return false;
}

static bool is_small_order_point(int id, const unsigned char *candidate, size_t size) {
    switch (id) {
    case EVP_PKEY_ED25519:
        return size == 32 && contains_point(candidate, ed25519_small_order,
                                            sizeof(ed25519_small_order) / 32, 32);
    case EVP_PKEY_ED448:
        return size == 57 &&
               contains_point(candidate, ed448_small_order, sizeof(ed448_small_order) / 57, 57);
    default: return false;
    }
}

/* Node's `HasSmallOrderEdDsaPoint`: a signature whose `R`, or a key whose
 * point, is of small order verifies nothing, whatever OpenSSL says -- such a
 * signature can be valid for many messages at once. */
static bool has_small_order_point(EVP_PKEY *pkey, const unsigned char *signature, size_t size) {
    int id = EVP_PKEY_get_base_id(pkey);
    size_t point_size = id == EVP_PKEY_ED25519 ? 32 : id == EVP_PKEY_ED448 ? 57 : 0;
    if (point_size == 0 || size != point_size * 2) return false;
    if (is_small_order_point(id, signature, point_size)) return true;
    unsigned char raw[57];
    size_t raw_size = point_size;
    if (EVP_PKEY_get_raw_public_key(pkey, raw, &raw_size) != 1) return false;
    return is_small_order_point(id, raw, raw_size);
}

/* Node's `SupportsContextString`: Ed25519, Ed448 and ML-DSA take one. */
static bool supports_context_string(EVP_PKEY *pkey) {
    switch (nts_crypto_key_id(pkey)) {
    case EVP_PKEY_ED25519:
    case EVP_PKEY_ED448:
    case EVP_PKEY_ML_DSA_44:
    case EVP_PKEY_ML_DSA_65:
    case EVP_PKEY_ML_DSA_87: return true;
    default: return false;
    }
}

/* A `SignConfiguration`, its inputs copied: a job's run on the pool thread
 * outlives the call that made it. */
typedef struct {
    bool verify;
    EVP_PKEY *pkey;
    const EVP_MD *md;
    unsigned char *data;
    size_t data_length;
    unsigned char *signature;
    size_t signature_length;
    unsigned char *context;
    size_t context_length;
    int padding;
    double salt_length;
    int failure;
    unsigned char *out;
    size_t out_length;
} SignJob;

static unsigned char *copy_bytes(NtsView *view, size_t *length) {
    *length = view == NULL ? 0 : (size_t)nts_view_byte_length(view);
    unsigned char *copy = malloc(*length == 0 ? 1 : *length);
    if (copy != NULL && *length > 0) memcpy(copy, nts_view_bytes(view), *length);
    return copy;
}

static void sign_job_dispose(void *state) {
    SignJob *job = state;
    free(job->data);
    free(job->signature);
    free(job->context);
    free(job->out);
    free(job);
}

/* `EVP_DigestSign` and `EVP_DigestVerify` do the update and the final in one,
 * which is ncrypto's `signOneShot` and `verify`; its `sign` for the other keys
 * takes two steps to the same bytes. */
static bool sign_job_sign(EVP_MD_CTX *ctx, SignJob *job) {
    size_t size = 0;
    if (EVP_DigestSign(ctx, NULL, &size, job->data, job->data_length) != 1) return false;
    unsigned char *sig = malloc(size == 0 ? 1 : size);
    if (sig == NULL) return false;
    if (EVP_DigestSign(ctx, sig, &size, job->data, job->data_length) != 1) {
        free(sig);
        return false;
    }
    job->out = sig;
    job->out_length = size;
    return true;
}

/* Node's `SignTraits::DeriveBits`. A verification's answer is a byte, as
 * node's is, so that both modes deliver through the one job. `failure` says
 * which of node's errors a synchronous caller throws. */
static bool sign_job_run(void *state) {
    SignJob *job = state;
    bool has_context = job->context_length > 0;
    if (has_context && !supports_context_string(job->pkey)) {
        job->failure = kSignContextUnsupported;
        return false;
    }
    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    if (ctx == NULL) {
        job->failure = kSignInit;
        return false;
    }
    EVP_PKEY_CTX *pctx = NULL;
    OSSL_PARAM params[] = {
        OSSL_PARAM_construct_octet_string(OSSL_SIGNATURE_PARAM_CONTEXT_STRING, job->context,
                                          job->context_length),
        OSSL_PARAM_construct_end(),
    };
    int init;
    if (has_context) {
        /* ncrypto's `signInitWithContext`: the parameters reach the key's
         * provider only through the `_ex` initialisers, which name the
         * digest rather than take it. */
        const char *md = job->md == NULL ? NULL : EVP_MD_get0_name(job->md);
        init = job->verify
                   ? EVP_DigestVerifyInit_ex(ctx, &pctx, md, NULL, NULL, job->pkey, params)
                   : EVP_DigestSignInit_ex(ctx, &pctx, md, NULL, NULL, job->pkey, params);
    } else {
        init = job->verify ? EVP_DigestVerifyInit(ctx, &pctx, job->md, NULL, job->pkey)
                           : EVP_DigestSignInit(ctx, &pctx, job->md, NULL, job->pkey);
    }
    bool ok = false;
    if (init != 1) {
        job->failure = kSignInit;
    } else if (!apply_rsa_options(job->pkey, pctx, job->padding, job->salt_length)) {
        job->failure = kSignPrivateKey;
    } else if (job->verify) {
        unsigned char *answer = malloc(1);
        if (answer != NULL) {
            *answer = EVP_DigestVerify(ctx, job->signature, job->signature_length, job->data,
                                       job->data_length) == 1 &&
                      !has_small_order_point(job->pkey, job->signature, job->signature_length);
            job->out = answer;
            job->out_length = 1;
            ok = true;
            /* `ClearErrorOnReturn`: a signature that does not verify is an
             * answer, not a failure with a cause. */
            ERR_clear_error();
        }
    } else {
        ok = sign_job_sign(ctx, job);
        if (!ok) job->failure = kSignPrivateKey;
    }
    EVP_MD_CTX_free(ctx);
    return ok;
}

/* Node's `SignTraits::AdditionalConfig`, after the TypeScript's checks: a
 * padding that is not a `uint32` is not given (the job reads it with
 * `IsUint32`, where the stream reads it with `IsInt32`), and neither is a NaN
 * salt length. `digest` -1 is none, for the keys that choose their own. */
static SignJob *sign_job_new(bool verify, double key, NtsView *data, double digest,
                             double salt_length, double padding, NtsView *context,
                             NtsView *signature) {
    EVP_PKEY *pkey = nts_crypto_key_at(key);
    if (pkey == NULL) return NULL;
    SignJob *job = calloc(1, sizeof(SignJob));
    if (job == NULL) return NULL;
    job->verify = verify;
    job->pkey = pkey;
    job->md = digest < 0 ? NULL : nts_crypto_digest_at(digest);
    job->salt_length = salt_length;
    job->padding = !isnan(padding) && padding >= 0 ? (int)padding : default_padding(pkey);
    job->data = copy_bytes(data, &job->data_length);
    job->context = copy_bytes(context, &job->context_length);
    job->signature = copy_bytes(signature, &job->signature_length);
    if (job->data == NULL || job->context == NULL || job->signature == NULL) {
        sign_job_dispose(job);
        return NULL;
    }
    return job;
}

/* A `SignJob` in `kCryptoJobSync` mode: the signature, or a verification's
 * byte; NULL with `nts_crypto_sign_status` saying which error to throw. */
NtsView *nts_crypto_sign_job_sync(bool verify, double key, NtsView *data, double digest,
                                  double salt_length, double padding, NtsView *context,
                                  NtsView *signature) {
    ERR_clear_error();
    last_status = kSignOk;
    SignJob *job =
        sign_job_new(verify, key, data, digest, salt_length, padding, context, signature);
    if (job == NULL) {
        last_status = kSignInit;
        return NULL;
    }
    NtsView *result = NULL;
    if (sign_job_run(job)) {
        result = nts_view_from_bytes(job->out, (double)job->out_length);
    } else {
        last_status = job->failure;
        nts_crypto_record_failure();
    }
    sign_job_dispose(job);
    return result;
}

static void sign_job_deliver(void *state, bool ok, NtsHeader *done) {
    SignJob *job = state;
    nts_crypto_deliver_bytes(done, ok, job->out, job->out_length);
}

static const NtsCryptoWork sign_work = {sign_job_run, sign_job_deliver, sign_job_dispose};

/* The same in `kCryptoJobAsync` mode, delivered to `done(ok, bytes)`. */
void nts_crypto_sign_job(bool verify, double key, NtsView *data, double digest,
                         double salt_length, double padding, NtsView *context, NtsView *signature,
                         NtsHeader *done) {
    SignJob *job =
        sign_job_new(verify, key, data, digest, salt_length, padding, context, signature);
    if (job == NULL) return;
    nts_crypto_queue_work(&sign_work, job, done);
}
