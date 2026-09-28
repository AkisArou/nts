/* `node:crypto`'s asymmetric keys: node's `src/crypto/crypto_keys.cc`
 * `KeyObjectHandle` and ncrypto's `EVPKeyPointer` parsing and encoding, over
 * OpenSSL 3's `EVP_PKEY`.
 *
 * Parsing calls what ncrypto calls -- `PEM_read_bio_PrivateKey` with node's
 * password callback, `d2i_PUBKEY`, `d2i_PKCS8PrivateKey_bio`, the three PEM
 * labels a public key may carry -- because the error a program sees for a bad
 * key is whatever those calls queue, and node's tests read it. Encoding uses
 * the writers that produce the same bytes without OpenSSL's deprecated
 * per-algorithm types: `PEM_write_bio_PrivateKey_traditional` for PKCS#1 and
 * SEC1, `i2d_PublicKey` for a PKCS#1 public key.
 *
 * JWK components cross as bytes in a fixed order per key family; the
 * base64url, the property names and their order are the TypeScript's. */
#include <openssl/bio.h>
#include <openssl/core_names.h>
#include <openssl/ec.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/objects.h>
#include <openssl/param_build.h>
#include <openssl/pem.h>
#include <openssl/x509.h>
#include <stdlib.h>
#include <string.h>
#include "crypto_internal.h"
#include "nts_crypto.h"
#include "shared.h"

/* Mirrored as `KeyFormat` and `KeyEncoding` in `src/asymmetric.ts`. */
enum { kFormatDer = 0, kFormatPem = 1 };
enum { kEncodingPkcs1 = 0, kEncodingPkcs8 = 1, kEncodingSpki = 2, kEncodingSec1 = 3 };

/* Statuses besides a handle, mirrored as `KeyStatus`. */
enum {
    kKeyFailed = 0,
    kKeyNeedPassphrase = -1,
    kKeyInvalidCurve = -2,
    kKeyUnsupportedType = -3,
    kKeyUnsupportedCurve = -4,
    kKeyExportFailed = -5,
};

static double last_status;

double nts_crypto_key_status(void) { return last_status; }

/* ------------------------------------------------------------ the handles */

/* A key is never freed: node's `KeyObjectHandle` is collected with its
 * `KeyObject`, and this runtime has no collection hook (`nts_crypto.h`). Keys
 * are few and long-lived, which is what makes that tolerable. */
static EVP_PKEY **keys;
static size_t key_count;
static size_t key_capacity;

static double key_claim(EVP_PKEY *pkey) {
    if (pkey == NULL) return kKeyFailed;
    if (key_count == key_capacity) {
        size_t grown = key_capacity == 0 ? 16 : key_capacity * 2;
        EVP_PKEY **moved = realloc(keys, grown * sizeof(EVP_PKEY *));
        if (moved == NULL) {
            EVP_PKEY_free(pkey);
            return kKeyFailed;
        }
        keys = moved;
        key_capacity = grown;
    }
    keys[key_count] = pkey;
    return (double)++key_count;
}

EVP_PKEY *nts_crypto_key_at(double handle) {
    if (handle < 1 || handle > (double)key_count) return NULL;
    return keys[(size_t)handle - 1];
}

/* ------------------------------------------------------------- parsing */

typedef struct {
    const unsigned char *data;
    size_t length;
    bool given;
} Passphrase;

/* ncrypto's `PasswordCallback`: the passphrase if one was given and fits,
 * and -1 otherwise, which OpenSSL reads as "no password". */
static int password_callback(char *buf, int size, int rwflag, void *u) {
    (void)rwflag;
    const Passphrase *passphrase = u;
    if (passphrase == NULL || !passphrase->given) return -1;
    if ((size_t)size < passphrase->length) return -1;
    memcpy(buf, passphrase->data, passphrase->length);
    return (int)passphrase->length;
}

/* ncrypto's `IsASN1Sequence`: the offset and length of a SEQUENCE's
 * contents, reading the DER length octets by hand. */
static bool asn1_sequence(const unsigned char *data, size_t size, size_t *offset, size_t *length) {
    if (size < 2 || data[0] != 0x30) return false;
    if (data[1] & 0x80) {
        size_t bytes = data[1] & 0x7f;
        if (bytes + 2 > size || bytes > sizeof(size_t)) return false;
        size_t value = 0;
        for (size_t i = 0; i < bytes; i++) value = (value << 8) | data[i + 2];
        *offset = 2 + bytes;
        *length = size - 2 - bytes < value ? size - 2 - bytes : value;
    } else {
        *offset = 2;
        *length = size - 2 < data[1] ? size - 2 : data[1];
    }
    return true;
}

/* A PrivateKeyInfo starts with an INTEGER; an EncryptedPrivateKeyInfo with
 * an AlgorithmIdentifier. */
static bool is_encrypted_private_key_info(const unsigned char *data, size_t size) {
    size_t offset, length;
    if (size == 0 || !asn1_sequence(data, size, &offset, &length)) return false;
    return length >= 1 && data[offset] != 2;
}

