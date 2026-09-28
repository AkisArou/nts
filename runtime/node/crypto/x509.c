/* `node:crypto`'s `X509Certificate`: node's `src/crypto/crypto_x509.cc` over
 * ncrypto's `X509View` and `X509Pointer`, which are OpenSSL's `X509`.
 *
 * A certificate is a handle, like a key, and for the same reason never freed
 * (`keys.c`). Every answer is ncrypto's: the multi-line names, the escaping
 * printer it writes subject alternative names and information access with in
 * place of OpenSSL's `i2v_GENERAL_NAME`, the upper-case fingerprints. Like
 * ncrypto, each reader leaves OpenSSL's error queue empty; the two that fail
 * with a cause -- parsing and the public key -- record it first. */
#include <openssl/asn1.h>
#include <openssl/bio.h>
#include <openssl/bn.h>
#include <openssl/buffer.h>
#include <openssl/core_names.h>
#include <openssl/ec.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/objects.h>
#include <openssl/param_build.h>
#include <openssl/pem.h>
#include <openssl/rsa.h>
#include <openssl/x509.h>
#include <openssl/x509v3.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "crypto_internal.h"
#include "nts_crypto.h"
#include "shared.h"

/* ------------------------------------------------------------ the handles */

static X509 **certificates;
static size_t certificate_count;
static size_t certificate_capacity;

static double certificate_claim(X509 *cert) {
    if (certificate_count == certificate_capacity) {
        size_t grown = certificate_capacity == 0 ? 8 : certificate_capacity * 2;
        X509 **moved = realloc(certificates, grown * sizeof(X509 *));
        if (moved == NULL) {
            X509_free(cert);
            return 0;
        }
        certificates = moved;
        certificate_capacity = grown;
    }
    certificates[certificate_count] = cert;
    return (double)++certificate_count;
}

static X509 *certificate_at(double handle) {
    if (handle < 1 || handle > (double)certificate_count) return NULL;
    return certificates[(size_t)handle - 1];
}

/* ncrypto's `NoPasswordCallback`: a certificate is never encrypted. */
static int no_password(char *buf, int size, int rwflag, void *u) {
    (void)buf;
    (void)size;
    (void)rwflag;
    (void)u;
    return 0;
}

/* `X509Pointer::Parse`: PEM, then DER. A failure records the queue, whose
 * oldest entry node throws. */
double nts_crypto_x509_parse(NtsView *input) {
    ERR_clear_error();
    BIO *bio = BIO_new_mem_buf(nts_view_bytes(input), (int)nts_view_byte_length(input));
    X509 *cert = bio == NULL ? NULL : PEM_read_bio_X509_AUX(bio, NULL, no_password, NULL);
    if (cert == NULL && bio != NULL) {
        BIO_reset(bio);
        cert = d2i_X509_bio(bio, NULL);
    }
    BIO_free(bio);
    if (cert == NULL) {
        nts_crypto_record_failure();
        return 0;
    }
    ERR_clear_error();
    return certificate_claim(cert);
}

/* ------------------------------------------------------------ as text */

/* A memory BIO's contents as a string, and the BIO freed; NULL for no BIO,
 * which node answers with `undefined`. */
static NtsString *bio_take_string(BIO *bio) {
    if (bio == NULL) return NULL;
    BUF_MEM *mem = NULL;
    BIO_get_mem_ptr(bio, &mem);
    NtsString *text = mem == NULL ? NULL : nts_string_from_utf8(mem->data, mem->length);
    BIO_free(bio);
    return text;
}

/* An owned C string as a string, freed. */
static NtsString *take_cstring(char *text) {
    if (text == NULL) return NULL;
    NtsString *result = nts_string_from_utf8(text, strlen(text));
    OPENSSL_free(text);
    return result;
}

static const int kX509NameFlagsMultiline =
    ASN1_STRFLGS_ESC_2253 | ASN1_STRFLGS_ESC_CTRL | ASN1_STRFLGS_UTF8_CONVERT | XN_FLAG_SEP_MULTILINE | XN_FLAG_FN_SN;

static const int kX509NameFlagsRFC2253WithinUtf8JSON = XN_FLAG_RFC2253 & ~ASN1_STRFLGS_ESC_MSB & ~ASN1_STRFLGS_ESC_CTRL;

/* `X509View::getSubject` and `getIssuer`. */
NtsString *nts_crypto_x509_name(double handle, bool issuer) {
    X509 *cert = certificate_at(handle);
    BIO *bio = cert == NULL ? NULL : BIO_new(BIO_s_mem());
    if (bio == NULL) return NULL;
    const X509_NAME *name = issuer ? X509_get_issuer_name(cert) : X509_get_subject_name(cert);
    if (X509_NAME_print_ex(bio, name, 0, kX509NameFlagsMultiline) <= 0) {
        BIO_free(bio);
        bio = NULL;
    }
    ERR_clear_error();
    return bio_take_string(bio);
}

