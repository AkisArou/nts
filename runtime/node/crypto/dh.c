/* `node:crypto`'s key agreement: node's `DiffieHellman`, `DiffieHellmanGroup`
 * and `ECDH` classes (`src/crypto/crypto_dh.cc`, `crypto_ec.cc`), and the
 * stateless `diffieHellman()` over two key objects (`DHBitsTraits`).
 *
 * The classes are ncrypto's `DHPointer` and `ECKeyPointer` in the form node
 * builds against OpenSSL 3 (`NCRYPTO_USE_OPENSSL3_PROVIDER`), which touches
 * none of OpenSSL's deprecated `DH` and `EC_KEY` API:
 *
 * - A `DiffieHellmanGroup` holds its MODP prime and generator, and whatever
 *   keys it has, as numbers, beside OpenSSL's name for the group when it has
 *   one; its keys are computed with `BN_mod_exp_mont_consttime`. Any other
 *   `DiffieHellman` is an `EVP_PKEY`, rebuilt from provider parameters when a
 *   key is set.
 * - `verifyError` is ncrypto's `CheckDhParams`, its own port of `DH_check`,
 *   and a named group's is 0.
 * - An `ECDH` holds a group, a point and a scalar, and becomes an `EVP_PKEY`
 *   only to derive or be checked.
 *
 * Like `keys.c`'s keys, an object here is never freed: node's are collected
 * with their JavaScript object, and this runtime has no collection hook. */
#include <openssl/bn.h>
#include <openssl/core_names.h>
#include <openssl/dh.h>
#include <openssl/ec.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/objects.h>
#include <openssl/param_build.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include "crypto_internal.h"
#include "nts_crypto.h"
#include "shared.h"

static double last_status;

double nts_crypto_dh_status(void) { return last_status; }

/* ------------------------------------------------------------ the tables */

typedef struct {
    EVP_PKEY *pkey;
    BIGNUM *p;
    BIGNUM *g;
    BIGNUM *pub;
    BIGNUM *priv;
    const char *group_name;
} Dh;

typedef struct {
    EC_GROUP *group;
    EC_POINT *pub;
    BIGNUM *priv;
} Ecdh;

typedef struct {
    void **items;
    size_t count;
    size_t capacity;
} Table;

static Table dhs;
static Table ecdhs;

static double table_claim(Table *table, void *item) {
    if (item == NULL) return 0;
    if (table->count == table->capacity) {
        size_t grown = table->capacity == 0 ? 16 : table->capacity * 2;
        void **moved = realloc(table->items, grown * sizeof(void *));
        if (moved == NULL) return 0;
        table->items = moved;
        table->capacity = grown;
    }
    table->items[table->count] = item;
    return (double)++table->count;
}

static void *table_at(const Table *table, double handle) {
    if (handle < 1 || handle > (double)table->count) return NULL;
    return table->items[(size_t)handle - 1];
}

static Dh *dh_at(double handle) { return table_at(&dhs, handle); }
static Ecdh *ecdh_at(double handle) { return table_at(&ecdhs, handle); }

/* A BIGNUM's big-endian bytes, as ncrypto's `BignumPointer::Encode`: no
 * padding, and none at all for zero. */
static NtsView *bignum_view(const BIGNUM *value) {
    if (value == NULL) return NULL;
    int size = BN_num_bytes(value);
    unsigned char *bytes = malloc(size == 0 ? 1 : (size_t)size);
    if (bytes == NULL) return NULL;
    BN_bn2bin(value, bytes);
    NtsView *view = nts_view_from_bytes(bytes, (double)size);
    free(bytes);
    return view;
}

static BIGNUM *bignum_of(NtsView *view) {
    return BN_bin2bn(nts_view_bytes(view), (int)nts_view_byte_length(view), NULL);
}

/* ncrypto's `GetOptionalPKeyBnParam`: NULL for a parameter the key lacks. */
static BIGNUM *pkey_bignum(const EVP_PKEY *pkey, const char *name) {
    BIGNUM *value = NULL;
    if (pkey == NULL || EVP_PKEY_get_bn_param(pkey, name, &value) != 1) return NULL;
    return value;
}

/* ncrypto's `NewPKeyFromData`. */
static EVP_PKEY *pkey_from_data(const char *type, int selection, OSSL_PARAM *params) {
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new_from_name(NULL, type, NULL);
    EVP_PKEY *pkey = NULL;
    if (ctx != NULL && EVP_PKEY_fromdata_init(ctx) == 1) EVP_PKEY_fromdata(ctx, &pkey, selection, params);
    EVP_PKEY_CTX_free(ctx);
    return pkey;
}

/* ---------------------------------------------------------- DiffieHellman */

/* Mirrored as `DhStatus` in `src/dh.ts`. */
enum {
    kDhFailed = 0,
    kDhInvalidParameters = -1,
    kDhInvalidPrime = -2,
    kDhBadGenerator = -3,
    kDhBadPrimeLength = -4,
};

/* Node puts these on the queue itself, so its message is OpenSSL's reason. */
static double dh_refuse(int reason, double status) {
    ERR_raise(ERR_LIB_DH, reason);
    nts_crypto_record_failure();
    last_status = status;
    return status;
}

/* ncrypto's `NewDhPKey` over explicit parameters, with the keys given. */
static EVP_PKEY *dh_pkey(const BIGNUM *p, const BIGNUM *g, const BIGNUM *pub, const BIGNUM *priv) {
    if (p == NULL || g == NULL) return NULL;
    OSSL_PARAM_BLD *build = OSSL_PARAM_BLD_new();
    int selection = EVP_PKEY_KEY_PARAMETERS;
    bool ok = build != NULL && OSSL_PARAM_BLD_push_BN(build, OSSL_PKEY_PARAM_FFC_P, p) == 1 &&
              OSSL_PARAM_BLD_push_BN(build, OSSL_PKEY_PARAM_FFC_G, g) == 1;
    if (ok && pub != NULL) {
        ok = OSSL_PARAM_BLD_push_BN(build, OSSL_PKEY_PARAM_PUB_KEY, pub) == 1;
        selection |= EVP_PKEY_PUBLIC_KEY;
    }
    if (ok && priv != NULL) {
        ok = OSSL_PARAM_BLD_push_BN(build, OSSL_PKEY_PARAM_PRIV_KEY, priv) == 1;
        selection |= EVP_PKEY_PRIVATE_KEY;
    }
    OSSL_PARAM *params = ok ? OSSL_PARAM_BLD_to_param(build) : NULL;
    EVP_PKEY *pkey = params == NULL ? NULL : pkey_from_data("DH", selection, params);
    OSSL_PARAM_free(params);
    OSSL_PARAM_BLD_free(build);
    return pkey;
}

