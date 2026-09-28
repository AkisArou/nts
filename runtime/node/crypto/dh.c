/* `node:crypto`'s key agreement: node's `DiffieHellman`, `DiffieHellmanGroup`
 * and `ECDH` classes (`src/crypto/crypto_dh.cc`, `crypto_ec.cc`, with
 * ncrypto's `DHPointer` and `ECKeyPointer`), and the stateless
 * `diffieHellman()` over two key objects (`DHBitsTraits`).
 *
 * The classes are OpenSSL's legacy `DH` and `EC_KEY` objects, as node's are,
 * and so this file uses the API OpenSSL 3 deprecates. That is a choice, not an
 * oversight: `verifyError` is `DH_check`'s flags, which no EVP call reports,
 * and the errors a program reads from these classes are the ones those calls
 * queue. The stateless form is `EVP_PKEY_derive`, as node's is.
 *
 * Like `keys.c`'s keys, an object here is never freed: node's are collected
 * with their JavaScript object, and this runtime has no collection hook. */
#define OPENSSL_SUPPRESS_DEPRECATED
#include <openssl/bn.h>
#include <openssl/dh.h>
#include <openssl/ec.h>
#include <openssl/ecdh.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/objects.h>
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

static DH *dh_at(double handle) { return table_at(&dhs, handle); }
static EC_KEY *ecdh_at(double handle) { return table_at(&ecdhs, handle); }

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

static double dh_claim(DH *dh) {
    double handle = table_claim(&dhs, dh);
    if (handle == 0) {
        DH_free(dh);
        last_status = kDhInvalidParameters;
        return kDhInvalidParameters;
    }
    return handle;
}

