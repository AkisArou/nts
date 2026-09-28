/* `node:crypto`'s key-pair generation: node's `KeyPairGenTraits` over each
 * family's `AdditionalConfig` and `Setup` -- `crypto_rsa.cc`, `crypto_dsa.cc`,
 * `crypto_ec.cc`, `crypto_dh.cc` and `crypto_keygen.cc`'s NID keys -- ending in
 * `EVP_PKEY_keygen`.
 *
 * A generation is configured on the loop thread, as node configures its job
 * in the constructor: each `nts_crypto_keygen_<family>` answers a job's
 * handle, and `nts_crypto_keygen_run` or `nts_crypto_keygen_queue` generates
 * it, inline or on the thread pool. Parameter generation -- DSA's and DH's,
 * which can take seconds -- is part of the generation, as node's `Setup`
 * makes it part of the job. The key is entered in `keys.c`'s table on the loop
 * thread, where that table lives. */
#include <openssl/bn.h>
#include <openssl/core_names.h>
#include <openssl/dh.h>
#include <openssl/dsa.h>
#include <openssl/ec.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/objects.h>
#include <openssl/param_build.h>
#include <openssl/rsa.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include "crypto_internal.h"
#include "nts_crypto.h"
#include "shared.h"

typedef enum { FAMILY_RSA, FAMILY_DSA, FAMILY_EC, FAMILY_NID, FAMILY_DH } Family;

/* A job's configuration, and on success its key. */
typedef struct {
    Family family;
    bool pss;
    int bits;
    int divisor_bits;
    uint32_t exponent;
    const EVP_MD *md;
    const EVP_MD *mgf1_md;
    int salt_length;
    int nid;
    int param_encoding;
    BIGNUM *prime;
    int generator;
    EVP_PKEY *pkey;
} Keygen;

static void keygen_free(void *state) {
    Keygen *keygen = state;
    if (keygen == NULL) return;
    BN_free(keygen->prime);
    EVP_PKEY_free(keygen->pkey);
    free(keygen);
}

/* ------------------------------------------------------------- the jobs */

/* Configured jobs by handle, until one is run. */
static Keygen **jobs;
static size_t job_capacity;

static double job_claim(Keygen *keygen) {
    if (keygen == NULL) return 0;
    size_t index = 0;
    while (index < job_capacity && jobs[index] != NULL) index++;
    if (index == job_capacity) {
        size_t grown = job_capacity == 0 ? 4 : job_capacity * 2;
        Keygen **moved = realloc(jobs, grown * sizeof(Keygen *));
        if (moved == NULL) {
            keygen_free(keygen);
            return 0;
        }
        memset(moved + job_capacity, 0, (grown - job_capacity) * sizeof(Keygen *));
        jobs = moved;
        job_capacity = grown;
    }
    jobs[index] = keygen;
    return (double)(index + 1);
}

/* The job a handle names, which the caller now owns. */
static Keygen *job_take(double handle) {
    if (handle < 1 || handle > (double)job_capacity) return NULL;
    Keygen *keygen = jobs[(size_t)handle - 1];
    jobs[(size_t)handle - 1] = NULL;
    return keygen;
}

static Keygen *keygen_new(Family family) {
    Keygen *keygen = calloc(1, sizeof(Keygen));
    if (keygen != NULL) keygen->family = family;
    return keygen;
}

/* `RsaKeyGenTraits::AdditionalConfig`, after the TypeScript has refused an
 * unknown digest by name. Digest ids of -1 are none; a salt length of -1 is
 * not given. */
double nts_crypto_keygen_rsa(bool pss, double bits, double exponent, double digest,
                             double mgf1_digest, double salt_length) {
    Keygen *keygen = keygen_new(FAMILY_RSA);
    if (keygen == NULL) return 0;
    keygen->pss = pss;
    keygen->bits = (int)bits;
    keygen->exponent = (uint32_t)exponent;
    keygen->md = digest < 0 ? NULL : nts_crypto_digest_at(digest);
    keygen->mgf1_md = mgf1_digest < 0 ? NULL : nts_crypto_digest_at(mgf1_digest);
    keygen->salt_length = (int)salt_length;
    return job_claim(keygen);
}