/* The same over a named group; with no keys at all, the group's parameters. */
static EVP_PKEY *dh_group_pkey(const char *group_name, const BIGNUM *pub, const BIGNUM *priv) {
    if (group_name == NULL) return NULL;
    if (pub == NULL && priv == NULL) {
        EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new_from_name(NULL, "DH", NULL);
        OSSL_PARAM params[] = {
            OSSL_PARAM_construct_utf8_string(OSSL_PKEY_PARAM_GROUP_NAME, (char *)group_name, 0),
            OSSL_PARAM_construct_end(),
        };
        EVP_PKEY *pkey = NULL;
        if (ctx != NULL && EVP_PKEY_paramgen_init(ctx) == 1 && EVP_PKEY_CTX_set_params(ctx, params) == 1) {
            EVP_PKEY_paramgen(ctx, &pkey);
        }
        EVP_PKEY_CTX_free(ctx);
        return pkey;
    }
    OSSL_PARAM_BLD *build = OSSL_PARAM_BLD_new();
    int selection = EVP_PKEY_KEY_PARAMETERS;
    bool ok = build != NULL && OSSL_PARAM_BLD_push_utf8_string(build, OSSL_PKEY_PARAM_GROUP_NAME, group_name, 0) == 1;
    if (ok && pub != NULL) {
        ok = OSSL_PARAM_BLD_push_BN(build, OSSL_PKEY_PARAM_PUB_KEY, pub) == 1;
        selection |= EVP_PKEY_PUBLIC_KEY;
    }
    if (ok && priv != NULL) {
        ok = OSSL_PARAM_BLD_push_BN(build, OSSL_PKEY_PARAM_PRIV_KEY, priv) == 1;
        selection |= EVP_PKEY_PRIVATE_KEY;
    }
    OSSL_PARAM *params = ok ? OSSL_PARAM_BLD_to_param(build) : NULL;
    EVP_PKEY *pkey = params == NULL ? NULL : pkey_from_data("DH", selection, params);
    OSSL_PARAM_free(params);
    OSSL_PARAM_BLD_free(build);
    return pkey;
}

/* ncrypto's `DHPointer::operator bool`. */
static bool dh_valid(const Dh *dh) { return dh != NULL && (dh->pkey != NULL || (dh->p != NULL && dh->g != NULL)); }

/* The prime and generator, owned by the caller: the group's, or the key's. */
static bool dh_parameters(const Dh *dh, BIGNUM **p, BIGNUM **g) {
    *p = dh->p != NULL ? BN_dup(dh->p) : pkey_bignum(dh->pkey, OSSL_PKEY_PARAM_FFC_P);
    *g = dh->g != NULL ? BN_dup(dh->g) : pkey_bignum(dh->pkey, OSSL_PKEY_PARAM_FFC_G);
    if (*p != NULL && *g != NULL) return true;
    BN_free(*p);
    BN_free(*g);
    *p = *g = NULL;
    return false;
}

static double dh_claim(Dh *dh) {
    double handle = table_claim(&dhs, dh);
    if (handle == 0) {
        EVP_PKEY_free(dh->pkey);
        free(dh);
        last_status = kDhInvalidParameters;
        return kDhInvalidParameters;
    }
    return handle;
}

static double dh_claim_pkey(EVP_PKEY *pkey) {
    Dh *dh = pkey == NULL ? NULL : calloc(1, sizeof(Dh));
    if (dh == NULL) {
        EVP_PKEY_free(pkey);
        last_status = kDhInvalidParameters;
        return kDhInvalidParameters;
    }
    dh->pkey = pkey;
    return dh_claim(dh);
}

/* `new DiffieHellman(bits, generator)`: parameters generated to a size, as
 * ncrypto's `DHPointer::New(bits, generator)` generates them. */
double nts_crypto_dh_new_size(double bits, double generator) {
    ERR_clear_error();
    if (bits < 2) return dh_refuse(DH_R_MODULUS_TOO_SMALL, kDhBadPrimeLength);
    if (generator < 2) return dh_refuse(DH_R_BAD_GENERATOR, kDhBadGenerator);
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_DH, NULL);
    EVP_PKEY *pkey = NULL;
    if (ctx != NULL && EVP_PKEY_paramgen_init(ctx) == 1 &&
        EVP_PKEY_CTX_set_dh_paramgen_prime_len(ctx, (int)bits) == 1 &&
        EVP_PKEY_CTX_set_dh_paramgen_generator(ctx, (int)generator) == 1) {
        EVP_PKEY_paramgen(ctx, &pkey);
    }
    EVP_PKEY_CTX_free(ctx);
    ERR_clear_error();
    return dh_claim_pkey(pkey);
}

/* ncrypto's `DHPointer::New(p, g)`, after node's checks of the generator. */
static double dh_from(BIGNUM *p, BIGNUM *g) {
    /* OpenSSL 3's provider refuses a generator that is not below a prime of
     * any real size, and node refuses it first. */
    if (BN_num_bits(p) >= 512 && BN_cmp(g, p) >= 0) {
        BN_free(p);
        BN_free(g);
        return dh_refuse(DH_R_BAD_GENERATOR, kDhBadGenerator);
    }
    EVP_PKEY *pkey = dh_pkey(p, g, NULL, NULL);
    BN_free(p);
    BN_free(g);
    ERR_clear_error();
    return dh_claim_pkey(pkey);
}

/* `new DiffieHellman(prime, generator)` with a numeric generator. */
double nts_crypto_dh_new_prime(NtsView *prime, double generator) {
    ERR_clear_error();
    BIGNUM *p = bignum_of(prime);
    if (p == NULL) {
        last_status = kDhInvalidPrime;
        return kDhInvalidPrime;
    }
    BIGNUM *g = BN_new();
    if (generator < 2 || g == NULL || BN_set_word(g, (BN_ULONG)generator) != 1) {
        BN_free(p);
        BN_free(g);
        return dh_refuse(DH_R_BAD_GENERATOR, kDhBadGenerator);
    }
    return dh_from(p, g);
}