/* An RSAPrivateKey starts with a one-byte INTEGER version of 0 or 1; an
 * RSAPublicKey with the modulus, which is at least 4. */
static bool is_rsa_private_key(const unsigned char *data, size_t size) {
    size_t offset, length;
    if (!asn1_sequence(data, size, &offset, &length)) return false;
    return length >= 3 && data[offset] == 2 && data[offset + 1] == 1 && !(data[offset + 2] & 0xfe);
}

/* ncrypto's `keyOrError`: a missing key is a failure, unless OpenSSL's oldest
 * error says a password was needed and none was given. */
static double key_or_error(EVP_PKEY *pkey, const Passphrase *passphrase) {
    if (pkey != NULL) return key_claim(pkey);
    unsigned long error = ERR_peek_error();
    if (ERR_GET_LIB(error) == ERR_LIB_PEM && ERR_GET_REASON(error) == PEM_R_BAD_PASSWORD_READ &&
        !passphrase->given) {
        ERR_clear_error();
        return kKeyNeedPassphrase;
    }
    nts_crypto_record_failure();
    return kKeyFailed;
}

/* ncrypto's `TryParsePrivateKey`. */
static double parse_private(int format, int type, const unsigned char *data, size_t size,
                            const Passphrase *passphrase) {
    if (format == kFormatPem) {
        BIO *bio = BIO_new_mem_buf(data, (int)size);
        if (bio == NULL) return key_or_error(NULL, passphrase);
        EVP_PKEY *pkey = PEM_read_bio_PrivateKey(bio, NULL, password_callback, (void *)passphrase);
        BIO_free(bio);
        return key_or_error(pkey, passphrase);
    }
    const unsigned char *p = data;
    if (type == kEncodingPkcs1) {
        return key_or_error(d2i_PrivateKey(EVP_PKEY_RSA, NULL, &p, (long)size), passphrase);
    }
    if (type == kEncodingPkcs8) {
        BIO *bio = BIO_new_mem_buf(data, (int)size);
        if (bio == NULL) return key_or_error(NULL, passphrase);
        EVP_PKEY *pkey = NULL;
        if (is_encrypted_private_key_info(data, size)) {
            pkey = d2i_PKCS8PrivateKey_bio(bio, NULL, password_callback, (void *)passphrase);
        } else {
            PKCS8_PRIV_KEY_INFO *info = d2i_PKCS8_PRIV_KEY_INFO_bio(bio, NULL);
            if (info != NULL) {
                pkey = EVP_PKCS82PKEY(info);
                PKCS8_PRIV_KEY_INFO_free(info);
            }
        }
        BIO_free(bio);
        return key_or_error(pkey, passphrase);
    }
    return key_or_error(d2i_PrivateKey(EVP_PKEY_EC, NULL, &p, (long)size), passphrase);
}

typedef EVP_PKEY *(*DerParser)(const unsigned char **p, long length);

static EVP_PKEY *spki_of(const unsigned char **p, long length) { return d2i_PUBKEY(NULL, p, length); }

static EVP_PKEY *rsa_public_of(const unsigned char **p, long length) {
    return d2i_PublicKey(EVP_PKEY_RSA, NULL, p, length);
}

static EVP_PKEY *certificate_key_of(const unsigned char **p, long length) {
    X509 *certificate = d2i_X509(NULL, p, length);
    if (certificate == NULL) return NULL;
    EVP_PKEY *pkey = X509_get_pubkey(certificate);
    X509_free(certificate);
    return pkey;
}

/* ncrypto's `TryParsePublicKeyInner`: find one PEM label, then parse what is
 * under it. Not finding the label is not a failure -- the caller tries the
 * next -- so what that search queued is dropped. */
static double parse_public_pem_as(const unsigned char *data, size_t size, const char *label, DerParser parse,
                                  bool *recognized) {
    *recognized = false;
    BIO *bio = BIO_new_mem_buf(data, (int)size);
    if (bio == NULL) return kKeyFailed;
    unsigned char *der = NULL;
    long der_length = 0;
    ERR_set_mark();
    int found = PEM_bytes_read_bio(&der, &der_length, NULL, label, bio, NULL, NULL);
    ERR_pop_to_mark();
    BIO_free(bio);
    if (found != 1) return kKeyFailed;
    *recognized = true;
    const unsigned char *p = der;
    EVP_PKEY *pkey = parse(&p, der_length);
    OPENSSL_free(der);
    if (pkey == NULL) {
        nts_crypto_record_failure();
        return kKeyFailed;
    }
    return key_claim(pkey);
}

/* ncrypto's `TryParsePublicKeyPEM`: SPKI, then PKCS#1, then a certificate. */
static double parse_public_pem(const unsigned char *data, size_t size, bool *recognized) {
    static const struct {
        const char *label;
        DerParser parse;
    } kinds[] = {
        {"PUBLIC KEY", spki_of},
        {"RSA PUBLIC KEY", rsa_public_of},
        {"CERTIFICATE", certificate_key_of},
    };
    for (size_t i = 0; i < sizeof(kinds) / sizeof(kinds[0]); i++) {
        double result = parse_public_pem_as(data, size, kinds[i].label, kinds[i].parse, recognized);
        if (*recognized) return result;
    }
    return kKeyFailed;
}