/* `DsaKeyGenTraits::AdditionalConfig`: a divisor length of -1 is OpenSSL's
 * choice. */
double nts_crypto_keygen_dsa(double bits, double divisor_bits) {
    Keygen *keygen = keygen_new(FAMILY_DSA);
    if (keygen == NULL) return 0;
    keygen->bits = (int)bits;
    keygen->divisor_bits = (int)divisor_bits;
    return job_claim(keygen);
}

/* `EcKeyGenTraits::AdditionalConfig`: 0 for a curve OpenSSL does not know,
 * which the TypeScript has already asked about. */
double nts_crypto_keygen_ec(NtsString *curve, bool explicit_parameters) {
    size_t length = 0;
    char *name = nts_node_to_utf8_alloc(curve, &length);
    int nid = name == NULL ? NID_undef : nts_crypto_curve_nid(name);
    free(name);
    if (nid == NID_undef) return 0;
    Keygen *keygen = keygen_new(FAMILY_EC);
    if (keygen == NULL) return 0;
    keygen->nid = nid;
    keygen->param_encoding = explicit_parameters ? OPENSSL_EC_EXPLICIT_CURVE : OPENSSL_EC_NAMED_CURVE;
    return job_claim(keygen);
}

/* Node's `nidOnlyKeyPairs`: the key types a name alone configures. */
static const struct {
    const char *name;
    int nid;
} nid_types[] = {
    {"ed25519", EVP_PKEY_ED25519},
    {"ed448", EVP_PKEY_ED448},
    {"x25519", EVP_PKEY_X25519},
    {"x448", EVP_PKEY_X448},
    {"ml-dsa-44", NID_ML_DSA_44},
    {"ml-dsa-65", NID_ML_DSA_65},
    {"ml-dsa-87", NID_ML_DSA_87},
    {"ml-kem-512", NID_ML_KEM_512},
    {"ml-kem-768", NID_ML_KEM_768},
    {"ml-kem-1024", NID_ML_KEM_1024},
    {"slh-dsa-sha2-128f", NID_SLH_DSA_SHA2_128f},
    {"slh-dsa-sha2-128s", NID_SLH_DSA_SHA2_128s},
    {"slh-dsa-sha2-192f", NID_SLH_DSA_SHA2_192f},
    {"slh-dsa-sha2-192s", NID_SLH_DSA_SHA2_192s},
    {"slh-dsa-sha2-256f", NID_SLH_DSA_SHA2_256f},
    {"slh-dsa-sha2-256s", NID_SLH_DSA_SHA2_256s},
    {"slh-dsa-shake-128f", NID_SLH_DSA_SHAKE_128f},
    {"slh-dsa-shake-128s", NID_SLH_DSA_SHAKE_128s},
    {"slh-dsa-shake-192f", NID_SLH_DSA_SHAKE_192f},
    {"slh-dsa-shake-192s", NID_SLH_DSA_SHAKE_192s},
    {"slh-dsa-shake-256f", NID_SLH_DSA_SHAKE_256f},
    {"slh-dsa-shake-256s", NID_SLH_DSA_SHAKE_256s},
};

/* A job for one of `nid_types`, by node's name for it; 0 for any other name,
 * which node refuses as not a supported key type. */
double nts_crypto_keygen_nid(NtsString *type) {
    size_t length = 0;
    char *name = nts_node_to_utf8_alloc(type, &length);
    int nid = NID_undef;
    for (size_t i = 0; name != NULL && i < sizeof(nid_types) / sizeof(nid_types[0]); i++) {
        if (strcmp(name, nid_types[i].name) == 0) nid = nid_types[i].nid;
    }
    free(name);
    if (nid == NID_undef) return 0;
    Keygen *keygen = keygen_new(FAMILY_NID);
    if (keygen == NULL) return 0;
    keygen->nid = nid;
    return job_claim(keygen);
}