/* `new DiffieHellman(prime, generator)` with the generator as bytes. */
double nts_crypto_dh_new_prime_generator(NtsView *prime, NtsView *generator) {
    ERR_clear_error();
    BIGNUM *p = bignum_of(prime);
    if (p == NULL) {
        last_status = kDhInvalidPrime;
        return kDhInvalidPrime;
    }
    BIGNUM *g = bignum_of(generator);
    /* ncrypto's `getWord`: a generator of one word, below 2. */
    if (g == NULL || (BN_num_bytes(g) <= (int)sizeof(BN_ULONG) && BN_get_word(g) < 2)) {
        BN_free(p);
        BN_free(g);
        return dh_refuse(DH_R_BAD_GENERATOR, kDhBadGenerator);
    }
    return dh_from(p, g);
}

/* ncrypto's `DHPointer::FindGroup` and `GetOpenSSLDhGroupName`: RFC 2409's
 * and RFC 3526's MODP primes by name in any case, and OpenSSL's name for the
 * ones it has -- all but the two RFC 2409 primes. */
static const struct {
    const char *name;
    BIGNUM *(*prime)(BIGNUM *);
    const char *openssl_name;
    int private_bits;
} modp_groups[] = {
    {"modp1", BN_get_rfc2409_prime_768, NULL, 0},
    {"modp2", BN_get_rfc2409_prime_1024, NULL, 0},
    {"modp5", BN_get_rfc3526_prime_1536, "modp_1536", 200},
    {"modp14", BN_get_rfc3526_prime_2048, "modp_2048", 225},
    {"modp15", BN_get_rfc3526_prime_3072, "modp_3072", 275},
    {"modp16", BN_get_rfc3526_prime_4096, "modp_4096", 325},
    {"modp17", BN_get_rfc3526_prime_6144, "modp_6144", 375},
    {"modp18", BN_get_rfc3526_prime_8192, "modp_8192", 400},
};

/* `DiffieHellmanGroup(name)`: 0 for a name that is no group. */
double nts_crypto_dh_group(NtsString *name) {
    size_t length = 0;
    char *text = nts_node_to_utf8_alloc(name, &length);
    int found = -1;
    for (size_t i = 0; text != NULL && i < sizeof(modp_groups) / sizeof(modp_groups[0]); i++) {
        if (strcasecmp(text, modp_groups[i].name) == 0) found = (int)i;
    }
    free(text);
    if (found < 0) return 0;
    Dh *dh = calloc(1, sizeof(Dh));
    if (dh == NULL) return 0;
    dh->p = modp_groups[found].prime(NULL);
    dh->g = BN_new();
    dh->group_name = modp_groups[found].openssl_name;
    if (dh->p == NULL || dh->g == NULL || BN_set_word(dh->g, 2) != 1) {
        BN_free(dh->p);
        BN_free(dh->g);
        free(dh);
        return 0;
    }
    return dh_claim(dh);
}

/* The private key length OpenSSL uses for a named group, for ncrypto's
 * `GenerateDhPrivateKey`; 0 for none. */
static int group_private_bits(const char *group_name) {
    for (size_t i = 0; group_name != NULL && i < sizeof(modp_groups) / sizeof(modp_groups[0]); i++) {
        if (modp_groups[i].openssl_name != NULL && strcmp(group_name, modp_groups[i].openssl_name) == 0) {
            return modp_groups[i].private_bits;
        }
    }
    return 0;
}

/* ncrypto's `CheckDhParams`, its own port of `DH_check` for OpenSSL 3; -1 for
 * a check that could not run. */
static double check_dh_params(const BIGNUM *p, const BIGNUM *g, const BIGNUM *q, const BIGNUM *j) {
    if (p == NULL || g == NULL) return -1;
    const int p_bits = BN_num_bits(p);
    if (p_bits > OPENSSL_DH_CHECK_MAX_MODULUS_BITS) return -1;
    int codes = 0;
    if (!BN_is_odd(p)) codes |= DH_CHECK_P_NOT_PRIME;
    if (BN_is_negative(g) || BN_is_zero(g) || BN_is_one(g)) codes |= DH_NOT_SUITABLE_GENERATOR;
    if (p_bits < 512) codes |= DH_MODULUS_TOO_SMALL;
    if (p_bits > OPENSSL_DH_MAX_MODULUS_BITS) codes |= DH_MODULUS_TOO_LARGE;
    BN_CTX *ctx = BN_CTX_new();
    BIGNUM *tmp1 = BN_new();
    BIGNUM *tmp2 = BN_new();
    double result = -1;
    if (ctx == NULL || tmp1 == NULL || tmp2 == NULL || BN_copy(tmp1, p) == NULL || BN_sub_word(tmp1, 1) != 1) {
        goto done;
    }
    if (BN_cmp(g, tmp1) >= 0) codes |= DH_NOT_SUITABLE_GENERATOR;
    bool q_good = false;
    if (q != NULL) {
        if (BN_ucmp(p, q) > 0) q_good = true;
        else codes |= DH_CHECK_INVALID_Q_VALUE;
    }
    if (q_good) {
        if (BN_cmp(g, BN_value_one()) <= 0 || BN_cmp(g, p) >= 0) {
            codes |= DH_NOT_SUITABLE_GENERATOR;
        } else if (BN_mod_exp(tmp1, g, q, p, ctx) != 1) {
            goto done;
        } else if (!BN_is_one(tmp1)) {
            codes |= DH_NOT_SUITABLE_GENERATOR;
        }
        const int q_is_prime = BN_check_prime(q, ctx, NULL);
        if (q_is_prime < 0) goto done;
        if (q_is_prime == 0) codes |= DH_CHECK_Q_NOT_PRIME;
        if (BN_div(tmp1, tmp2, p, q, ctx) != 1) goto done;
        if (!BN_is_one(tmp2)) codes |= DH_CHECK_INVALID_Q_VALUE;
        if (j != NULL && BN_cmp(j, tmp1) != 0) codes |= DH_CHECK_INVALID_J_VALUE;
    }
    const int p_is_prime = BN_check_prime(p, ctx, NULL);
    if (p_is_prime < 0) goto done;
    if (p_is_prime == 0) {
        codes |= DH_CHECK_P_NOT_PRIME;
    } else if (q == NULL) {
        if (BN_rshift1(tmp1, p) != 1) goto done;
        const int half_is_prime = BN_check_prime(tmp1, ctx, NULL);
        if (half_is_prime < 0) goto done;
        if (half_is_prime == 0) codes |= DH_CHECK_P_NOT_SAFE_PRIME;
    }
    result = codes;
done:
    BN_free(tmp1);
    BN_free(tmp2);
    BN_CTX_free(ctx);
    return result;
}