typedef enum { kAltNameNone, kAltNameUtf8 } AltNameOption;

/* ncrypto's `IsSafeAltName`: what may be printed as it is. */
static bool is_safe_alt_name(const char *name, size_t length, AltNameOption option) {
    for (size_t i = 0; i < length; i++) {
        unsigned char c = (unsigned char)name[i];
        switch (c) {
        /* Quotes and backslashes mess with the escaping, commas with the list
         * a program splits, and a single quote could fake an escape. */
        case '"':
        case '\\':
        case ',':
        case '\'': return false;
        default:
            if (option == kAltNameUtf8) {
                /* A UTF-8 name escapes ASCII controls, not what is past ASCII. */
                if (c < ' ' || c == 0x7f) return false;
            } else if (c < ' ' || c > '~') {
                return false;
            }
        }
    }
    return true;
}

/* ncrypto's `PrintAltName`: a safe name as it is, anything else as a JSON
 * string literal, each byte past what is safe a `\u00XX` -- Latin-1. */
static void print_alt_name(BIO *out, const char *name, size_t length, AltNameOption option,
                           const char *safe_prefix) {
    if (is_safe_alt_name(name, length, option)) {
        if (safe_prefix != NULL) BIO_printf(out, "%s:", safe_prefix);
        BIO_write(out, name, (int)length);
        return;
    }
    BIO_write(out, "\"", 1);
    if (safe_prefix != NULL) BIO_printf(out, "%s:", safe_prefix);
    static const char hex[] = "0123456789abcdef";
    for (size_t j = 0; j < length; j++) {
        unsigned char c = (unsigned char)name[j];
        if (c == '\\') {
            BIO_write(out, "\\\\", 2);
        } else if (c == '"') {
            BIO_write(out, "\\\"", 2);
        } else if ((c >= ' ' && c != ',' && c <= '~') || (option == kAltNameUtf8 && (c & 0x80))) {
            /* Commas are escaped though they need not be, for programs that
             * split the list at them. */
            BIO_write(out, &c, 1);
        } else {
            char u[] = {'\\', 'u', '0', '0', hex[(c & 0xf0) >> 4], hex[c & 0x0f]};
            BIO_write(out, u, sizeof(u));
        }
    }
    BIO_write(out, "\"", 1);
}

static void print_ia5(BIO *out, const ASN1_STRING *name, AltNameOption option, const char *prefix) {
    print_alt_name(out, (const char *)ASN1_STRING_get0_data(name), (size_t)ASN1_STRING_length(name), option,
                   prefix);
}

/* ncrypto's `PrintGeneralName`, its version of `i2v_GENERAL_NAME`: every
 * name escaped where it needs to be, an IP address of an unexpected length
 * said so, an OID always numeric, and `othername:` as `GENERAL_NAME_print`
 * writes it. */
static bool print_general_name(BIO *out, const GENERAL_NAME *gen) {
    switch (gen->type) {
    case GEN_DNS:
        BIO_write(out, "DNS:", 4);
        print_ia5(out, gen->d.dNSName, kAltNameNone, NULL);
        break;
    case GEN_EMAIL:
        BIO_write(out, "email:", 6);
        print_ia5(out, gen->d.rfc822Name, kAltNameNone, NULL);
        break;
    case GEN_URI:
        BIO_write(out, "URI:", 4);
        print_ia5(out, gen->d.uniformResourceIdentifier, kAltNameNone, NULL);
        break;
    case GEN_DIRNAME: {
        BIO_printf(out, "DirName:");
        BIO *name = BIO_new(BIO_s_mem());
        if (name == NULL || X509_NAME_print_ex(name, gen->d.dirn, 0, kX509NameFlagsRFC2253WithinUtf8JSON) < 0) {
            BIO_free(name);
            return false;
        }
        char *line = NULL;
        long length = BIO_get_mem_data(name, &line);
        print_alt_name(out, line, length < 0 ? 0 : (size_t)length, kAltNameUtf8, NULL);
        BIO_free(name);
        break;
    }
    case GEN_IPADD: {
        BIO_printf(out, "IP Address:");
        const unsigned char *b = ASN1_STRING_get0_data(gen->d.ip);
        int length = ASN1_STRING_length(gen->d.ip);
        if (length == 4) {
            BIO_printf(out, "%d.%d.%d.%d", b[0], b[1], b[2], b[3]);
        } else if (length == 16) {
            for (unsigned j = 0; j < 8; j++) {
                unsigned pair = ((unsigned)b[2 * j] << 8) | b[2 * j + 1];
                BIO_printf(out, j == 0 ? "%X" : ":%X", pair);
            }
        } else {
            BIO_printf(out, "<invalid length=%d>", length);
        }
        break;
    }
    case GEN_RID: {
        char line[256];
        OBJ_obj2txt(line, sizeof(line), gen->d.rid, 1);
        BIO_printf(out, "Registered ID:%s", line);
        break;
    }
    case GEN_OTHERNAME: {
        bool unicode = true;
        const char *prefix = NULL;
        switch (OBJ_obj2nid(gen->d.otherName->type_id)) {
        case NID_id_on_SmtpUTF8Mailbox: prefix = "SmtpUTF8Mailbox"; break;
        case NID_XmppAddr: prefix = "XmppAddr"; break;
        case NID_SRVName:
            prefix = "SRVName";
            unicode = false;
            break;
        case NID_ms_upn: prefix = "UPN"; break;
        case NID_NAIRealm: prefix = "NAIRealm"; break;
        default: break;
        }
        int value_type = gen->d.otherName->value->type;
        if (prefix == NULL || (unicode && value_type != V_ASN1_UTF8STRING) ||
            (!unicode && value_type != V_ASN1_IA5STRING)) {
            BIO_printf(out, "othername:<unsupported>");
        } else {
            BIO_printf(out, "othername:");
            if (unicode) {
                print_ia5(out, gen->d.otherName->value->value.utf8string, kAltNameUtf8, prefix);
            } else {
                print_ia5(out, gen->d.otherName->value->value.ia5string, kAltNameNone, prefix);
            }
        }
        break;
    }
    case GEN_X400: BIO_printf(out, "X400Name:<unsupported>"); break;
    case GEN_EDIPARTY: BIO_printf(out, "EdiPartyName:<unsupported>"); break;
    default: return false;
    }
    return true;
}