/* ncrypto's `DHPointer::FindGroup`: RFC 2409's and RFC 3526's MODP groups,
 * by name in any case. */
static BIGNUM *dh_group(const char *name) {
    static const struct {
        const char *name;
        BIGNUM *(*prime)(BIGNUM *);
    } groups[] = {
        {"modp1", BN_get_rfc2409_prime_768},   {"modp2", BN_get_rfc2409_prime_1024},
        {"modp5", BN_get_rfc3526_prime_1536},  {"modp14", BN_get_rfc3526_prime_2048},
        {"modp15", BN_get_rfc3526_prime_3072}, {"modp16", BN_get_rfc3526_prime_4096},
        {"modp17", BN_get_rfc3526_prime_6144}, {"modp18", BN_get_rfc3526_prime_8192},
    };
    for (size_t i = 0; i < sizeof(groups) / sizeof(groups[0]); i++) {
        if (strcasecmp(name, groups[i].name) == 0) return groups[i].prime(NULL);
    }
    return NULL;
}

/* `DhKeyGenTraits::AdditionalConfig` for a named group, whose generator is
 * 2; 0 for a name that is not one. */
double nts_crypto_keygen_dh_group(NtsString *group) {
    size_t length = 0;
    char *name = nts_node_to_utf8_alloc(group, &length);
    BIGNUM *prime = name == NULL ? NULL : dh_group(name);
    free(name);
    if (prime == NULL) return 0;
    Keygen *keygen = keygen_new(FAMILY_DH);
    if (keygen == NULL) {
        BN_free(prime);
        return 0;
    }
    keygen->prime = prime;
    keygen->generator = 2;
    return job_claim(keygen);
}

/* The same for a prime given as big-endian bytes. */
double nts_crypto_keygen_dh_prime(NtsView *prime, double generator) {
    Keygen *keygen = keygen_new(FAMILY_DH);
    if (keygen == NULL) return 0;
    keygen->prime = BN_bin2bn(nts_view_bytes(prime), (int)nts_view_byte_length(prime), NULL);
    keygen->generator = (int)generator;
    if (keygen->prime == NULL) {
        keygen_free(keygen);
        return 0;
    }
    return job_claim(keygen);
}

/* The same for a prime of a size, which the generation finds. */
double nts_crypto_keygen_dh_size(double bits, double generator) {
    Keygen *keygen = keygen_new(FAMILY_DH);
    if (keygen == NULL) return 0;
    keygen->bits = (int)bits;
    keygen->generator = (int)generator;
    return job_claim(keygen);
}

/* A configured job that will not run: node's is collected with its object
 * when a check after configuration throws. */
void nts_crypto_keygen_release(double job) { keygen_free(job_take(job)); }

/* ------------------------------------------------------ the generation */

/* A key context from parameters generated first: DSA's, EC's and a DH prime
 * of a size. */
static EVP_PKEY_CTX *context_from_parameters(EVP_PKEY_CTX *param_ctx) {
    EVP_PKEY *parameters = NULL;
    EVP_PKEY_CTX *ctx = NULL;
    if (EVP_PKEY_paramgen(param_ctx, &parameters) == 1) ctx = EVP_PKEY_CTX_new(parameters, NULL);
    EVP_PKEY_free(parameters);
    EVP_PKEY_CTX_free(param_ctx);
    return ctx;
}