/* `verifyError`: ncrypto's `DHPointer::check`, or -1 when the check itself
 * failed. A named group's is 0: node does not revalidate a standard group. */
double nts_crypto_dh_check(double handle) {
    Dh *dh = dh_at(handle);
    if (!dh_valid(dh)) return 0;
    if (dh->group_name != NULL) return 0;
    BIGNUM *p = NULL;
    BIGNUM *g = NULL;
    double result = -1;
    if (dh_parameters(dh, &p, &g)) {
        BIGNUM *q = pkey_bignum(dh->pkey, OSSL_PKEY_PARAM_FFC_Q);
        BIGNUM *j = pkey_bignum(dh->pkey, OSSL_PKEY_PARAM_FFC_COFACTOR);
        result = check_dh_params(p, g, q, j);
        BN_free(q);
        BN_free(j);
    }
    BN_free(p);
    BN_free(g);
    ERR_clear_error();
    return result;
}

/* ncrypto's `GenerateDhPrivateKey`: the group's length of random bits, or a
 * number in [2, p - 2]. */
static BIGNUM *generate_private_key(const BIGNUM *p, const char *group_name) {
    BIGNUM *priv = BN_secure_new();
    if (priv == NULL) return NULL;
    const int bits = group_private_bits(group_name);
    bool ok;
    if (bits > 0) {
        ok = BN_priv_rand(priv, bits, BN_RAND_TOP_ONE, BN_RAND_BOTTOM_ANY) == 1;
    } else {
        BIGNUM *range = BN_dup(p);
        ok = range != NULL && BN_sub_word(range, 3) == 1 && BN_priv_rand_range(priv, range) == 1 &&
             BN_add_word(priv, 2) == 1;
        BN_free(range);
    }
    if (ok) return priv;
    BN_clear_free(priv);
    return NULL;
}

/* ncrypto's `GenerateDhPublicKey`: g^priv mod p, in constant time. */
static BIGNUM *public_key_of(const BIGNUM *p, const BIGNUM *g, const BIGNUM *priv) {
    BIGNUM *pub = BN_new();
    BN_CTX *ctx = BN_CTX_new();
    bool ok = pub != NULL && ctx != NULL && BN_mod_exp_mont_consttime(pub, g, priv, p, ctx, NULL) == 1;
    BN_CTX_free(ctx);
    if (ok) return pub;
    BN_free(pub);
    return NULL;
}

/* ncrypto's `DHPointer::generateKeys`: a key pair, keeping a private key
 * already set and deriving its public half, as node's `generateKeys` after
 * `setPrivateKey` does. */
static bool dh_generate(Dh *dh) {
    if (dh->p != NULL && dh->g != NULL) {
        if (dh->priv == NULL) dh->priv = generate_private_key(dh->p, dh->group_name);
        BIGNUM *pub = dh->priv == NULL ? NULL : public_key_of(dh->p, dh->g, dh->priv);
        if (pub == NULL) return false;
        BN_free(dh->pub);
        dh->pub = pub;
        return true;
    }
    BIGNUM *p = NULL;
    BIGNUM *g = NULL;
    if (!dh_parameters(dh, &p, &g)) return false;
    BIGNUM *priv = pkey_bignum(dh->pkey, OSSL_PKEY_PARAM_PRIV_KEY);
    bool ok = false;
    if (priv != NULL) {
        BIGNUM *pub = public_key_of(p, g, priv);
        BIGNUM *existing = pkey_bignum(dh->pkey, OSSL_PKEY_PARAM_PUB_KEY);
        if (pub != NULL && existing != NULL && BN_cmp(pub, existing) == 0) {
            ok = true;
        } else if (pub != NULL) {
            EVP_PKEY *replacement = dh->group_name != NULL ? dh_group_pkey(dh->group_name, pub, priv)
                                                           : dh_pkey(p, g, pub, priv);
            if (replacement != NULL) {
                EVP_PKEY_free(dh->pkey);
                dh->pkey = replacement;
                ok = true;
            }
        }
        BN_free(pub);
        BN_free(existing);
    } else {
        EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new(dh->pkey, NULL);
        EVP_PKEY *generated = NULL;
        if (ctx != NULL && EVP_PKEY_keygen_init(ctx) == 1 && EVP_PKEY_keygen(ctx, &generated) == 1) {
            EVP_PKEY_free(dh->pkey);
            dh->pkey = generated;
            ok = true;
        }
        EVP_PKEY_CTX_free(ctx);
    }
    BN_clear_free(priv);
    BN_free(p);
    BN_free(g);
    return ok;
}

/* The public key or the private key, owned by the caller; NULL for none yet. */
static BIGNUM *dh_key(const Dh *dh, bool private_key) {
    const BIGNUM *held = private_key ? dh->priv : dh->pub;
    if (held != NULL) return BN_dup(held);
    return pkey_bignum(dh->pkey, private_key ? OSSL_PKEY_PARAM_PRIV_KEY : OSSL_PKEY_PARAM_PUB_KEY);
}

/* `generateKeys()`: the public key, or NULL when generation failed. */
NtsView *nts_crypto_dh_generate_keys(double handle) {
    Dh *dh = dh_at(handle);
    NtsView *result = NULL;
    if (dh_valid(dh) && dh_generate(dh)) {
        BIGNUM *pub = dh_key(dh, false);
        result = bignum_view(pub);
        BN_free(pub);
    }
    ERR_clear_error();
    return result;
}

/* The prime, the generator, the public key or the private key: 0 to 3. NULL
 * for a key not yet generated or set. */