/* `X509View::getSubjectAltName` over ncrypto's `SafeX509SubjectAltNamePrint`:
 * the names joined by ", ", or NULL without the extension. */
NtsString *nts_crypto_x509_subject_alt_name(double handle) {
    X509 *cert = certificate_at(handle);
    int index = cert == NULL ? -1 : X509_get_ext_by_NID(cert, NID_subject_alt_name, -1);
    GENERAL_NAMES *names = index < 0 ? NULL : X509V3_EXT_d2i(X509_get_ext(cert, index));
    BIO *bio = names == NULL ? NULL : BIO_new(BIO_s_mem());
    bool ok = bio != NULL;
    for (int i = 0; ok && i < sk_GENERAL_NAME_num(names); i++) {
        if (i != 0) BIO_write(bio, ", ", 2);
        ok = print_general_name(bio, sk_GENERAL_NAME_value(names, i));
    }
    GENERAL_NAMES_free(names);
    if (!ok) {
        BIO_free(bio);
        bio = NULL;
    }
    ERR_clear_error();
    return bio_take_string(bio);
}

/* `X509View::getInfoAccess` over ncrypto's `SafeX509InfoAccessPrint`: one
 * "method - name" line each, or NULL without the extension. */
NtsString *nts_crypto_x509_info_access(double handle) {
    X509 *cert = certificate_at(handle);
    int index = cert == NULL ? -1 : X509_get_ext_by_NID(cert, NID_info_access, -1);
    AUTHORITY_INFO_ACCESS *descriptions = index < 0 ? NULL : X509V3_EXT_d2i(X509_get_ext(cert, index));
    BIO *bio = descriptions == NULL ? NULL : BIO_new(BIO_s_mem());
    bool ok = bio != NULL;
    for (int i = 0; ok && i < sk_ACCESS_DESCRIPTION_num(descriptions); i++) {
        ACCESS_DESCRIPTION *description = sk_ACCESS_DESCRIPTION_value(descriptions, i);
        if (i != 0) BIO_write(bio, "\n", 1);
        char method[80];
        i2t_ASN1_OBJECT(method, sizeof(method), description->method);
        BIO_printf(bio, "%s - ", method);
        ok = print_general_name(bio, description->location);
    }
    AUTHORITY_INFO_ACCESS_free(descriptions);
    if (!ok) {
        BIO_free(bio);
        bio = NULL;
    }
    ERR_clear_error();
    return bio_take_string(bio);
}

/* ---------------------------------------------------------- the validity */

static const ASN1_TIME *validity(X509 *cert, bool to) {
    return to ? X509_get0_notAfter(cert) : X509_get0_notBefore(cert);
}

/* `X509View::getValidFrom` and `getValidTo`: `ASN1_TIME_print`'s text. */
NtsString *nts_crypto_x509_valid_text(double handle, bool to) {
    X509 *cert = certificate_at(handle);
    BIO *bio = cert == NULL ? NULL : BIO_new(BIO_s_mem());
    if (bio != NULL) ASN1_TIME_print(bio, validity(cert, to));
    ERR_clear_error();
    return bio_take_string(bio);
}