static double parse_public_der(int type, const unsigned char *data, size_t size) {
    const unsigned char *p = data;
    EVP_PKEY *pkey = type == kEncodingPkcs1 ? rsa_public_of(&p, (long)size) : spki_of(&p, (long)size);
    if (pkey == NULL) {
        nts_crypto_record_failure();
        return kKeyFailed;
    }
    return key_claim(pkey);
}

double nts_crypto_key_parse_private(double format, double type, NtsView *data, NtsView *passphrase,
                                    bool has_passphrase) {
    ERR_clear_error();
    Passphrase pass = {
        .data = nts_view_bytes(passphrase),
        .length = (size_t)nts_view_byte_length(passphrase),
        .given = has_passphrase,
    };
    return parse_private((int)format, (int)type, nts_view_bytes(data), (size_t)nts_view_byte_length(data), &pass);
}

/* Node's `GetPublicOrPrivateKeyFromJs`: PEM tells a public key from a private
 * one by its label, and DER by its encoding -- only PKCS#1 is either, and its
 * first INTEGER says which. A private key answers for its public half. */
double nts_crypto_key_parse_public(double format, double type, NtsView *data, NtsView *passphrase,
                                   bool has_passphrase) {
    ERR_clear_error();
    const unsigned char *bytes = nts_view_bytes(data);
    size_t size = (size_t)nts_view_byte_length(data);
    Passphrase pass = {
        .data = nts_view_bytes(passphrase),
        .length = (size_t)nts_view_byte_length(passphrase),
        .given = has_passphrase,
    };
    if ((int)format == kFormatPem) {
        bool recognized = false;
        double result = parse_public_pem(bytes, size, &recognized);
        if (recognized) return result;
        return parse_private(kFormatPem, (int)type, bytes, size, &pass);
    }
    bool is_public = (int)type == kEncodingPkcs1 ? !is_rsa_private_key(bytes, size) : (int)type == kEncodingSpki;
    if (is_public) return parse_public_der((int)type, bytes, size);
    return parse_private(kFormatDer, (int)type, bytes, size, &pass);
}

/* -------------------------------------------------------- JWK and raw */

static BIGNUM *bignum_of(NtsView *view) {
    return BN_bin2bn(nts_view_bytes(view), (int)nts_view_byte_length(view), NULL);
}

/* Node's `ImportJWKRsaKey`, once the TypeScript has checked the members are
 * strings: `n` and `e`, and for a private key the other six. */
double nts_crypto_key_from_jwk_rsa(NtsArray *components, bool private_key) {
    ERR_clear_error();
    static const char *names[] = {
        OSSL_PKEY_PARAM_RSA_N,         OSSL_PKEY_PARAM_RSA_E,         OSSL_PKEY_PARAM_RSA_D,
        OSSL_PKEY_PARAM_RSA_FACTOR1,   OSSL_PKEY_PARAM_RSA_FACTOR2,   OSSL_PKEY_PARAM_RSA_EXPONENT1,
        OSSL_PKEY_PARAM_RSA_EXPONENT2, OSSL_PKEY_PARAM_RSA_COEFFICIENT1,
    };
    size_t count = private_key ? 8 : 2;
    if ((size_t)components->header.length < count) return kKeyFailed;
    NtsView **views = NTS_ITEMS(components, NtsView *);
    BIGNUM *numbers[8] = {0};
    OSSL_PARAM_BLD *builder = OSSL_PARAM_BLD_new();
    bool ok = builder != NULL;
    for (size_t i = 0; ok && i < count; i++) {
        numbers[i] = bignum_of(views[i]);
        ok = numbers[i] != NULL && OSSL_PARAM_BLD_push_BN(builder, names[i], numbers[i]) == 1;
    }
    OSSL_PARAM *params = ok ? OSSL_PARAM_BLD_to_param(builder) : NULL;
    EVP_PKEY_CTX *ctx = params == NULL ? NULL : EVP_PKEY_CTX_new_from_name(NULL, "RSA", NULL);
    EVP_PKEY *pkey = NULL;
    if (ctx != NULL && EVP_PKEY_fromdata_init(ctx) == 1) {
        EVP_PKEY_fromdata(ctx, &pkey, private_key ? EVP_PKEY_KEYPAIR : EVP_PKEY_PUBLIC_KEY, params);
    }
    EVP_PKEY_CTX_free(ctx);
    OSSL_PARAM_free(params);
    OSSL_PARAM_BLD_free(builder);
    for (size_t i = 0; i < count; i++) BN_free(numbers[i]);
    ERR_clear_error();
    return key_claim(pkey);
}

/* ncrypto's `Ec::GetCurveIdFromName`: a NIST name, then OpenSSL's own. */
static int curve_nid_of(const char *name) {
    int nid = EC_curve_nist2nid(name);
    return nid != NID_undef ? nid : OBJ_sn2nid(name);
}