static EVP_PKEY_CTX *rsa_setup(Keygen *keygen) {
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new_id(keygen->pss ? EVP_PKEY_RSA_PSS : EVP_PKEY_RSA, NULL);
    bool ok = ctx != NULL && EVP_PKEY_keygen_init(ctx) == 1 &&
              EVP_PKEY_CTX_set_rsa_keygen_bits(ctx, keygen->bits) == 1;
    /* 0x10001 is OpenSSL's default already. */
    if (ok && keygen->exponent != RSA_F4) {
        BIGNUM *exponent = BN_new();
        ok = exponent != NULL && BN_set_word(exponent, keygen->exponent) == 1 &&
             EVP_PKEY_CTX_set1_rsa_keygen_pubexp(ctx, exponent) == 1;
        BN_free(exponent);
    }
    if (ok && keygen->pss) {
        const EVP_MD *md = keygen->md;
        /* Node's comment: OpenSSL 3 does not default MGF1's digest to the
         * message digest, as RFC 8017 recommends, so node does. */
        const EVP_MD *mgf1_md = keygen->mgf1_md != NULL ? keygen->mgf1_md : md;
        int salt_length = keygen->salt_length;
        if (salt_length < 0 && md != NULL) salt_length = EVP_MD_get_size(md);
        ok = (md == NULL || EVP_PKEY_CTX_set_rsa_pss_keygen_md(ctx, md) > 0) &&
             (mgf1_md == NULL || EVP_PKEY_CTX_set_rsa_pss_keygen_mgf1_md(ctx, mgf1_md) > 0) &&
             (salt_length < 0 || EVP_PKEY_CTX_set_rsa_pss_keygen_saltlen(ctx, salt_length) > 0);
    }
    if (ok) return ctx;
    EVP_PKEY_CTX_free(ctx);
    return NULL;
}

static EVP_PKEY_CTX *dsa_setup(Keygen *keygen) {
    EVP_PKEY_CTX *param_ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_DSA, NULL);
    bool ok = param_ctx != NULL && EVP_PKEY_paramgen_init(param_ctx) == 1 &&
              EVP_PKEY_CTX_set_dsa_paramgen_bits(param_ctx, keygen->bits) == 1 &&
              (keygen->divisor_bits == -1 ||
               EVP_PKEY_CTX_set_dsa_paramgen_q_bits(param_ctx, keygen->divisor_bits) == 1);
    if (ok) return context_from_parameters(param_ctx);
    EVP_PKEY_CTX_free(param_ctx);
    return NULL;
}

/* ncrypto's `setEcParameters` in its OpenSSL 3 form: the group by short name
 * and the encoding by name, as provider parameters. */
static bool set_ec_parameters(EVP_PKEY_CTX *ctx, int nid, int param_encoding) {
    const char *group = OBJ_nid2sn(nid);
    const char *encoding = param_encoding == OPENSSL_EC_EXPLICIT_CURVE ? OSSL_PKEY_EC_ENCODING_EXPLICIT
                                                                       : OSSL_PKEY_EC_ENCODING_GROUP;
    if (group == NULL) return false;
    OSSL_PARAM params[] = {
        OSSL_PARAM_construct_utf8_string(OSSL_PKEY_PARAM_GROUP_NAME, (char *)group, 0),
        OSSL_PARAM_construct_utf8_string(OSSL_PKEY_PARAM_EC_ENCODING, (char *)encoding, 0),
        OSSL_PARAM_construct_end(),
    };
    return EVP_PKEY_CTX_set_params(ctx, params) == 1;
}

static EVP_PKEY_CTX *ec_setup(Keygen *keygen) {
    EVP_PKEY_CTX *param_ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_EC, NULL);
    bool ok = param_ctx != NULL && EVP_PKEY_paramgen_init(param_ctx) == 1 &&
              set_ec_parameters(param_ctx, keygen->nid, keygen->param_encoding);
    if (ok) return context_from_parameters(param_ctx);
    EVP_PKEY_CTX_free(param_ctx);
    return NULL;
}

/* A given prime and generator become key parameters directly; a size is
 * generated to. */