/* ncrypto's `days_from_epoch`, Howard Hinnant's `days_from_civil`. */
static int64_t days_from_epoch(int64_t y, unsigned m, unsigned d) {
    y -= m <= 2;
    const int64_t era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = (unsigned)(y - era * 400);
    const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + (int64_t)doe - 719468;
}

/* `X509View::getValidFromTime` and `getValidToTime`: seconds since the epoch,
 * through ncrypto's `PortableTimeGM` rather than `timegm`, which a `time_t`
 * of 32 bits cannot hold past 2038. */
double nts_crypto_x509_valid_time(double handle, bool to) {
    X509 *cert = certificate_at(handle);
    struct tm tm;
    memset(&tm, 0, sizeof(tm));
    if (cert != NULL) ASN1_TIME_to_tm(validity(cert, to), &tm);
    ERR_clear_error();
    int64_t year = (int64_t)tm.tm_year + 1900;
    int month = tm.tm_mon;
    if (month > 11) {
        year += month / 12;
        month %= 12;
    } else if (month < 0) {
        int years = (11 - month) / 12;
        year -= years;
        month += 12 * years;
    }
    int64_t days = days_from_epoch(year, (unsigned)month + 1, (unsigned)tm.tm_mday);
    return (double)(60 * (60 * (24 * days + tm.tm_hour) + tm.tm_min) + tm.tm_sec);
}

/* ------------------------------------------------------------- the rest */

/* `X509View::getSignatureAlgorithm`: its long name, or NULL for none. */
NtsString *nts_crypto_x509_signature_algorithm(double handle) {
    X509 *cert = certificate_at(handle);
    int nid = cert == NULL ? NID_undef : X509_get_signature_nid(cert);
    const char *name = nid == NID_undef ? NULL : OBJ_nid2ln(nid);
    return name == NULL ? NULL : nts_string_from_utf8(name, strlen(name));
}

/* `X509View::getSignatureAlgorithmOID`: dotted, whether OpenSSL knows it or not. */
NtsString *nts_crypto_x509_signature_algorithm_oid(double handle) {
    X509 *cert = certificate_at(handle);
    const X509_ALGOR *algorithm = NULL;
    if (cert != NULL) X509_get0_signature(NULL, &algorithm, cert);
    const ASN1_OBJECT *object = NULL;
    if (algorithm != NULL) X509_ALGOR_get0(&object, NULL, NULL, algorithm);
    if (object == NULL) return NULL;
    char text[128];
    int length = OBJ_obj2txt(text, sizeof(text), object, 1);
    if (length < 0 || (size_t)length >= sizeof(text)) return NULL;
    return nts_string_from_utf8(text, (size_t)length);
}

/* Mirrored as `FingerprintDigest` in `src/x509.ts`. */
enum { kFingerprintSha1 = 0, kFingerprintSha256 = 1, kFingerprintSha512 = 2 };

/* `X509View::getFingerprint`: the digest of the DER, upper-case hex pairs
 * joined by colons. */
NtsString *nts_crypto_x509_fingerprint(double handle, double digest) {
    X509 *cert = certificate_at(handle);
    const EVP_MD *md = digest == kFingerprintSha1     ? EVP_sha1()
                       : digest == kFingerprintSha256 ? EVP_sha256()
                                                      : EVP_sha512();
    unsigned char bytes[EVP_MAX_MD_SIZE];
    unsigned size = 0;
    bool ok = cert != NULL && X509_digest(cert, md, bytes, &size) == 1 && size > 0;
    ERR_clear_error();
    if (!ok) return NULL;
    static const char hex[] = "0123456789ABCDEF";
    char text[EVP_MAX_MD_SIZE * 3];
    for (unsigned i = 0; i < size; i++) {
        text[3 * i] = hex[bytes[i] >> 4];
        text[3 * i + 1] = hex[bytes[i] & 0x0f];
        text[3 * i + 2] = ':';
    }
    return nts_string_from_utf8(text, size * 3 - 1);
}

/* `X509View::enumUsages`: the extended key usages' OIDs, or NULL without the
 * extension. */
NtsArray *nts_crypto_x509_key_usage(double handle) {
    X509 *cert = certificate_at(handle);
    STACK_OF(ASN1_OBJECT) *usages = cert == NULL ? NULL : X509_get_ext_d2i(cert, NID_ext_key_usage, NULL, NULL);
    ERR_clear_error();
    if (usages == NULL) return NULL;
    NtsArray *result = nts_array_new(&nts_desc_ref, 0);
    for (int i = 0; i < sk_ASN1_OBJECT_num(usages); i++) {
        char text[256];
        if (OBJ_obj2txt(text, sizeof(text), sk_ASN1_OBJECT_value(usages, i), 1) >= 0) {
            nts_array_push_ref(result, nts_string_from_utf8(text, strlen(text)));
        }
    }
    sk_ASN1_OBJECT_pop_free(usages, ASN1_OBJECT_free);
    return result;
}