/* `new DiffieHellman(bits, generator)`: parameters generated to a size. */
double nts_crypto_dh_new_size(double bits, double generator) {
    ERR_clear_error();
    if (bits < 2) return dh_refuse(DH_R_MODULUS_TOO_SMALL, kDhBadPrimeLength);
    if (generator < 2) return dh_refuse(DH_R_BAD_GENERATOR, kDhBadGenerator);
    DH *dh = DH_new();
    if (dh == NULL || DH_generate_parameters_ex(dh, (int)bits, (int)generator, NULL) != 1) {
        DH_free(dh);
        ERR_clear_error();
        last_status = kDhInvalidParameters;
        return kDhInvalidParameters;
    }
    return dh_claim(dh);
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
    DH *dh = DH_new();
    if (dh == NULL || DH_set0_pqg(dh, p, NULL, g) != 1) {
        DH_free(dh);
        BN_free(p);
        BN_free(g);
        last_status = kDhInvalidParameters;
        return kDhInvalidParameters;
    }
    return dh_claim(dh);
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

/* ncrypto's `DHPointer::FindGroup`, the same eight MODP primes `keygen.c`
 * knows, by name in any case. */
static BIGNUM *modp_prime(const char *name) {
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

/* `DiffieHellmanGroup(name)`: 0 for a name that is no group. */
double nts_crypto_dh_group(NtsString *name) {
    ERR_clear_error();
    size_t length = 0;
    char *text = nts_node_to_utf8_alloc(name, &length);
    BIGNUM *p = text == NULL ? NULL : modp_prime(text);
    free(text);
    BIGNUM *g = BN_new();
    if (p == NULL || g == NULL || BN_set_word(g, 2) != 1) {
        BN_free(p);
        BN_free(g);
        return 0;
    }
    DH *dh = DH_new();
    if (dh == NULL || DH_set0_pqg(dh, p, NULL, g) != 1) {
        DH_free(dh);
        BN_free(p);
        BN_free(g);
        return 0;
    }
    return dh_claim(dh);
}

/* `verifyError`: `DH_check`'s flags, or -1 when the check itself failed. */
double nts_crypto_dh_check(double handle) {
    DH *dh = dh_at(handle);
    int codes = 0;
    double result = dh == NULL || DH_check(dh, &codes) != 1 ? -1 : codes;
    ERR_clear_error();
    return result;
}

/* `generateKeys()`: the public key, or NULL when generation failed. */
NtsView *nts_crypto_dh_generate_keys(double handle) {
    DH *dh = dh_at(handle);
    NtsView *result = NULL;
    if (dh != NULL && DH_generate_key(dh) == 1) result = bignum_view(DH_get0_pub_key(dh));
    ERR_clear_error();
    return result;
}

/* The prime, the generator, the public key or the private key: 0 to 3. NULL
 * for a key not yet generated or set. */
NtsView *nts_crypto_dh_get(double handle, double which) {
    DH *dh = dh_at(handle);
    if (dh == NULL) return NULL;
    switch ((int)which) {
    case 0: return bignum_view(DH_get0_p(dh));
    case 1: return bignum_view(DH_get0_g(dh));
    case 2: return bignum_view(DH_get0_pub_key(dh));
    default: return bignum_view(DH_get0_priv_key(dh));
    }
}

/* `setPublicKey` and `setPrivateKey`: false for bytes OpenSSL will not take. */
bool nts_crypto_dh_set_key(double handle, NtsView *key, bool private_key) {
    DH *dh = dh_at(handle);
    BIGNUM *value = bignum_of(key);
    bool ok = dh != NULL && value != NULL &&
              (private_key ? DH_set0_key(dh, NULL, value) : DH_set0_key(dh, value, NULL)) == 1;
    if (!ok) BN_free(value);
    ERR_clear_error();
    return ok;
}

/* Mirrored as `SecretStatus` in `src/dh.ts`. */
enum {
    kSecretCheckFailed = -1,
    kSecretTooSmall = -2,
    kSecretTooLarge = -3,
    kSecretInvalid = -4,
    kSecretFailed = -5,
};

/* `computeSecret(key)`: ncrypto's `checkPublicKey`, then `DH_compute_key`,
 * left-padded to the prime's size as node pads it. */
NtsView *nts_crypto_dh_compute_secret(double handle, NtsView *key) {
    DH *dh = dh_at(handle);
    BIGNUM *peer = bignum_of(key);
    NtsView *result = NULL;
    int codes = 0;
    if (dh == NULL || peer == NULL || DH_check_pub_key(dh, peer, &codes) != 1) {
        last_status = kSecretCheckFailed;
    } else if (codes & DH_CHECK_PUBKEY_TOO_SMALL) {
        last_status = kSecretTooSmall;
    } else if (codes & DH_CHECK_PUBKEY_TOO_LARGE) {
        last_status = kSecretTooLarge;
    } else if (codes != 0) {
        last_status = kSecretInvalid;
    } else {
        size_t size = (size_t)DH_size(dh);
        unsigned char *out = calloc(size == 0 ? 1 : size, 1);
        int written = out == NULL ? -1 : DH_compute_key(out, peer, dh);
        if (written < 0) {
            last_status = kSecretFailed;
        } else {
            size_t padding = size - (size_t)written;
            memmove(out + padding, out, (size_t)written);
            memset(out, 0, padding);
            result = nts_view_from_bytes(out, (double)size);
        }
        free(out);
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
    double result;
    if (nid == NID_undef) {
        result = kEcdhInvalidCurve;
    } else {
        EC_KEY *key = EC_KEY_new_by_curve_name(nid);
        result = key == NULL ? kEcdhFailed : table_claim(&ecdhs, key);
    }
    ERR_pop_to_mark();
    return result;
}

bool nts_crypto_ecdh_generate_keys(double handle) {
    EC_KEY *key = ecdh_at(handle);
    bool ok = key != NULL && EC_KEY_generate_key(key) == 1;
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

/* `computeSecret(key)`: the shared point's x-coordinate, the field's size in
 * bytes, from `ECDH_compute_key` as node computes it. */
NtsView *nts_crypto_ecdh_compute_secret(double handle, NtsView *key) {
    ERR_set_mark();
    EC_KEY *ec = ecdh_at(handle);
    NtsView *result = NULL;
    if (ec == NULL || EC_KEY_check_key(ec) != 1) {
        last_status = kEcdhInvalidKeyPair;
    } else {
        const EC_GROUP *group = EC_KEY_get0_group(ec);
        EC_POINT *peer = point_of(group, key);
        if (peer == NULL) {
            last_status = kEcdhInvalidPublicKey;
        } else {
            size_t size = ((size_t)EC_GROUP_get_degree(group) + 7) / 8;
            unsigned char *out = malloc(size == 0 ? 1 : size);
            if (out != NULL && ECDH_compute_key(out, size, peer, ec, NULL) > 0) {
                result = nts_view_from_bytes(out, (double)size);
            } else {
                last_status = kEcdhFailed;
            }
            free(out);
            EC_POINT_free(peer);
        }
    }
    ERR_pop_to_mark();
    return result;
}

/* `getPublicKey(format)`: NULL for a key with no public half yet. */
NtsView *nts_crypto_ecdh_get_public_key(double handle, double form) {
    EC_KEY *ec = ecdh_at(handle);
    const EC_POINT *point = ec == NULL ? NULL : EC_KEY_get0_public_key(ec);
    NtsView *result = point == NULL ? NULL : point_view(EC_KEY_get0_group(ec), point, form);
    ERR_clear_error();
    return result;
}

/* `getPrivateKey()`: its own length in bytes, unpadded, as node encodes it. */
NtsView *nts_crypto_ecdh_get_private_key(double handle) {
    EC_KEY *ec = ecdh_at(handle);
    return ec == NULL ? NULL : bignum_view(EC_KEY_get0_private_key(ec));
}

/* `setPrivateKey(key)`: in [1, n), and the public key derived from it, both
 * set on a copy that replaces the key only when all is well. 1 is success. */
double nts_crypto_ecdh_set_private_key(double handle, NtsView *key) {
    ERR_set_mark();
    EC_KEY *ec = ecdh_at(handle);
    BIGNUM *scalar = bignum_of(key);
    double status = kEcdhFailed;
    if (ec != NULL && scalar != NULL) {
        const EC_GROUP *group = EC_KEY_get0_group(ec);
        const BIGNUM *order = EC_GROUP_get0_order(group);
        if (BN_is_zero(scalar) || BN_is_negative(scalar) || order == NULL || BN_cmp(scalar, order) >= 0) {
            status = kEcdhInvalidPrivateKey;
        } else {
            EC_KEY *copy = EC_KEY_dup(ec);
            EC_POINT *point = EC_POINT_new(group);
            if (copy != NULL && point != NULL && EC_KEY_set_private_key(copy, scalar) == 1 &&
                EC_POINT_mul(group, point, scalar, NULL, NULL, NULL) == 1 &&
                EC_KEY_set_public_key(copy, point) == 1) {
                ecdhs.items[(size_t)handle - 1] = copy;
                EC_KEY_free(ec);
                copy = NULL;
                status = 1;
            }
            EC_KEY_free(copy);
            EC_POINT_free(point);
        }
    }
    BN_clear_free(scalar);
    ERR_pop_to_mark();
    return status;
}

/* `setPublicKey(key)`: 1, or `kEcdhInvalidPublicKey` for bytes that are no
 * point, or `kEcdhFailed` for one OpenSSL will not set. */
double nts_crypto_ecdh_set_public_key(double handle, NtsView *key) {
    ERR_set_mark();
    EC_KEY *ec = ecdh_at(handle);
    double status = kEcdhFailed;
    if (ec != NULL) {
        EC_POINT *point = point_of(EC_KEY_get0_group(ec), key);
        if (point == NULL) status = kEcdhInvalidPublicKey;
        else if (EC_KEY_set_public_key(ec, point) == 1) status = 1;
        EC_POINT_free(point);
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