NtsView *nts_crypto_dh_get(double handle, double which) {
    Dh *dh = dh_at(handle);
    if (!dh_valid(dh)) return NULL;
    BIGNUM *value = NULL;
    if (which < 2) {
        BIGNUM *p = NULL;
        BIGNUM *g = NULL;
        if (dh_parameters(dh, &p, &g)) {
            value = which == 0 ? p : g;
            BN_free(which == 0 ? g : p);
        }
    } else {
        value = dh_key(dh, which == 3);
    }
    NtsView *result = bignum_view(value);
    BN_clear_free(value);
    ERR_clear_error();
    return result;
}

/* `setPublicKey` and `setPrivateKey`: a group's key is replaced; a key's is
 * rebuilt around the other half it already has. False for bytes OpenSSL
 * will not take. */
bool nts_crypto_dh_set_key(double handle, NtsView *key, bool private_key) {
    Dh *dh = dh_at(handle);
    BIGNUM *value = bignum_of(key);
    if (!dh_valid(dh) || value == NULL) {
        BN_free(value);
        return false;
    }
    if (dh->p != NULL && dh->g != NULL) {
        BIGNUM **slot = private_key ? &dh->priv : &dh->pub;
        BN_clear_free(*slot);
        *slot = value;
        return true;
    }
    BIGNUM *other = dh_key(dh, !private_key);
    BIGNUM *p = NULL;
    BIGNUM *g = NULL;
    EVP_PKEY *pkey = NULL;
    const BIGNUM *pub = private_key ? other : value;
    const BIGNUM *priv = private_key ? value : other;
    if (dh->group_name != NULL) pkey = dh_group_pkey(dh->group_name, pub, priv);
    else if (dh_parameters(dh, &p, &g)) pkey = dh_pkey(p, g, pub, priv);
    if (pkey != NULL) {
        EVP_PKEY_free(dh->pkey);
        dh->pkey = pkey;
    }
    BN_clear_free(value);
    BN_clear_free(other);
    BN_free(p);
    BN_free(g);
    ERR_clear_error();
    return pkey != NULL;
}

/* Mirrored as `SecretStatus` in `src/dh.ts`. */
enum {
    kSecretCheckFailed = -1,
    kSecretTooSmall = -2,
    kSecretTooLarge = -3,
    kSecretInvalid = -4,
    kSecretFailed = -5,
};

/* ncrypto's `DHPointer::size`: the prime's length in bytes. */
static size_t dh_size(const Dh *dh) {
    if (dh->p != NULL) return (size_t)BN_num_bytes(dh->p);
    const int bits = EVP_PKEY_get_bits(dh->pkey);
    return bits > 0 ? ((size_t)bits + 7) / 8 : 0;
}

/* ncrypto's `DHPointer::checkPublicKey`: range first, then the provider's own
 * check of a peer key made with our parameters. */
static int check_public_key(const Dh *dh, const BIGNUM *peer) {
    BIGNUM *p = NULL;
    BIGNUM *g = NULL;
    if (!dh_parameters(dh, &p, &g)) return kSecretCheckFailed;
    int result = kSecretCheckFailed;
    BIGNUM *p_minus_one = BN_dup(p);
    if (BN_cmp(peer, BN_value_one()) <= 0) {
        result = kSecretTooSmall;
    } else if (p_minus_one == NULL || BN_sub_word(p_minus_one, 1) != 1) {
        result = kSecretCheckFailed;
    } else if (BN_cmp(peer, p_minus_one) >= 0) {
        result = kSecretTooLarge;
    } else if (dh->p != NULL && dh->group_name == NULL) {
        result = 0;
    } else {
        EVP_PKEY *peer_key = dh->group_name != NULL ? dh_group_pkey(dh->group_name, peer, NULL)
                                                    : dh_pkey(p, g, peer, NULL);
        EVP_PKEY_CTX *ctx = peer_key == NULL ? NULL : EVP_PKEY_CTX_new(peer_key, NULL);
        if (ctx != NULL) result = EVP_PKEY_public_check(ctx) == 1 ? 0 : kSecretInvalid;
        EVP_PKEY_CTX_free(ctx);
        EVP_PKEY_free(peer_key);
    }
    BN_free(p_minus_one);
    BN_free(p);
    BN_free(g);
    return result;
}

/* ncrypto's `DHPointer::computeSecret`: a group with a private key computes
 * it directly; a key derives it, padded to the prime's size. */
static NtsView *compute_secret(const Dh *dh, const BIGNUM *peer) {
    size_t size = dh_size(dh);
    if (dh->p != NULL && dh->priv != NULL) {
        BIGNUM *secret = BN_secure_new();
        BN_CTX *ctx = BN_CTX_new();
        unsigned char *out = calloc(size == 0 ? 1 : size, 1);
        NtsView *result = NULL;
        if (secret != NULL && ctx != NULL && out != NULL &&
            BN_mod_exp_mont_consttime(secret, peer, dh->priv, dh->p, ctx, NULL) == 1 &&
            BN_bn2binpad(secret, out, (int)size) >= 0) {
            result = nts_view_from_bytes(out, (double)size);
        }
        free(out);
        BN_CTX_free(ctx);
        BN_clear_free(secret);
        return result;
    }
    if (dh->pkey == NULL) return NULL;
    EVP_PKEY *peer_key = NULL;
    if (dh->group_name != NULL) {
        peer_key = dh_group_pkey(dh->group_name, peer, NULL);
    } else {
        BIGNUM *p = NULL;
        BIGNUM *g = NULL;
        if (dh_parameters(dh, &p, &g)) peer_key = dh_pkey(p, g, peer, NULL);
        BN_free(p);
        BN_free(g);
    }
    EVP_PKEY_CTX *ctx = peer_key == NULL ? NULL : EVP_PKEY_CTX_new(dh->pkey, NULL);
    size_t out_size = size;
    bool sized = ctx != NULL && EVP_PKEY_derive_init(ctx) == 1 && EVP_PKEY_CTX_set_dh_pad(ctx, 1) == 1 &&
                 EVP_PKEY_derive_set_peer(ctx, peer_key) == 1 && EVP_PKEY_derive(ctx, NULL, &out_size) == 1 &&
                 out_size > 0;
    unsigned char *out = sized ? malloc(out_size) : NULL;
    NtsView *result = NULL;
    if (out != NULL && EVP_PKEY_derive(ctx, out, &out_size) == 1) {
        result = nts_view_from_bytes(out, (double)out_size);
    }
    free(out);
    EVP_PKEY_CTX_free(ctx);
    EVP_PKEY_free(peer_key);
    return result;
}