/* `X509View::getSerialNumber`: upper-case hex, as `BN_bn2hex` writes it. */
NtsString *nts_crypto_x509_serial_number(double handle) {
    X509 *cert = certificate_at(handle);
    const ASN1_INTEGER *serial = cert == NULL ? NULL : X509_get0_serialNumber(cert);
    BIGNUM *number = serial == NULL ? NULL : ASN1_INTEGER_to_BN(serial, NULL);
    NtsString *text = number == NULL ? NULL : take_cstring(BN_bn2hex(number));
    BN_free(number);
    ERR_clear_error();
    return text;
}

/* `X509View::toPEM`. */
NtsString *nts_crypto_x509_pem(double handle) {
    X509 *cert = certificate_at(handle);
    BIO *bio = cert == NULL ? NULL : BIO_new(BIO_s_mem());
    if (bio != NULL && PEM_write_bio_X509(bio, cert) <= 0) {
        BIO_free(bio);
        bio = NULL;
    }
    ERR_clear_error();
    return bio_take_string(bio);
}

/* A memory BIO's contents as bytes, and the BIO freed. */
static NtsView *bio_take_bytes(BIO *bio) {
    if (bio == NULL) return NULL;
    BUF_MEM *mem = NULL;
    BIO_get_mem_ptr(bio, &mem);
    NtsView *bytes = mem == NULL ? NULL : nts_view_from_bytes((const unsigned char *)mem->data, (double)mem->length);
    BIO_free(bio);
    return bytes;
}

/* `X509View::toDER`. */
NtsView *nts_crypto_x509_raw(double handle) {
    X509 *cert = certificate_at(handle);
    BIO *bio = cert == NULL ? NULL : BIO_new(BIO_s_mem());
    if (bio != NULL && i2d_X509_bio(bio, cert) <= 0) {
        BIO_free(bio);
        bio = NULL;
    }
    ERR_clear_error();
    return bio_take_bytes(bio);
}

/* `X509View::getPublicKey`: a key handle, or 0 with the cause recorded --
 * a subject public key OpenSSL cannot decode. */
double nts_crypto_x509_public_key(double handle) {
    X509 *cert = certificate_at(handle);
    ERR_clear_error();
    EVP_PKEY *pkey = cert == NULL ? NULL : X509_get_pubkey(cert);
    if (pkey == NULL) {
        nts_crypto_record_failure();
        return 0;
    }
    return nts_crypto_key_claim(pkey);
}

/* `X509View::isCA`. */
bool nts_crypto_x509_check_ca(double handle) {
    X509 *cert = certificate_at(handle);
    bool ca = cert != NULL && X509_check_ca(cert) == 1;
    ERR_clear_error();
    return ca;
}

/* `X509View::isIssuedBy`. */
bool nts_crypto_x509_check_issued(double handle, double issuer) {
    X509 *cert = certificate_at(handle);
    X509 *by = certificate_at(issuer);
    bool issued = cert != NULL && by != NULL && X509_check_issued(by, cert) == X509_V_OK;
    ERR_clear_error();
    return issued;
}

/* `X509View::checkPrivateKey`. */
bool nts_crypto_x509_check_private_key(double handle, double key) {
    X509 *cert = certificate_at(handle);
    EVP_PKEY *pkey = nts_crypto_key_at(key);
    bool matches = cert != NULL && pkey != NULL && X509_check_private_key(cert, pkey) == 1;
    ERR_clear_error();
    return matches;
}

/* `X509View::checkPublicKey`: whether the key verifies the signature. */
bool nts_crypto_x509_verify(double handle, double key) {
    X509 *cert = certificate_at(handle);
    EVP_PKEY *pkey = nts_crypto_key_at(key);
    bool verified = cert != NULL && pkey != NULL && X509_verify(cert, pkey) == 1;
    ERR_clear_error();
    return verified;
}

/* Mirrored as `SubjectKind` and `CheckMatch` in `src/x509.ts`. */
enum { kCheckHost = 0, kCheckEmail = 1, kCheckIp = 2 };
enum { kMatch = 1, kNoMatch = 0, kInvalidName = -2, kOperationFailed = -1 };

/* `X509_check_host`, `_email` and `_ip_asc`, the first two over the name's
 * bytes and length -- a NUL inside it is an invalid name -- and the third over
 * a C string, as ncrypto passes each. `peer` receives what a host matched. */
static int check_subject(X509 *cert, double kind, const char *name, size_t length, unsigned flags, char **peer) {
    if (kind == kCheckHost) return X509_check_host(cert, name, length, flags, peer);
    if (kind == kCheckEmail) return X509_check_email(cert, name, length, flags);
    return X509_check_ip_asc(cert, name, flags);
}

static int check_status(int result) {
    switch (result) {
    case 0: return kNoMatch;
    case 1: return kMatch;
    case -2: return kInvalidName;
    default: return kOperationFailed;
    }
}