/* Whether OpenSSL names a curve, as node asks before anything else in a JWK. */
bool nts_crypto_key_curve_known(NtsString *curve) {
    size_t length = 0;
    char *name = nts_node_to_utf8_alloc(curve, &length);
    int nid = name == NULL ? NID_undef : curve_nid_of(name);
    free(name);
    return nid != NID_undef;
}

/* An EC key from its public point, and its private scalar when given --
 * node's `ImportJWKEcKey` and the raw import. The point is checked to be on
 * the curve, as `EC_KEY_set_public_key_affine_coordinates` checks it. */
static EVP_PKEY *ec_key_from(int nid, const unsigned char *point, size_t point_length, BIGNUM *private_scalar) {
    EC_GROUP *group = EC_GROUP_new_by_curve_name(nid);
    if (group == NULL) return NULL;
    EC_POINT *public_point = EC_POINT_new(group);
    bool ok = public_point != NULL;
    if (ok && point != NULL) {
        ok = EC_POINT_oct2point(group, public_point, point, point_length, NULL) == 1;
    } else if (ok) {
        ok = private_scalar != NULL && EC_POINT_mul(group, public_point, private_scalar, NULL, NULL, NULL) == 1;
    }
    unsigned char *encoded = NULL;
    size_t encoded_length = 0;
    if (ok) {
        encoded_length = EC_POINT_point2buf(group, public_point, POINT_CONVERSION_UNCOMPRESSED, &encoded, NULL);
        ok = encoded_length > 0;
    }
    OSSL_PARAM_BLD *builder = ok ? OSSL_PARAM_BLD_new() : NULL;
    ok = builder != NULL &&
         OSSL_PARAM_BLD_push_utf8_string(builder, OSSL_PKEY_PARAM_GROUP_NAME, OBJ_nid2sn(nid), 0) == 1 &&
         OSSL_PARAM_BLD_push_octet_string(builder, OSSL_PKEY_PARAM_PUB_KEY, encoded, encoded_length) == 1 &&
         (private_scalar == NULL || OSSL_PARAM_BLD_push_BN(builder, OSSL_PKEY_PARAM_PRIV_KEY, private_scalar) == 1);
    OSSL_PARAM *params = ok ? OSSL_PARAM_BLD_to_param(builder) : NULL;
    EVP_PKEY_CTX *ctx = params == NULL ? NULL : EVP_PKEY_CTX_new_from_name(NULL, "EC", NULL);
    EVP_PKEY *pkey = NULL;
    if (ctx != NULL && EVP_PKEY_fromdata_init(ctx) == 1) {
        EVP_PKEY_fromdata(ctx, &pkey, private_scalar != NULL ? EVP_PKEY_KEYPAIR : EVP_PKEY_PUBLIC_KEY, params);
    }
    EVP_PKEY_CTX_free(ctx);
    OSSL_PARAM_free(params);
    OSSL_PARAM_BLD_free(builder);
    OPENSSL_free(encoded);
    EC_POINT_free(public_point);
    EC_GROUP_free(group);
    return pkey;
}

/* Node's `ImportJWKEcKey`: `kKeyInvalidCurve` for a curve OpenSSL does not
 * name, a failure for coordinates not on it. */
double nts_crypto_key_from_jwk_ec(NtsString *curve, NtsView *x, NtsView *y, NtsView *d, bool private_key) {
    ERR_clear_error();
    size_t length = 0;
    char *name = nts_node_to_utf8_alloc(curve, &length);
    int nid = name == NULL ? NID_undef : curve_nid_of(name);
    free(name);
    if (nid == NID_undef) return kKeyInvalidCurve;
    EC_GROUP *group = EC_GROUP_new_by_curve_name(nid);
    if (group == NULL) return kKeyFailed;
    /* x and y as a point: node sets the affine coordinates, which pads
     * nothing and rejects a point off the curve. */
    BIGNUM *bx = bignum_of(x);
    BIGNUM *by = bignum_of(y);
    EC_POINT *point = EC_POINT_new(group);
    unsigned char *encoded = NULL;
    size_t encoded_length = 0;
    if (bx != NULL && by != NULL && point != NULL &&
        EC_POINT_set_affine_coordinates(group, point, bx, by, NULL) == 1) {
        encoded_length = EC_POINT_point2buf(group, point, POINT_CONVERSION_UNCOMPRESSED, &encoded, NULL);
    }
    BIGNUM *scalar = private_key ? bignum_of(d) : NULL;
    EVP_PKEY *pkey = encoded_length > 0 && (!private_key || scalar != NULL)
                         ? ec_key_from(nid, encoded, encoded_length, scalar)
                         : NULL;
    OPENSSL_free(encoded);
    BN_free(bx);
    BN_free(by);
    BN_clear_free(scalar);
    EC_POINT_free(point);
    EC_GROUP_free(group);
    ERR_clear_error();
    return key_claim(pkey);
}

/* The four curves node reads by name for OKP and raw keys. */
static int okp_id_of(const char *name) {
    if (strcmp(name, "Ed25519") == 0) return EVP_PKEY_ED25519;
    if (strcmp(name, "Ed448") == 0) return EVP_PKEY_ED448;
    if (strcmp(name, "X25519") == 0) return EVP_PKEY_X25519;
    if (strcmp(name, "X448") == 0) return EVP_PKEY_X448;
    return NID_undef;
}