/* `computeSecret(key)`: node's `ComputeSecret`, checking the peer's key and
 * then computing. */
NtsView *nts_crypto_dh_compute_secret(double handle, NtsView *key) {
    Dh *dh = dh_at(handle);
    BIGNUM *peer = bignum_of(key);
    NtsView *result = NULL;
    int check = !dh_valid(dh) || peer == NULL ? kSecretCheckFailed : check_public_key(dh, peer);
    if (check != 0) {
        last_status = check;
    } else {
        result = compute_secret(dh, peer);
        if (result == NULL) last_status = kSecretFailed;
    }
    BN_free(peer);
    ERR_clear_error();
    return result;
}

/* ------------------------------------------------------------------ ECDH */

/* Mirrored as `EcdhStatus` in `src/dh.ts`. */
enum {
    kEcdhFailed = 0,
    kEcdhInvalidCurve = -1,
    kEcdhInvalidKeyPair = -2,
    kEcdhInvalidPublicKey = -3,
    kEcdhNoKey = -4,
    kEcdhInvalidPrivateKey = -5,
};

/* `new ECDH(curve)`: by OpenSSL's short name only, as node takes it. */
double nts_crypto_ecdh_new(NtsString *curve) {
    ERR_set_mark();
    size_t length = 0;
    char *name = nts_node_to_utf8_alloc(curve, &length);
    int nid = name == NULL ? NID_undef : OBJ_sn2nid(name);
    free(name);
    double result = kEcdhInvalidCurve;
    if (nid != NID_undef) {
        Ecdh *ecdh = calloc(1, sizeof(Ecdh));
        if (ecdh != NULL) ecdh->group = EC_GROUP_new_by_curve_name(nid);
        result = ecdh != NULL && ecdh->group != NULL ? table_claim(&ecdhs, ecdh) : kEcdhFailed;
        if (result <= 0 && ecdh != NULL) {
            EC_GROUP_free(ecdh->group);
            free(ecdh);
        }
    }
    ERR_pop_to_mark();
    return result;
}

/* ncrypto's `EVPKeyPointer::set(ECKeyPointer)`: the group by name, the public
 * key (derived from the private key when there is none), and the private
 * key, as provider parameters. */
static EVP_PKEY *ecdh_pkey(const EC_GROUP *group, const EC_POINT *pub, const BIGNUM *priv) {
    const char *group_name = OBJ_nid2sn(EC_GROUP_get_curve_name(group));
    if (group_name == NULL) return NULL;
    OSSL_PARAM_BLD *build = OSSL_PARAM_BLD_new();
    int selection = EVP_PKEY_KEY_PARAMETERS;
    bool ok = build != NULL && OSSL_PARAM_BLD_push_utf8_string(build, OSSL_PKEY_PARAM_GROUP_NAME, group_name, 0) == 1;
    EC_POINT *derived = NULL;
    if (ok && pub == NULL && priv != NULL) {
        derived = EC_POINT_new(group);
        ok = derived != NULL && EC_POINT_mul(group, derived, priv, NULL, NULL, NULL) == 1;
        pub = derived;
    }
    unsigned char *encoded = NULL;
    if (ok && pub != NULL) {
        size_t encoded_length = EC_POINT_point2buf(group, pub, POINT_CONVERSION_UNCOMPRESSED, &encoded, NULL);
        ok = encoded_length > 0 &&
             OSSL_PARAM_BLD_push_octet_string(build, OSSL_PKEY_PARAM_PUB_KEY, encoded, encoded_length) == 1;
        selection |= EVP_PKEY_PUBLIC_KEY;
    }
    if (ok && priv != NULL) {
        ok = OSSL_PARAM_BLD_push_BN(build, OSSL_PKEY_PARAM_PRIV_KEY, priv) == 1;
        selection |= EVP_PKEY_PRIVATE_KEY;
    }
    OSSL_PARAM *params = ok ? OSSL_PARAM_BLD_to_param(build) : NULL;
    EVP_PKEY *pkey = params == NULL ? NULL : pkey_from_data("EC", selection, params);
    OSSL_PARAM_free(params);
    OPENSSL_free(encoded);
    EC_POINT_free(derived);
    OSSL_PARAM_BLD_free(build);
    return pkey;
}

/* ncrypto's `ECKeyPointer::generate`: a key pair from the provider, kept as
 * its scalar and point. */
bool nts_crypto_ecdh_generate_keys(double handle) {
    Ecdh *ecdh = ecdh_at(handle);
    if (ecdh == NULL) return false;
    const char *group_name = OBJ_nid2sn(EC_GROUP_get_curve_name(ecdh->group));
    OSSL_PARAM params[] = {
        OSSL_PARAM_construct_utf8_string(OSSL_PKEY_PARAM_GROUP_NAME, (char *)group_name, 0),
        OSSL_PARAM_construct_utf8_string(OSSL_PKEY_PARAM_EC_ENCODING, OSSL_PKEY_EC_ENCODING_GROUP, 0),
        OSSL_PARAM_construct_end(),
    };
    EVP_PKEY_CTX *ctx = group_name == NULL ? NULL : EVP_PKEY_CTX_new_id(EVP_PKEY_EC, NULL);
    EVP_PKEY *pkey = NULL;
    bool ok = ctx != NULL && EVP_PKEY_keygen_init(ctx) == 1 && EVP_PKEY_CTX_set_params(ctx, params) == 1 &&
              EVP_PKEY_keygen(ctx, &pkey) == 1;
    BIGNUM *priv = ok ? pkey_bignum(pkey, OSSL_PKEY_PARAM_PRIV_KEY) : NULL;
    size_t point_length = 0;
    ok = priv != NULL && EVP_PKEY_get_octet_string_param(pkey, OSSL_PKEY_PARAM_PUB_KEY, NULL, 0, &point_length) == 1;
    unsigned char *point = ok ? malloc(point_length == 0 ? 1 : point_length) : NULL;
    EC_POINT *pub = point != NULL ? EC_POINT_new(ecdh->group) : NULL;
    ok = pub != NULL &&
         EVP_PKEY_get_octet_string_param(pkey, OSSL_PKEY_PARAM_PUB_KEY, point, point_length, &point_length) == 1 &&
         EC_POINT_oct2point(ecdh->group, pub, point, point_length, NULL) == 1;
    free(point);
    if (ok) {
        BN_clear_free(ecdh->priv);
        EC_POINT_free(ecdh->pub);
        ecdh->priv = priv;
        ecdh->pub = pub;
    } else {
        BN_clear_free(priv);
        EC_POINT_free(pub);
    }
    EVP_PKEY_free(pkey);
    EVP_PKEY_CTX_free(ctx);
    ERR_clear_error();
    return ok;
}