/* `CheckX509Subject`'s outcome for `checkHost`, `checkEmail` or `checkIP`. */
double nts_crypto_x509_check(double handle, double kind, NtsString *subject, double flags) {
    X509 *cert = certificate_at(handle);
    size_t length = 0;
    char *name = cert == NULL ? NULL : nts_node_to_utf8_alloc(subject, &length);
    int result = name == NULL ? kNoMatch : check_status(check_subject(cert, kind, name, length, (unsigned)flags, NULL));
    free(name);
    ERR_clear_error();
    return result;
}

/* The subject name a host matched, which `checkHost` answers in place of the
 * name it was asked -- NULL where OpenSSL names none. */
NtsString *nts_crypto_x509_matched_host(double handle, NtsString *subject, double flags) {
    X509 *cert = certificate_at(handle);
    size_t length = 0;
    char *name = cert == NULL ? NULL : nts_node_to_utf8_alloc(subject, &length);
    char *peer = NULL;
    if (name != NULL) X509_check_host(cert, name, length, (unsigned)flags, &peer);
    free(name);
    ERR_clear_error();
    return take_cstring(peer);
}

/* -------------------------------------------------- the legacy object */

/* node's `GetX509NameObject`, flat: each entry's short name -- or its OID,
 * for one OpenSSL does not know -- then its value as UTF-8. */
NtsArray *nts_crypto_x509_name_entries(double handle, bool issuer) {
    X509 *cert = certificate_at(handle);
    NtsArray *result = nts_array_new(&nts_desc_ref, 0);
    const X509_NAME *name = cert == NULL ? NULL : issuer ? X509_get_issuer_name(cert) : X509_get_subject_name(cert);
    int count = name == NULL ? 0 : X509_NAME_entry_count(name);
    for (int i = 0; i < count; i++) {
        const X509_NAME_ENTRY *entry = X509_NAME_get_entry(name, i);
        const ASN1_OBJECT *object = entry == NULL ? NULL : X509_NAME_ENTRY_get_object(entry);
        const ASN1_STRING *value = entry == NULL ? NULL : X509_NAME_ENTRY_get_data(entry);
        if (object == NULL || value == NULL) continue;
        int nid = OBJ_obj2nid(object);
        char text[80];
        if (nid != NID_undef) {
            snprintf(text, sizeof(text), "%s", OBJ_nid2sn(nid));
        } else {
            OBJ_obj2txt(text, sizeof(text), object, 0);
        }
        unsigned char *utf8 = NULL;
        int length = ASN1_STRING_to_UTF8(&utf8, value);
        nts_array_push_ref(result, nts_string_from_utf8(text, strlen(text)));
        nts_array_push_ref(result, nts_string_from_utf8((const char *)utf8, length < 0 ? 0 : (size_t)length));
        OPENSSL_free(utf8);
    }
    ERR_clear_error();
    return result;
}

/* Mirrored as `LegacyKeyFamily` in `src/x509.ts`: which of `X509View::ifRsa`
 * and `ifEc` a certificate's key takes. */
enum { kLegacyOther = 0, kLegacyRsa = 1, kLegacyEc = 2 };

static EVP_PKEY *public_key_of(double handle) {
    X509 *cert = certificate_at(handle);
    return cert == NULL ? NULL : X509_get0_pubkey(cert);
}

static BIGNUM *bn_param(const EVP_PKEY *pkey, const char *name) {
    BIGNUM *value = NULL;
    return pkey != NULL && EVP_PKEY_get_bn_param(pkey, name, &value) == 1 ? value : NULL;
}

/* An EC key's group, as ncrypto's `Ec` finds it: by the group's name, which
 * must name a curve, and only with a public point to go with it. */
static int ec_curve_of(const EVP_PKEY *pkey) {
    char group[80];
    size_t length = 0;
    if (EVP_PKEY_get_utf8_string_param(pkey, OSSL_PKEY_PARAM_GROUP_NAME, group, sizeof(group), NULL) != 1 ||
        EVP_PKEY_get_octet_string_param(pkey, OSSL_PKEY_PARAM_PUB_KEY, NULL, 0, &length) != 1 || length == 0) {
        return NID_undef;
    }
    return nts_crypto_curve_nid(group);
}

double nts_crypto_x509_legacy_family(double handle) {
    EVP_PKEY *pkey = public_key_of(handle);
    int family = kLegacyOther;
    if (pkey != NULL) {
        switch (nts_crypto_key_id(pkey)) {
        case EVP_PKEY_RSA:
        case EVP_PKEY_RSA2:
        case EVP_PKEY_RSA_PSS: {
            /* ncrypto's `Rsa` wants both halves of the public key. */
            BIGNUM *n = bn_param(pkey, OSSL_PKEY_PARAM_RSA_N);
            BIGNUM *e = bn_param(pkey, OSSL_PKEY_PARAM_RSA_E);
            if (n != NULL && e != NULL) family = kLegacyRsa;
            BN_free(n);
            BN_free(e);
            break;
        }
        case EVP_PKEY_EC:
            if (ec_curve_of(pkey) != NID_undef) family = kLegacyEc;
            break;
        default: break;
        }
    }
    ERR_clear_error();
    return family;
}