/* Node's `ImportJWKEdKey` and the OKP half of `ImportRawKey`: the raw private
 * key, or the raw public key. `kKeyUnsupportedType` for a curve name that is
 * none of the four. */
double nts_crypto_key_from_okp(NtsString *curve, NtsView *raw, bool private_key) {
    ERR_clear_error();
    size_t length = 0;
    char *name = nts_node_to_utf8_alloc(curve, &length);
    int id = name == NULL ? NID_undef : okp_id_of(name);
    free(name);
    if (id == NID_undef) return kKeyUnsupportedType;
    EVP_PKEY *pkey = private_key
                         ? EVP_PKEY_new_raw_private_key(id, NULL, nts_view_bytes(raw), (size_t)nts_view_byte_length(raw))
                         : EVP_PKEY_new_raw_public_key(id, NULL, nts_view_bytes(raw), (size_t)nts_view_byte_length(raw));
    ERR_clear_error();
    return key_claim(pkey);
}

/* Node's `ImportRawKey` for EC: a point in any form, or a private scalar of
 * exactly the group order's length. */
double nts_crypto_key_from_raw_ec(NtsString *curve, NtsView *raw, bool private_key) {
    ERR_clear_error();
    size_t length = 0;
    char *name = nts_node_to_utf8_alloc(curve, &length);
    int nid = name == NULL ? NID_undef : curve_nid_of(name);
    free(name);
    if (nid == NID_undef) return kKeyInvalidCurve;
    EVP_PKEY *pkey = NULL;
    if (private_key) {
        EC_GROUP *group = EC_GROUP_new_by_curve_name(nid);
        const BIGNUM *order = group == NULL ? NULL : EC_GROUP_get0_order(group);
        if (order != NULL && (size_t)BN_num_bytes(order) == (size_t)nts_view_byte_length(raw)) {
            BIGNUM *scalar = bignum_of(raw);
            if (scalar != NULL) pkey = ec_key_from(nid, NULL, 0, scalar);
            BN_clear_free(scalar);
        }
        EC_GROUP_free(group);
    } else {
        pkey = ec_key_from(nid, nts_view_bytes(raw), (size_t)nts_view_byte_length(raw), NULL);
    }
    ERR_clear_error();
    return key_claim(pkey);
}

/* --------------------------------------------------------- what a key is */

/* Node's `GetAsymmetricKeyType`: the names a program sees, and "" for a key
 * none of them describes. */
NtsString *nts_crypto_key_type(double handle) {
    EVP_PKEY *pkey = nts_crypto_key_at(handle);
    const char *name = "";
    if (pkey != NULL) {
        switch (EVP_PKEY_get_base_id(pkey)) {
        case EVP_PKEY_RSA: name = "rsa"; break;
        case EVP_PKEY_RSA_PSS: name = "rsa-pss"; break;
        case EVP_PKEY_DSA: name = "dsa"; break;
        case EVP_PKEY_DH: name = "dh"; break;
        case EVP_PKEY_EC: name = "ec"; break;
        case EVP_PKEY_ED25519: name = "ed25519"; break;
        case EVP_PKEY_ED448: name = "ed448"; break;
        case EVP_PKEY_X25519: name = "x25519"; break;
        case EVP_PKEY_X448: name = "x448"; break;
        default: break;
        }
    }
    return nts_string_from_utf8(name, strlen(name));
}

static int bits_of(EVP_PKEY *pkey, const char *param) {
    BIGNUM *value = NULL;
    if (EVP_PKEY_get_bn_param(pkey, param, &value) != 1) return 0;
    int bits = BN_num_bits(value);
    BN_free(value);
    return bits;
}

/* The numbers `asymmetricKeyDetails` reports: `[modulusLength,
 * divisorLength, saltLength]`, -1 for what the key's family does not have.
 * RSA-PSS reports a salt length only when its parameters are restricted. */
NtsArray *nts_crypto_key_details(double handle) {
    EVP_PKEY *pkey = nts_crypto_key_at(handle);
    NtsArray *details = nts_array_new(&nts_node_desc_double, 3);
    double *items = NTS_ITEMS(details, double);
    items[0] = items[1] = items[2] = -1;
    if (pkey == NULL) return details;
    ERR_set_mark();
    switch (EVP_PKEY_get_base_id(pkey)) {
    case EVP_PKEY_RSA_PSS: {
        int salt = 0;
        char digest[64];
        if (EVP_PKEY_get_utf8_string_param(pkey, OSSL_PKEY_PARAM_RSA_DIGEST, digest, sizeof(digest), NULL) == 1 &&
            EVP_PKEY_get_int_param(pkey, OSSL_PKEY_PARAM_RSA_PSS_SALTLEN, &salt) == 1) {
            items[2] = salt;
        }
    }
        /* fall through */
    case EVP_PKEY_RSA:
        items[0] = bits_of(pkey, OSSL_PKEY_PARAM_RSA_N);
        break;
    case EVP_PKEY_DSA:
        items[0] = bits_of(pkey, OSSL_PKEY_PARAM_FFC_P);
        items[1] = bits_of(pkey, OSSL_PKEY_PARAM_FFC_Q);
        break;
    default:
        break;
    }
    ERR_pop_to_mark();
    return details;
}