static EVP_PKEY_CTX *dh_setup(Keygen *keygen) {
    if (keygen->prime == NULL) {
        EVP_PKEY_CTX *param_ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_DH, NULL);
        bool ok = param_ctx != NULL && EVP_PKEY_paramgen_init(param_ctx) == 1 &&
                  EVP_PKEY_CTX_set_dh_paramgen_prime_len(param_ctx, keygen->bits) == 1 &&
                  EVP_PKEY_CTX_set_dh_paramgen_generator(param_ctx, keygen->generator) == 1;
        if (ok) return context_from_parameters(param_ctx);
        EVP_PKEY_CTX_free(param_ctx);
        return NULL;
    }
    OSSL_PARAM_BLD *build = OSSL_PARAM_BLD_new();
    BIGNUM *generator = BN_new();
    OSSL_PARAM *params = NULL;
    if (build != NULL && generator != NULL && BN_set_word(generator, (BN_ULONG)keygen->generator) == 1 &&
        OSSL_PARAM_BLD_push_BN(build, OSSL_PKEY_PARAM_FFC_P, keygen->prime) == 1 &&
        OSSL_PARAM_BLD_push_BN(build, OSSL_PKEY_PARAM_FFC_G, generator) == 1) {
        params = OSSL_PARAM_BLD_to_param(build);
    }
    OSSL_PARAM_BLD_free(build);
    BN_free(generator);
    EVP_PKEY *parameters = NULL;
    EVP_PKEY_CTX *from = params == NULL ? NULL : EVP_PKEY_CTX_new_from_name(NULL, "DH", NULL);
    if (from != NULL && EVP_PKEY_fromdata_init(from) == 1) {
        EVP_PKEY_fromdata(from, &parameters, EVP_PKEY_KEY_PARAMETERS, params);
    }
    EVP_PKEY_CTX_free(from);
    OSSL_PARAM_free(params);
    EVP_PKEY_CTX *ctx = parameters == NULL ? NULL : EVP_PKEY_CTX_new(parameters, NULL);
    EVP_PKEY_free(parameters);
    return ctx;
}

/* `KeyPairGenTraits::DoKeyGen`: the family's `Setup`, then the key. Run off
 * the loop thread for a job; a failure leaves its cause on the queue. */
static bool keygen_run(void *state) {
    Keygen *keygen = state;
    EVP_PKEY_CTX *ctx = NULL;
    switch (keygen->family) {
    case FAMILY_RSA: ctx = rsa_setup(keygen); break;
    case FAMILY_DSA: ctx = dsa_setup(keygen); break;
    case FAMILY_EC: ctx = ec_setup(keygen); break;
    case FAMILY_NID: ctx = EVP_PKEY_CTX_new_id(keygen->nid, NULL); break;
    case FAMILY_DH: ctx = dh_setup(keygen); break;
    }
    /* The families that set their context up for keygen themselves set up
     * nothing else a second init would undo. */
    bool ok = ctx != NULL &&
              (keygen->family == FAMILY_RSA || EVP_PKEY_keygen_init(ctx) == 1) &&
              EVP_PKEY_keygen(ctx, &keygen->pkey) == 1;
    EVP_PKEY_CTX_free(ctx);
    return ok;
}

/* The generated key into `keys.c`'s table, on the loop thread. */
static double keygen_claim(Keygen *keygen) {
    EVP_PKEY *pkey = keygen->pkey;
    keygen->pkey = NULL;
    return nts_crypto_key_claim(pkey);
}

/* A configured job, generated inline: the key's handle, or 0 with the cause on
 * the error record. */
double nts_crypto_keygen_run(double job) {
    ERR_clear_error();
    Keygen *keygen = job_take(job);
    double handle = keygen != NULL && keygen_run(keygen) ? keygen_claim(keygen) : 0;
    if (handle == 0) nts_crypto_record_failure();
    keygen_free(keygen);
    return handle;
}

static void keygen_deliver(void *state, bool ok, NtsHeader *done) {
    double handle = ok ? keygen_claim(state) : 0;
    nts_crypto_deliver_number(done, handle > 0, handle);
}

static const NtsCryptoWork keygen_work = {keygen_run, keygen_deliver, keygen_free};

/* The same on the thread pool, delivered to `done(ok, handle)`. */
void nts_crypto_keygen_queue(double job, NtsHeader *done) {
    Keygen *keygen = job_take(job);
    if (keygen != NULL) nts_crypto_queue_work(&keygen_work, keygen, done);
}