/* `GetModulusString` and `GetExponentString`: `BN_print`'s upper-case hex,
 * the exponent's after "0x". */
NtsString *nts_crypto_x509_rsa_number(double handle, bool exponent) {
    BIGNUM *value = bn_param(public_key_of(handle), exponent ? OSSL_PKEY_PARAM_RSA_E : OSSL_PKEY_PARAM_RSA_N);
    BIO *bio = value == NULL ? NULL : BIO_new(BIO_s_mem());
    if (bio != NULL && ((exponent && BIO_puts(bio, "0x") <= 0) || !BN_print(bio, value))) {
        BIO_free(bio);
        bio = NULL;
    }
    BN_free(value);
    ERR_clear_error();
    return bio_take_string(bio);
}

/* ncrypto's `EncodeRsaPssParams`: an RSA-PSS key's restrictions as the
 * `RSASSA-PSS-params` SEQUENCE, each field at its default left out. ncrypto
 * reads them from the key's DER; OpenSSL's parameters are the same fields,
 * present exactly when the key is restricted. */
static ASN1_STRING *encode_pss_params(const EVP_PKEY *pkey) {
    char digest_name[80];
    char mgf1_name[80];
    int salt_length = 20;
    if (EVP_PKEY_get_utf8_string_param(pkey, OSSL_PKEY_PARAM_RSA_DIGEST, digest_name, sizeof(digest_name), NULL) !=
        1) {
        return NULL;
    }
    if (EVP_PKEY_get_utf8_string_param(pkey, OSSL_PKEY_PARAM_RSA_MGF1_DIGEST, mgf1_name, sizeof(mgf1_name), NULL) !=
        1) {
        snprintf(mgf1_name, sizeof(mgf1_name), "SHA1");
    }
    EVP_PKEY_get_int_param(pkey, OSSL_PKEY_PARAM_RSA_PSS_SALTLEN, &salt_length);
    const EVP_MD *digest = EVP_get_digestbyname(digest_name);
    const EVP_MD *mgf1 = EVP_get_digestbyname(mgf1_name);
    RSA_PSS_PARAMS *pss = digest == NULL || mgf1 == NULL ? NULL : RSA_PSS_PARAMS_new();
    if (pss == NULL) return NULL;
    bool ok = true;
    if (!EVP_MD_is_a(digest, "SHA1")) {
        pss->hashAlgorithm = X509_ALGOR_new();
        ok = pss->hashAlgorithm != NULL;
        if (ok) X509_ALGOR_set_md(pss->hashAlgorithm, digest);
    }
    if (ok && !EVP_MD_is_a(mgf1, "SHA1")) {
        X509_ALGOR *hash = X509_ALGOR_new();
        ASN1_STRING *hash_der = NULL;
        if (hash != NULL) {
            X509_ALGOR_set_md(hash, mgf1);
            hash_der = ASN1_item_pack(hash, ASN1_ITEM_rptr(X509_ALGOR), NULL);
        }
        X509_ALGOR_free(hash);
        pss->maskGenAlgorithm = hash_der == NULL ? NULL : X509_ALGOR_new();
        ok = pss->maskGenAlgorithm != NULL &&
             X509_ALGOR_set0(pss->maskGenAlgorithm, OBJ_nid2obj(NID_mgf1), V_ASN1_SEQUENCE, hash_der) == 1;
        if (!ok) ASN1_STRING_free(hash_der);
    }
    if (ok && salt_length != 20) {
        pss->saltLength = ASN1_INTEGER_new();
        ok = pss->saltLength != NULL && ASN1_INTEGER_set_int64(pss->saltLength, salt_length) == 1;
    }
    ASN1_STRING *encoded = ok ? ASN1_item_pack(pss, ASN1_ITEM_rptr(RSA_PSS_PARAMS), NULL) : NULL;
    RSA_PSS_PARAMS_free(pss);
    return encoded;
}

/* ncrypto's `Rsa::derPublicKey`: an RSA key's SPKI; an RSA-PSS key's is its
 * modulus and exponent under `rsaEncryption`'s OID, carrying the PSS
 * restrictions as that OID's parameters, or none. */