/* A digest's name as node reports it: OpenSSL's long name, `sha256`. */
static void long_digest_name(const char *name, char *out, size_t size) {
    const EVP_MD *md = EVP_get_digestbyname(name);
    const char *long_name = md == NULL ? NULL : OBJ_nid2ln(EVP_MD_get_type(md));
    snprintf(out, size, "%s", long_name != NULL ? long_name : name);
}

/* The strings `asymmetricKeyDetails` reports: `[namedCurve, hashAlgorithm,
 * mgf1HashAlgorithm]`, empty where there is none. */
NtsArray *nts_crypto_key_detail_names(double handle) {
    EVP_PKEY *pkey = nts_crypto_key_at(handle);
    char curve[80] = "";
    char digest[80] = "";
    char mgf1[80] = "";
    if (pkey != NULL) {
        ERR_set_mark();
        int id = EVP_PKEY_get_base_id(pkey);
        if (id == EVP_PKEY_EC) {
            char group[80];
            if (EVP_PKEY_get_utf8_string_param(pkey, OSSL_PKEY_PARAM_GROUP_NAME, group, sizeof(group), NULL) == 1) {
                int nid = OBJ_txt2nid(group);
                snprintf(curve, sizeof(curve), "%s", nid != NID_undef ? OBJ_nid2sn(nid) : group);
            }
        } else if (id == EVP_PKEY_RSA_PSS) {
            char name[80];
            if (EVP_PKEY_get_utf8_string_param(pkey, OSSL_PKEY_PARAM_RSA_DIGEST, name, sizeof(name), NULL) == 1) {
                long_digest_name(name, digest, sizeof(digest));
                if (EVP_PKEY_get_utf8_string_param(pkey, OSSL_PKEY_PARAM_RSA_MGF1_DIGEST, name, sizeof(name), NULL) ==
                    1) {
                    long_digest_name(name, mgf1, sizeof(mgf1));
                }
            }
        }
        ERR_pop_to_mark();
    }
    NtsArray *names = nts_array_new(&nts_desc_ref, 3);
    void **items = NTS_ITEMS(names, void *);
    items[0] = nts_string_from_utf8(curve, strlen(curve));
    items[1] = nts_string_from_utf8(digest, strlen(digest));
    items[2] = nts_string_from_utf8(mgf1, strlen(mgf1));
    return names;
}

/* RSA's public exponent, big-endian, as node's details carry it before the
 * TypeScript makes it a bigint. */
NtsView *nts_crypto_key_public_exponent(double handle) {
    EVP_PKEY *pkey = nts_crypto_key_at(handle);
    BIGNUM *e = NULL;
    if (pkey == NULL || EVP_PKEY_get_bn_param(pkey, OSSL_PKEY_PARAM_RSA_E, &e) != 1) {
        ERR_clear_error();
        return nts_view_from_bytes(NULL, 0);
    }
    int size = BN_num_bytes(e);
    unsigned char *bytes = malloc(size == 0 ? 1 : (size_t)size);
    NtsView *result = nts_view_from_bytes(NULL, 0);
    if (bytes != NULL) {
        BN_bn2bin(e, bytes);
        nts_release((NtsHeader *)result);
        result = nts_view_from_bytes(bytes, (double)size);
        free(bytes);
    }
    BN_free(e);
    return result;
}

bool nts_crypto_key_equals(double a, double b) {
    EVP_PKEY *first = nts_crypto_key_at(a);
    EVP_PKEY *second = nts_crypto_key_at(b);
    if (first == NULL || second == NULL) return false;
    ERR_set_mark();
    bool equal = EVP_PKEY_eq(first, second) == 1;
    ERR_pop_to_mark();
    return equal;
}

/* -------------------------------------------------------------- exports */

static NtsView *bio_contents(BIO *bio) {
    char *data = NULL;
    long length = BIO_get_mem_data(bio, &data);
    return nts_view_from_bytes(data, length < 0 ? 0 : (double)length);
}

/* ncrypto's `writePrivateKey`: PKCS#1 and SEC1 are the traditional form, and
 * only PEM may be encrypted there; PKCS#8 may be encrypted in either. NULL
 * is a failure on the error record ("Failed to encode private key"). */