/* ncrypto's `ECPointPointer::setFromBuffer`: NULL for bytes that are no point
 * on the group. */
static EC_POINT *point_of(const EC_GROUP *group, NtsView *bytes) {
    EC_POINT *point = EC_POINT_new(group);
    if (point != NULL && EC_POINT_oct2point(group, point, nts_view_bytes(bytes),
                                            (size_t)nts_view_byte_length(bytes), NULL) != 1) {
        EC_POINT_free(point);
        point = NULL;
    }
    return point;
}

/* Node's `ECPointToBuffer`. */
static NtsView *point_view(const EC_GROUP *group, const EC_POINT *point, double form) {
    unsigned char *bytes = NULL;
    size_t length = EC_POINT_point2buf(group, point, (point_conversion_form_t)(int)form, &bytes, NULL);
    NtsView *view = length == 0 ? NULL : nts_view_from_bytes(bytes, (double)length);
    OPENSSL_free(bytes);
    return view;
}

/* ncrypto's `ECKeyPointer::checkKey`: a scalar in [1, n), a point on the
 * curve, the one the other's, and the provider's own checks of both. */
static bool ecdh_check(const Ecdh *ecdh) {
    if (ecdh->priv != NULL) {
        const BIGNUM *order = EC_GROUP_get0_order(ecdh->group);
        if (order == NULL || BN_is_zero(ecdh->priv) || BN_is_negative(ecdh->priv) || BN_cmp(ecdh->priv, order) >= 0) {
            return false;
        }
    }
    if (ecdh->pub != NULL && EC_POINT_is_on_curve(ecdh->group, ecdh->pub, NULL) != 1) return false;
    if (ecdh->priv != NULL && ecdh->pub != NULL) {
        EC_POINT *expected = EC_POINT_new(ecdh->group);
        bool same = expected != NULL && EC_POINT_mul(ecdh->group, expected, ecdh->priv, NULL, NULL, NULL) == 1 &&
                    EC_POINT_cmp(ecdh->group, expected, ecdh->pub, NULL) == 0;
        EC_POINT_free(expected);
        if (!same) return false;
    }
    EVP_PKEY *pkey = ecdh_pkey(ecdh->group, ecdh->pub, ecdh->priv);
    EVP_PKEY_CTX *ctx = pkey == NULL ? NULL : EVP_PKEY_CTX_new(pkey, NULL);
    bool ok = ctx != NULL && (ecdh->pub == NULL || EVP_PKEY_public_check(ctx) == 1) &&
              (ecdh->priv == NULL || EVP_PKEY_private_check(ctx) == 1);
    EVP_PKEY_CTX_free(ctx);
    EVP_PKEY_free(pkey);
    return ok;
}

/* `computeSecret(key)`: node's `ComputeSecret` -- the pair checked, the peer's
 * point parsed -- over ncrypto's `ECKeyPointer::computeSecret`, a derivation
 * between two keys the provider builds. */
NtsView *nts_crypto_ecdh_compute_secret(double handle, NtsView *key) {
    ERR_set_mark();
    Ecdh *ecdh = ecdh_at(handle);
    NtsView *result = NULL;
    if (ecdh == NULL || !ecdh_check(ecdh)) {
        last_status = kEcdhInvalidKeyPair;
    } else {
        EC_POINT *peer = point_of(ecdh->group, key);
        EVP_PKEY *ours = peer == NULL || ecdh->priv == NULL ? NULL : ecdh_pkey(ecdh->group, ecdh->pub, ecdh->priv);
        EVP_PKEY *theirs = ours == NULL ? NULL : ecdh_pkey(ecdh->group, peer, NULL);
        EVP_PKEY_CTX *ctx = theirs == NULL ? NULL : EVP_PKEY_CTX_new(ours, NULL);
        size_t length = 0;
        bool sized = ctx != NULL && EVP_PKEY_derive_init(ctx) == 1 && EVP_PKEY_derive_set_peer(ctx, theirs) == 1 &&
                     EVP_PKEY_derive(ctx, NULL, &length) == 1;
        unsigned char *out = sized ? malloc(length == 0 ? 1 : length) : NULL;
        if (out != NULL && EVP_PKEY_derive(ctx, out, &length) == 1) result = nts_view_from_bytes(out, (double)length);
        if (result == NULL) last_status = peer == NULL ? kEcdhInvalidPublicKey : kEcdhFailed;
        free(out);
        EVP_PKEY_CTX_free(ctx);
        EVP_PKEY_free(theirs);
        EVP_PKEY_free(ours);
        EC_POINT_free(peer);
    }
    ERR_pop_to_mark();
    return result;
}

/* `getPublicKey(format)`: NULL for a key with no public half yet. */
NtsView *nts_crypto_ecdh_get_public_key(double handle, double form) {
    Ecdh *ecdh = ecdh_at(handle);
    NtsView *result = ecdh == NULL || ecdh->pub == NULL ? NULL : point_view(ecdh->group, ecdh->pub, form);
    ERR_clear_error();
    return result;
}

/* `getPrivateKey()`: its own length in bytes, unpadded, as node encodes it. */
NtsView *nts_crypto_ecdh_get_private_key(double handle) {
    Ecdh *ecdh = ecdh_at(handle);
    return ecdh == NULL ? NULL : bignum_view(ecdh->priv);
}

/* `setPrivateKey(key)`: in [1, n) (node's `IsKeyValidForCurve`), and the
 * public key derived from it, both replacing the old pair only when all is
 * well. 1 is success. */