static BIO *rsa_der_public_key(const EVP_PKEY *pkey) {
    BIGNUM *n = bn_param(pkey, OSSL_PKEY_PARAM_RSA_N);
    BIGNUM *e = bn_param(pkey, OSSL_PKEY_PARAM_RSA_E);
    OSSL_PARAM_BLD *build = n == NULL || e == NULL ? NULL : OSSL_PARAM_BLD_new();
    OSSL_PARAM *params = build != NULL && OSSL_PARAM_BLD_push_BN(build, OSSL_PKEY_PARAM_RSA_N, n) == 1 &&
                                 OSSL_PARAM_BLD_push_BN(build, OSSL_PKEY_PARAM_RSA_E, e) == 1
                             ? OSSL_PARAM_BLD_to_param(build)
                             : NULL;
    EVP_PKEY_CTX *ctx = params == NULL ? NULL : EVP_PKEY_CTX_new_from_name(NULL, "RSA", NULL);
    EVP_PKEY *rsa = NULL;
    if (ctx != NULL && EVP_PKEY_fromdata_init(ctx) == 1) EVP_PKEY_fromdata(ctx, &rsa, EVP_PKEY_PUBLIC_KEY, params);
    EVP_PKEY_CTX_free(ctx);
    OSSL_PARAM_free(params);
    OSSL_PARAM_BLD_free(build);
    BN_free(n);
    BN_free(e);
    BIO *bio = rsa == NULL ? NULL : BIO_new(BIO_s_mem());
    bool ok = bio != NULL;
    if (ok && EVP_PKEY_get_base_id(pkey) != EVP_PKEY_RSA_PSS) {
        ok = i2d_PUBKEY_bio(bio, rsa) == 1;
    } else if (ok) {
        X509_PUBKEY *pubkey = NULL;
        ok = X509_PUBKEY_set(&pubkey, rsa) == 1;
        ASN1_STRING *parameters = ok ? encode_pss_params(pkey) : NULL;
        ok = ok && X509_PUBKEY_set0_param(pubkey, OBJ_nid2obj(NID_rsaEncryption),
                                          parameters == NULL ? V_ASN1_UNDEF : V_ASN1_SEQUENCE, parameters, NULL,
                                          0) == 1;
        if (!ok) ASN1_STRING_free(parameters);
        ok = ok && i2d_X509_PUBKEY_bio(bio, pubkey) == 1;
        X509_PUBKEY_free(pubkey);
    }
    EVP_PKEY_free(rsa);
    if (!ok) {
        BIO_free(bio);
        bio = NULL;
    }
    return bio;
}

/* The legacy object's `pubkey`: an RSA key's DER, or an EC key's point in
 * the form the certificate encodes it. */
NtsView *nts_crypto_x509_legacy_public_key(double handle) {
    EVP_PKEY *pkey = public_key_of(handle);
    NtsView *result = NULL;
    double family = nts_crypto_x509_legacy_family(handle);
    if (family == kLegacyRsa) {
        result = bio_take_bytes(rsa_der_public_key(pkey));
    } else if (family == kLegacyEc) {
        size_t length = 0;
        EVP_PKEY_get_octet_string_param(pkey, OSSL_PKEY_PARAM_PUB_KEY, NULL, 0, &length);
        unsigned char *point = malloc(length == 0 ? 1 : length);
        if (point != NULL &&
            EVP_PKEY_get_octet_string_param(pkey, OSSL_PKEY_PARAM_PUB_KEY, point, length, &length) == 1) {
            result = nts_view_from_bytes(point, (double)length);
        }
        free(point);
    }
    ERR_clear_error();
    return result;
}

/* The legacy object's `bits`: an RSA modulus's, an EC group order's; -1 for
 * none. */
double nts_crypto_x509_legacy_bits(double handle) {
    EVP_PKEY *pkey = public_key_of(handle);
    double family = nts_crypto_x509_legacy_family(handle);
    int bits = -1;
    if (family == kLegacyRsa) {
        BIGNUM *n = bn_param(pkey, OSSL_PKEY_PARAM_RSA_N);
        bits = n == NULL ? -1 : BN_num_bits(n);
        BN_free(n);
    } else if (family == kLegacyEc) {
        EC_GROUP *group = EC_GROUP_new_by_curve_name(ec_curve_of(pkey));
        bits = group == NULL ? -1 : EC_GROUP_order_bits(group);
        EC_GROUP_free(group);
        if (bits <= 0) bits = -1;
    }
    ERR_clear_error();
    return bits;
}

/* The legacy object's `asn1Curve` and `nistCurve`: an EC key's curve by its
 * short name and its NIST name, or NULL for a name it has not. */
NtsString *nts_crypto_x509_legacy_curve(double handle, bool nist) {
    EVP_PKEY *pkey = public_key_of(handle);
    int nid = nts_crypto_x509_legacy_family(handle) == kLegacyEc ? ec_curve_of(pkey) : NID_undef;
    ERR_clear_error();
    const char *name = nid == NID_undef ? NULL : nist ? EC_curve_nid2nist(nid) : OBJ_nid2sn(nid);
    return name == NULL || name[0] == '\0' ? NULL : nts_string_from_utf8(name, strlen(name));
}