NtsView *nts_crypto_key_export_private(double handle, double format, double type, double cipher_id,
                                       NtsView *passphrase) {
    ERR_clear_error();
    last_status = kKeyExportFailed;
    EVP_PKEY *pkey = nts_crypto_key_at(handle);
    BIO *bio = BIO_new(BIO_s_mem());
    if (pkey == NULL || bio == NULL) {
        BIO_free(bio);
        return NULL;
    }
    const EVP_CIPHER *cipher = cipher_id < 0 ? NULL : nts_crypto_cipher_at(cipher_id);
    unsigned char *pass = cipher == NULL ? NULL : nts_view_bytes(passphrase);
    int pass_length = cipher == NULL ? 0 : (int)nts_view_byte_length(passphrase);
    bool pem = (int)format == kFormatPem;
    int ok = 0;
    if ((int)type == kEncodingPkcs8) {
        ok = pem ? PEM_write_bio_PKCS8PrivateKey(bio, pkey, cipher, (char *)pass, pass_length, NULL, NULL)
                 : i2d_PKCS8PrivateKey_bio(bio, pkey, cipher, (char *)pass, pass_length, NULL, NULL);
    } else {
        ok = pem ? PEM_write_bio_PrivateKey_traditional(bio, pkey, cipher, pass, pass_length, NULL, NULL)
                 : i2d_PrivateKey_bio(bio, pkey);
    }
    NtsView *result = NULL;
    if (ok == 1) {
        result = bio_contents(bio);
    } else {
        nts_crypto_record_failure();
    }
    BIO_free(bio);
    return result;
}

/* ncrypto's `writePublicKey`: SPKI, or PKCS#1 for RSA. */
NtsView *nts_crypto_key_export_public(double handle, double format, double type) {
    ERR_clear_error();
    EVP_PKEY *pkey = nts_crypto_key_at(handle);
    BIO *bio = BIO_new(BIO_s_mem());
    if (pkey == NULL || bio == NULL) {
        BIO_free(bio);
        return NULL;
    }
    bool pem = (int)format == kFormatPem;
    int ok = 0;
    if ((int)type == kEncodingPkcs1) {
        unsigned char *der = NULL;
        int der_length = i2d_PublicKey(pkey, &der);
        if (der_length > 0) {
            ok = pem ? PEM_write_bio(bio, "RSA PUBLIC KEY", "", der, der_length) > 0
                     : BIO_write(bio, der, der_length) == der_length;
        }
        OPENSSL_free(der);
    } else {
        ok = pem ? PEM_write_bio_PUBKEY(bio, pkey) : i2d_PUBKEY_bio(bio, pkey);
    }
    NtsView *result = NULL;
    if (ok == 1) {
        result = bio_contents(bio);
    } else {
        nts_crypto_record_failure();
    }
    BIO_free(bio);
    return result;
}

static NtsView *bignum_bytes(const BIGNUM *value, int pad) {
    int size = pad > 0 ? pad : BN_num_bytes(value);
    unsigned char *bytes = malloc(size == 0 ? 1 : (size_t)size);
    if (bytes == NULL) return nts_view_from_bytes(NULL, 0);
    if (pad > 0) {
        BN_bn2binpad(value, bytes, size);
    } else {
        BN_bn2bin(value, bytes);
    }
    NtsView *view = nts_view_from_bytes(bytes, (double)size);
    free(bytes);
    return view;
}

static bool push_bn_param(NtsArray *out, EVP_PKEY *pkey, const char *param, int pad) {
    BIGNUM *value = NULL;
    if (EVP_PKEY_get_bn_param(pkey, param, &value) != 1) return false;
    nts_array_push_ref(out, bignum_bytes(value, pad));
    BN_clear_free(value);
    return true;
}

/* A key's JWK members, as bytes in the order its family's TypeScript names
 * them: RSA `n e [d p q dp dq qi]`, EC `x y [d]` padded to the field size,
 * OKP `x [d]`. An empty array is a refusal, and the status says which:
 * `kKeyUnsupportedType`, or `kKeyUnsupportedCurve` for an EC curve JWK has
 * no name for. */