double nts_crypto_ecdh_set_private_key(double handle, NtsView *key) {
    ERR_set_mark();
    Ecdh *ecdh = ecdh_at(handle);
    BIGNUM *scalar = bignum_of(key);
    double status = kEcdhFailed;
    if (ecdh != NULL && scalar != NULL) {
        const BIGNUM *order = EC_GROUP_get0_order(ecdh->group);
        if (BN_cmp(scalar, BN_value_one()) < 0 || order == NULL || BN_cmp(scalar, order) >= 0) {
            status = kEcdhInvalidPrivateKey;
        } else {
            EC_POINT *point = EC_POINT_new(ecdh->group);
            if (point != NULL && EC_POINT_mul(ecdh->group, point, scalar, NULL, NULL, NULL) == 1) {
                BN_clear_free(ecdh->priv);
                EC_POINT_free(ecdh->pub);
                ecdh->priv = scalar;
                ecdh->pub = point;
                scalar = NULL;
                point = NULL;
                status = 1;
            }
            EC_POINT_free(point);
        }
    }
    BN_clear_free(scalar);
    ERR_pop_to_mark();
    return status;
}

/* `setPublicKey(key)`: 1, or `kEcdhInvalidPublicKey` for bytes that are no
 * point. */
double nts_crypto_ecdh_set_public_key(double handle, NtsView *key) {
    ERR_set_mark();
    Ecdh *ecdh = ecdh_at(handle);
    double status = kEcdhFailed;
    if (ecdh != NULL) {
        EC_POINT *point = point_of(ecdh->group, key);
        if (point == NULL) {
            status = kEcdhInvalidPublicKey;
        } else {
            EC_POINT_free(ecdh->pub);
            ecdh->pub = point;
            status = 1;
        }
    }
    ERR_pop_to_mark();
    return status;
}

/* `ECDH.convertKey(key, curve, format)`: the point in another form. */
NtsView *nts_crypto_ecdh_convert_key(NtsView *key, NtsString *curve, double form) {
    ERR_set_mark();
    size_t length = 0;
    char *name = nts_node_to_utf8_alloc(curve, &length);
    int nid = name == NULL ? NID_undef : OBJ_sn2nid(name);
    free(name);
    NtsView *result = NULL;
    if (nid == NID_undef) {
        last_status = kEcdhInvalidCurve;
    } else {
        EC_GROUP *group = EC_GROUP_new_by_curve_name(nid);
        EC_POINT *point = group == NULL ? NULL : point_of(group, key);
        if (point != NULL) result = point_view(group, point, form);
        if (result == NULL) last_status = point == NULL ? kEcdhInvalidPublicKey : kEcdhFailed;
        EC_POINT_free(point);
        EC_GROUP_free(group);
    }
    ERR_pop_to_mark();
    return result;
}

/* ------------------------------------------------- crypto.diffieHellman */

/* ncrypto's `DHPointer::stateless`: `EVP_PKEY_derive` of our key against
 * theirs, for DH, EC, X25519 and X448 alike. A failure leaves its cause on
 * the queue. */
static unsigned char *derive(EVP_PKEY *ours, EVP_PKEY *theirs, size_t *length) {
    EVP_PKEY_CTX *ctx = EVP_PKEY_CTX_new(ours, NULL);
    size_t size = 0;
    bool sized = ctx != NULL && EVP_PKEY_derive_init(ctx) > 0 && EVP_PKEY_derive_set_peer(ctx, theirs) > 0 &&
                 EVP_PKEY_derive(ctx, NULL, &size) > 0 && size > 0;
    unsigned char *out = sized ? malloc(size) : NULL;
    if (out != NULL) {
        size_t written = size;
        if (EVP_PKEY_derive(ctx, out, &written) > 0) {
            /* A DH secret shorter than the prime is padded on the left, as
             * ncrypto pads it. */
            if (written < size) {
                memmove(out + (size - written), out, written);
                memset(out, 0, size - written);
            }
            *length = size;
        } else {
            free(out);
            out = NULL;
        }
    }
    EVP_PKEY_CTX_free(ctx);
    return out;
}

/* The synchronous form: NULL with the cause on the error record. */
NtsView *nts_crypto_dh_stateless(double private_key, double public_key) {
    ERR_clear_error();
    EVP_PKEY *ours = nts_crypto_key_at(private_key);
    EVP_PKEY *theirs = nts_crypto_key_at(public_key);
    size_t length = 0;
    unsigned char *secret = ours == NULL || theirs == NULL ? NULL : derive(ours, theirs, &length);
    NtsView *result = secret == NULL ? NULL : nts_view_from_bytes(secret, (double)length);
    if (secret == NULL) nts_crypto_record_failure();
    OPENSSL_clear_free(secret, length);
    return result;
}

typedef struct {
    EVP_PKEY *ours;
    EVP_PKEY *theirs;
    unsigned char *secret;
    size_t length;
} StatelessJob;

static bool stateless_run(void *state) {
    StatelessJob *job = state;
    job->secret = derive(job->ours, job->theirs, &job->length);
    return job->secret != NULL;
}

static void stateless_deliver(void *state, bool ok, NtsHeader *done) {
    StatelessJob *job = state;
    nts_crypto_deliver_bytes(done, ok, job->secret, job->length);
}

static void stateless_dispose(void *state) {
    StatelessJob *job = state;
    OPENSSL_clear_free(job->secret, job->length);
    EVP_PKEY_free(job->ours);
    EVP_PKEY_free(job->theirs);
    free(job);
}

static const NtsCryptoWork stateless_work = {stateless_run, stateless_deliver, stateless_dispose};

/* The same on the thread pool, delivered to `done(ok, bytes)`. The keys are
 * referenced for the job's life: a key object may be dropped meanwhile. */
void nts_crypto_dh_stateless_job(double private_key, double public_key, NtsHeader *done) {
    EVP_PKEY *ours = nts_crypto_key_at(private_key);
    EVP_PKEY *theirs = nts_crypto_key_at(public_key);
    StatelessJob *job = ours == NULL || theirs == NULL ? NULL : calloc(1, sizeof(StatelessJob));
    if (job == NULL) return;
    EVP_PKEY_up_ref(ours);
    EVP_PKEY_up_ref(theirs);
    job->ours = ours;
    job->theirs = theirs;
    nts_crypto_queue_work(&stateless_work, job, done);
}