NtsArray *nts_crypto_key_export_jwk(double handle, bool private_key) {
    NtsArray *out = nts_array_new(&nts_desc_ref, 0);
    EVP_PKEY *pkey = nts_crypto_key_at(handle);
    last_status = kKeyUnsupportedType;
    if (pkey == NULL) return out;
    ERR_set_mark();
    int id = EVP_PKEY_get_base_id(pkey);
    bool ok = false;
    if (id == EVP_PKEY_RSA) {
        ok = push_bn_param(out, pkey, OSSL_PKEY_PARAM_RSA_N, 0) && push_bn_param(out, pkey, OSSL_PKEY_PARAM_RSA_E, 0);
        if (ok && private_key) {
            ok = push_bn_param(out, pkey, OSSL_PKEY_PARAM_RSA_D, 0) &&
                 push_bn_param(out, pkey, OSSL_PKEY_PARAM_RSA_FACTOR1, 0) &&
                 push_bn_param(out, pkey, OSSL_PKEY_PARAM_RSA_FACTOR2, 0) &&
                 push_bn_param(out, pkey, OSSL_PKEY_PARAM_RSA_EXPONENT1, 0) &&
                 push_bn_param(out, pkey, OSSL_PKEY_PARAM_RSA_EXPONENT2, 0) &&
                 push_bn_param(out, pkey, OSSL_PKEY_PARAM_RSA_COEFFICIENT1, 0);
        }
    } else if (id == EVP_PKEY_EC) {
        char group[80];
        int nid = NID_undef;
        if (EVP_PKEY_get_utf8_string_param(pkey, OSSL_PKEY_PARAM_GROUP_NAME, group, sizeof(group), NULL) == 1) {
            nid = OBJ_txt2nid(group);
        }
        if (nid != NID_X9_62_prime256v1 && nid != NID_secp256k1 && nid != NID_secp384r1 && nid != NID_secp521r1) {
            last_status = kKeyUnsupportedCurve;
        } else {
            EC_GROUP *ec_group = EC_GROUP_new_by_curve_name(nid);
            int degree = ec_group == NULL ? 0 : EC_GROUP_get_degree(ec_group);
            int bytes = degree / 8 + (7 + degree % 8) / 8;
            EC_GROUP_free(ec_group);
            ok = bytes > 0 && push_bn_param(out, pkey, OSSL_PKEY_PARAM_EC_PUB_X, bytes) &&
                 push_bn_param(out, pkey, OSSL_PKEY_PARAM_EC_PUB_Y, bytes);
            if (ok && private_key) ok = push_bn_param(out, pkey, OSSL_PKEY_PARAM_PRIV_KEY, bytes);
        }
    } else if (id == EVP_PKEY_ED25519 || id == EVP_PKEY_ED448 || id == EVP_PKEY_X25519 || id == EVP_PKEY_X448) {
        unsigned char raw[64];
        size_t length = sizeof(raw);
        ok = EVP_PKEY_get_raw_public_key(pkey, raw, &length) == 1;
        if (ok) nts_array_push_ref(out, nts_view_from_bytes(raw, (double)length));
        if (ok && private_key) {
            length = sizeof(raw);
            ok = EVP_PKEY_get_raw_private_key(pkey, raw, &length) == 1;
            if (ok) nts_array_push_ref(out, nts_view_from_bytes(raw, (double)length));
            OPENSSL_cleanse(raw, sizeof(raw));
        }
    }
    ERR_pop_to_mark();
    if (!ok) {
        nts_release((NtsHeader *)out);
        return nts_array_new(&nts_desc_ref, 0);
    }
    last_status = 1;
    return out;
}

/* The raw forms node 24 added: a public point or key, and a private scalar
 * or key. NULL for a key that has none. */
NtsView *nts_crypto_key_export_raw(double handle, bool private_key, bool compressed) {
    EVP_PKEY *pkey = nts_crypto_key_at(handle);
    if (pkey == NULL) return NULL;
    ERR_set_mark();
    NtsView *result = NULL;
    if (EVP_PKEY_get_base_id(pkey) == EVP_PKEY_EC) {
        if (private_key) {
            BIGNUM *scalar = NULL;
            char group[80];
            if (EVP_PKEY_get_bn_param(pkey, OSSL_PKEY_PARAM_PRIV_KEY, &scalar) == 1 &&
                EVP_PKEY_get_utf8_string_param(pkey, OSSL_PKEY_PARAM_GROUP_NAME, group, sizeof(group), NULL) == 1) {
                EC_GROUP *ec_group = EC_GROUP_new_by_curve_name(OBJ_txt2nid(group));
                const BIGNUM *order = ec_group == NULL ? NULL : EC_GROUP_get0_order(ec_group);
                if (order != NULL) result = bignum_bytes(scalar, BN_num_bytes(order));
                EC_GROUP_free(ec_group);
            }
            BN_clear_free(scalar);
        } else {
            /* The key's encoding, then re-encoded through its group when the
             * caller wants the compressed form: the key itself is not
             * changed, because it is shared by every object that holds it. */
            unsigned char *point = NULL;
            size_t length = EVP_PKEY_get1_encoded_public_key(pkey, &point);
            char group_name[80];
            if (length > 0 && compressed &&
                EVP_PKEY_get_utf8_string_param(pkey, OSSL_PKEY_PARAM_GROUP_NAME, group_name, sizeof(group_name),
                                               NULL) == 1) {
                EC_GROUP *group = EC_GROUP_new_by_curve_name(OBJ_txt2nid(group_name));
                EC_POINT *decoded = group == NULL ? NULL : EC_POINT_new(group);
                unsigned char *packed = NULL;
                size_t packed_length = 0;
                if (decoded != NULL && EC_POINT_oct2point(group, decoded, point, length, NULL) == 1) {
                    packed_length = EC_POINT_point2buf(group, decoded, POINT_CONVERSION_COMPRESSED, &packed, NULL);
                }
                OPENSSL_free(point);
                point = packed;
                length = packed_length;
                EC_POINT_free(decoded);
                EC_GROUP_free(group);
            }
            if (length > 0) result = nts_view_from_bytes(point, (double)length);
            OPENSSL_free(point);
        }
    } else {
        unsigned char raw[64];
        size_t length = sizeof(raw);
        int ok = private_key ? EVP_PKEY_get_raw_private_key(pkey, raw, &length)
                             : EVP_PKEY_get_raw_public_key(pkey, raw, &length);
        if (ok == 1) result = nts_view_from_bytes(raw, (double)length);
        OPENSSL_cleanse(raw, sizeof(raw));
    }
    ERR_pop_to_mark();
    return result;
}
