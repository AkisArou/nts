/* The native half of `node:crypto`: node's `src/crypto/crypto_hash.cc`,
 * `crypto_hmac.cc`, `crypto_pbkdf2.cc`, `crypto_hkdf.cc`, `crypto_scrypt.cc`,
 * `crypto_random.cc` and `crypto_timing.cc`, over OpenSSL 3, for this
 * profile's seam. See `nts_crypto.h` for the contract and `src/native.d.ts`
 * for the declarations.
 *
 * What is node's here is every decision a program can observe: which name
 * reaches which `EVP_MD`, how an XOF's default length is chosen, when an
 * invalid output length is refused, the empty-key rule for HMAC, the zero salt
 * for HKDF, and the order in which OpenSSL's errors are read. */
#include <openssl/crypto.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/kdf.h>
#include <openssl/core_names.h>
#include <openssl/params.h>
#include <openssl/rand.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>
#include "crypto_internal.h"
#include "nts_crypto.h"
#include "shared.h"

/* ------------------------------------------------------------ error record */

/* What OpenSSL's queue held at the last failure, read the way node reads it.
 *
 * `errors` is oldest first. Node's `ThrowCryptoError` takes the oldest with
 * `ERR_get_error()` for the message and decorates the exception from it --
 * `library`, `reason`, and a `code` built from both -- and its
 * `CryptoErrorStore` reads the rest into `opensslErrorStack`, newest first.
 * The TypeScript does that assembly; this keeps the raw material, including
 * the decoration, because only OpenSSL can say which library an error came
 * from. */
typedef struct {
    char **errors;
    size_t count;
    char library[64];
    char reason[128];
    char code[160];
} ErrorRecord;

static ErrorRecord last_error;

static void record_clear(ErrorRecord *record) {
    for (size_t i = 0; i < record->count; i++) free(record->errors[i]);
    free(record->errors);
    memset(record, 0, sizeof(*record));
}

/* Node's `Decorate`: the library prefix it knows by name, and nothing for one
 * it does not, so the code reads `ERR_OSSL_<REASON>` there. */
static const char *library_prefix(int library) {
    switch (library) {
    case ERR_LIB_SYS: return "SYS_";
    case ERR_LIB_BN: return "BN_";
    case ERR_LIB_RSA: return "RSA_";
    case ERR_LIB_DH: return "DH_";
    case ERR_LIB_EVP: return "EVP_";
    case ERR_LIB_BUF: return "BUF_";
    case ERR_LIB_OBJ: return "OBJ_";
    case ERR_LIB_PEM: return "PEM_";
    case ERR_LIB_DSA: return "DSA_";
    case ERR_LIB_X509: return "X509_";
    case ERR_LIB_ASN1: return "ASN1_";
    case ERR_LIB_CONF: return "CONF_";
    case ERR_LIB_CRYPTO: return "CRYPTO_";
    case ERR_LIB_EC: return "EC_";
    case ERR_LIB_SSL: return "SSL_";
    case ERR_LIB_BIO: return "BIO_";
    case ERR_LIB_PKCS7: return "PKCS7_";
    case ERR_LIB_X509V3: return "X509V3_";
    case ERR_LIB_RAND: return "RAND_";
    case ERR_LIB_ENGINE: return "ENGINE_";
    case ERR_LIB_OCSP: return "OCSP_";
    case ERR_LIB_UI: return "UI_";
    case ERR_LIB_COMP: return "COMP_";
    case ERR_LIB_ECDSA: return "ECDSA_";
    case ERR_LIB_ECDH: return "ECDH_";
    case ERR_LIB_CMS: return "CMS_";
    case ERR_LIB_HMAC: return "HMAC_";
    case ERR_LIB_USER: return "USER_";
    case ERR_LIB_PKCS12: return "PKCS12_";
    case ERR_LIB_DSO: return "DSO_";
    case ERR_LIB_OSSL_STORE: return "OSSL_STORE_";
    case ERR_LIB_FIPS: return "FIPS_";
    case ERR_LIB_TS: return "TS_";
    case ERR_LIB_CT: return "CT_";
    case ERR_LIB_ASYNC: return "ASYNC_";
    case ERR_LIB_KDF: return "KDF_";
    case ERR_LIB_SM2: return "SM2_";
    default: return "";
    }
}

/* Drain this thread's queue into `record`. Callable from a pool thread: the
 * queue is per thread, which is why a job captures where it failed and hands
 * the record home rather than leaving the loop thread to look. */
static void record_capture(ErrorRecord *record) {
    record_clear(record);
    unsigned long first = ERR_peek_error();
    if (first != 0) {
        const char *library = ERR_lib_error_string(first);
        const char *reason = ERR_reason_error_string(first);
        if (library != NULL) snprintf(record->library, sizeof(record->library), "%s", library);
        if (reason != NULL) {
            snprintf(record->reason, sizeof(record->reason), "%s", reason);
            char upper[128];
            size_t i = 0;
            for (; reason[i] != '\0' && i + 1 < sizeof(upper); i++) {
                char c = reason[i];
                upper[i] = c == ' ' ? '_' : (c >= 'a' && c <= 'z' ? (char)(c - 32) : c);
            }
            upper[i] = '\0';
            const char *lib = library_prefix(ERR_GET_LIB(first));
            /* "Don't generate codes like ERR_OSSL_SSL_." */
            const char *prefix = strcmp(lib, "SSL_") == 0 ? "" : "OSSL_";
            snprintf(record->code, sizeof(record->code), "ERR_%s%s%s", prefix, lib, upper);
        }
    }
    unsigned long error;
    while ((error = ERR_get_error()) != 0) {
        char text[256];
        ERR_error_string_n(error, text, sizeof(text));
        char **grown = realloc(record->errors, (record->count + 1) * sizeof(char *));
        if (grown == NULL) break;
        record->errors = grown;
        record->errors[record->count] = strdup(text);
        if (record->errors[record->count] == NULL) break;
        record->count++;
    }
}

static void record_move(ErrorRecord *into, ErrorRecord *from) {
    record_clear(into);
    *into = *from;
    memset(from, 0, sizeof(*from));
}

/* A failure on the loop thread, recorded for the TypeScript to take. */
void nts_crypto_record_failure(void) { record_capture(&last_error); }

static void fail(void) { nts_crypto_record_failure(); }

static NtsString *text(const char *value) {
    return nts_string_from_utf8(value, strlen(value));
}

NtsArray *nts_crypto_take_errors(void) {
    NtsArray *array = nts_array_new(&nts_desc_ref, (double)(3 + last_error.count));
    void **items = NTS_ITEMS(array, void *);
    items[0] = text(last_error.library);
    items[1] = text(last_error.reason);
    items[2] = text(last_error.code);
    for (size_t i = 0; i < last_error.count; i++) items[3 + i] = text(last_error.errors[i]);
    record_clear(&last_error);
    return array;
}

/* -------------------------------------------------------------- the digests */

/* Every name asked for, mapped to the `EVP_MD` it resolved to.
 *
 * Node's `FetchAndMaybeCacheMD`: resolve the name the legacy way, which knows
 * every alias, then fetch the canonical name explicitly -- an implicit
 * `EVP_MD` makes each `EVP_DigestInit_ex` fetch again, which is most of the
 * cost of a short hash. A name that resolves but will not fetch keeps its
 * implicit `EVP_MD`, as node's does, so that initialising it fails with
 * OpenSSL's own reason (`unsupported`) rather than a claim that the name is
 * unknown. */
typedef struct {
    char *name;
    const EVP_MD *md;
    EVP_MD *owned;
} Digest;

static Digest *digests;
static size_t digest_count;

/* ncrypto's `getDigestByName`: "dss1" is SHA-1 under a DSA name that the
 * public API has always accepted and OpenSSL 3 no longer does. */
static const EVP_MD *legacy_digest(const char *name) {
    if (strcmp(name, "dss1") == 0 || strcmp(name, "DSS1") == 0) return EVP_sha1();
    return EVP_get_digestbyname(name);
}

static int digest_lookup(const char *name) {
    for (size_t i = 0; i < digest_count; i++) {
        if (strcmp(digests[i].name, name) == 0) return (int)i;
    }
    const EVP_MD *implicit = legacy_digest(name);
    if (implicit == NULL) return -1;
    EVP_MD *explicit_md = NULL;
    const char *canonical = EVP_MD_get0_name(implicit);
    if (canonical != NULL) {
        /* A probe, so whatever it pushes is not the program's error. Node's
         * does not mark it, so for a name that resolves but will not fetch --
         * `md4` without the legacy provider -- its `opensslErrorStack` carries
         * this probe's `unsupported` as well as the failed initialisation's.
         * Nothing reads that entry, and a stack that describes the one failure
         * is the better report. */
        ERR_set_mark();
        explicit_md = EVP_MD_fetch(NULL, canonical, NULL);
        ERR_pop_to_mark();
    }
    Digest *grown = realloc(digests, (digest_count + 1) * sizeof(Digest));
    char *copy = strdup(name);
    if (grown == NULL || copy == NULL) {
        if (grown != NULL) digests = grown;
        free(copy);
        EVP_MD_free(explicit_md);
        return -1;
    }
    digests = grown;
    digests[digest_count] = (Digest){
        .name = copy,
        .md = explicit_md != NULL ? explicit_md : implicit,
        .owned = explicit_md,
    };
    return (int)digest_count++;
}

static const EVP_MD *digest_at(double id) {
    if (id < 0 || id >= (double)digest_count) return NULL;
    return digests[(size_t)id].md;
}

const EVP_MD *nts_crypto_digest_at(double id) { return digest_at(id); }

double nts_crypto_digest_id(NtsString *name) {
    size_t length = 0;
    char *utf8 = nts_node_to_utf8_alloc(name, &length);
    if (utf8 == NULL) return -1;
    int id = digest_lookup(utf8);
    free(utf8);
    return (double)id;
}

double nts_crypto_digest_size(double id) {
    const EVP_MD *md = digest_at(id);
    return md == NULL ? 0 : (double)EVP_MD_get_size(md);
}

static bool is_xof(const EVP_MD *md) { return (EVP_MD_get_flags(md) & EVP_MD_FLAG_XOF) != 0; }

bool nts_crypto_digest_is_xof(double id) {
    const EVP_MD *md = digest_at(id);
    return md != NULL && is_xof(md);
}

/* OpenSSL 3.4 gave SHAKE128/256 no default length; node keeps the lengths
 * they had before (DEP0198), and so does this. */
static size_t shake_default(const EVP_MD *md) {
    const char *name = OBJ_nid2sn(EVP_MD_get_type(md));
    if (name == NULL) return 0;
    if (strcmp(name, "SHAKE128") == 0) return 16;
    if (strcmp(name, "SHAKE256") == 0) return 32;
    return 0;
}

typedef struct {
    NtsArray *names;
    size_t count;
} NameList;

static void collect_name(const EVP_MD *md, const char *from, const char *to, void *arg) {
    (void)md;
    (void)to;
    if (from == NULL) return;
    /* Node's filter: listed only if an explicit fetch would succeed, which
     * leaves out digests OpenSSL uses internally and legacy ones no loaded
     * provider implements. */
    int id = digest_lookup(from);
    if (id < 0 || digests[id].owned == NULL) return;
    NameList *list = arg;
    nts_array_push_ref(list->names, text(from));
    list->count++;
}

NtsArray *nts_crypto_hash_names(void) {
    NameList list = {.names = nts_array_new(&nts_desc_ref, 0), .count = 0};
    ERR_set_mark();
    EVP_MD_do_all_sorted(collect_name, &list);
    ERR_pop_to_mark();
    return list.names;
}

/* ------------------------------------------------------------- contexts */

typedef enum { CONTEXT_FREE = 0, CONTEXT_HASH, CONTEXT_HMAC } ContextKind;

typedef struct {
    ContextKind kind;
    EVP_MD_CTX *md;
    EVP_MAC_CTX *mac;
    const EVP_MD *digest;
    size_t length;
} Context;

static Context *contexts;
static size_t context_capacity;
static size_t context_free_hint;

static double context_claim(Context value) {
    size_t index = context_free_hint;
    while (index < context_capacity && contexts[index].kind != CONTEXT_FREE) index++;
    if (index == context_capacity) {
        size_t grown = context_capacity == 0 ? 16 : context_capacity * 2;
        Context *moved = realloc(contexts, grown * sizeof(Context));
        if (moved == NULL) return 0;
        memset(moved + context_capacity, 0, (grown - context_capacity) * sizeof(Context));
        contexts = moved;
        context_capacity = grown;
    }
    contexts[index] = value;
    context_free_hint = index + 1;
    return (double)(index + 1);
}

static Context *context_at(double handle) {
    if (handle < 1 || handle > (double)context_capacity) return NULL;
    Context *context = &contexts[(size_t)handle - 1];
    return context->kind == CONTEXT_FREE ? NULL : context;
}

static void context_free(Context *context) {
    EVP_MD_CTX_free(context->md);
    EVP_MAC_CTX_free(context->mac);
    size_t index = (size_t)(context - contexts);
    memset(context, 0, sizeof(*context));
    if (index < context_free_hint) context_free_hint = index;
}

/* Node's `Hash::HashInit`. A negative `xof_length` is "not given". */
static EVP_MD_CTX *hash_init(const EVP_MD *md, double xof_length, size_t *length) {
    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    if (ctx == NULL || EVP_DigestInit_ex(ctx, md, NULL) != 1) {
        EVP_MD_CTX_free(ctx);
        return NULL;
    }
    size_t size = (size_t)EVP_MD_get_size(md);
    if (is_xof(md) && xof_length < 0 && size == 0) size = shake_default(md);
    if (xof_length >= 0 && (size_t)xof_length != size) {
        /* "A little hack to cause createHash to fail when an incorrect
         * hashSize option was passed for a non-XOF hash function." */
        if (!is_xof(md)) {
            ERR_raise(ERR_LIB_EVP, EVP_R_NOT_XOF_OR_INVALID_LENGTH);
            EVP_MD_CTX_free(ctx);
            return NULL;
        }
        size = (size_t)xof_length;
    }
    *length = size;
    return ctx;
}

double nts_crypto_hash_new(double id, double xof_length) {
    ERR_clear_error();
    const EVP_MD *md = digest_at(id);
    size_t length = 0;
    EVP_MD_CTX *ctx = md == NULL ? NULL : hash_init(md, xof_length, &length);
    if (ctx == NULL) {
        fail();
        return 0;
    }
    double handle = context_claim(
        (Context){.kind = CONTEXT_HASH, .md = ctx, .digest = md, .length = length});
    if (handle == 0) EVP_MD_CTX_free(ctx);
    return handle;
}

double nts_crypto_hash_copy(double handle, double xof_length) {
    ERR_clear_error();
    Context *original = context_at(handle);
    if (original == NULL || original->kind != CONTEXT_HASH) return 0;
    size_t length = 0;
    EVP_MD_CTX *ctx = hash_init(original->digest, xof_length, &length);
    if (ctx == NULL) {
        fail();
        return 0;
    }
    if (EVP_MD_CTX_copy_ex(ctx, original->md) != 1) {
        EVP_MD_CTX_free(ctx);
        fail();
        return 0;
    }
    const EVP_MD *md = original->digest;
    double copy = context_claim(
        (Context){.kind = CONTEXT_HASH, .md = ctx, .digest = md, .length = length});
    if (copy == 0) EVP_MD_CTX_free(ctx);
    return copy;
}

/* Node's `Hmac::HmacInit`, over `EVP_MAC` rather than the deprecated
 * `HMAC_CTX`. An empty key is passed as a non-NULL pointer and a zero length:
 * `EVP_MAC_init` reads NULL as "keep the key from last time", and ncrypto
 * passes `""` for the same reason. */
double nts_crypto_hmac_new(double id, NtsView *key) {
    ERR_clear_error();
    static EVP_MAC *hmac;
    if (hmac == NULL) hmac = EVP_MAC_fetch(NULL, "HMAC", NULL);
    const EVP_MD *md = digest_at(id);
    EVP_MAC_CTX *ctx = hmac == NULL || md == NULL ? NULL : EVP_MAC_CTX_new(hmac);
    if (ctx == NULL) {
        fail();
        return 0;
    }
    OSSL_PARAM params[] = {
        OSSL_PARAM_construct_utf8_string(OSSL_MAC_PARAM_DIGEST,
                                         (char *)EVP_MD_get0_name(md), 0),
        OSSL_PARAM_construct_end(),
    };
    static const unsigned char empty[1] = {0};
    size_t key_length = (size_t)nts_view_byte_length(key);
    const unsigned char *key_bytes = key_length == 0 ? empty : nts_view_bytes(key);
    if (EVP_MAC_init(ctx, key_bytes, key_length, params) != 1) {
        EVP_MAC_CTX_free(ctx);
        fail();
        return 0;
    }
    double handle = context_claim((Context){.kind = CONTEXT_HMAC,
                                            .mac = ctx,
                                            .digest = md,
                                            .length = EVP_MAC_CTX_get_mac_size(ctx)});
    if (handle == 0) EVP_MAC_CTX_free(ctx);
    return handle;
}

static bool context_update(Context *context, const void *bytes, size_t length) {
    if (context->kind == CONTEXT_HASH) return EVP_DigestUpdate(context->md, bytes, length) == 1;
    return EVP_MAC_update(context->mac, bytes, length) == 1;
}

/* A refusal is recorded: `Sign#update` reports OpenSSL's cause, where `Hash`
 * and `Hmac` have words of their own. */
bool nts_crypto_update(double handle, NtsView *data) {
    ERR_clear_error();
    Context *context = context_at(handle);
    bool ok = context != NULL &&
              context_update(context, nts_view_bytes(data), (size_t)nts_view_byte_length(data));
    if (!ok) fail();
    return ok;
}

/* The common case -- `update(string)` with no encoding or with UTF-8 -- without
 * the `Buffer` the TypeScript would otherwise build to carry the bytes. */
bool nts_crypto_update_utf8(double handle, NtsString *data) {
    ERR_clear_error();
    Context *context = context_at(handle);
    size_t length = 0;
    char *utf8 = context == NULL ? NULL : nts_node_to_utf8_alloc(data, &length);
    bool ok = utf8 != NULL && context_update(context, utf8, length);
    free(utf8);
    if (!ok) fail();
    return ok;
}

/* Node's `HashDigest`/`HmacDigest`, which is the context's last operation:
 * the TypeScript keeps the bytes for a second reader (`_flush` and
 * `digest()` both read it, nodejs/node#28245). A zero-length XOF output
 * skips the finalisation, which segfaults on some platforms (openssl#9431). */
static bool context_finish(Context *context, unsigned char *out) {
    size_t length = context->length;
    if (length == 0) return true;
    if (context->kind == CONTEXT_HMAC) {
        size_t written = 0;
        return EVP_MAC_final(context->mac, out, &written, length) == 1;
    }
    if (is_xof(context->digest)) return EVP_DigestFinalXOF(context->md, out, length) == 1;
    return EVP_DigestFinal_ex(context->md, out, NULL) == 1;
}

NtsView *nts_crypto_final(double handle) {
    ERR_clear_error();
    Context *context = context_at(handle);
    if (context == NULL) return NULL;
    size_t length = context->length;
    unsigned char stack[EVP_MAX_MD_SIZE];
    unsigned char *out = length <= sizeof(stack) ? stack : malloc(length);
    bool ok = out != NULL && context_finish(context, out);
    NtsView *result = NULL;
    if (ok) {
        result = nts_view_from_bytes(out, (double)length);
    } else {
        fail();
    }
    if (out != stack) free(out);
    context_free(context);
    return result;
}

/* A hash finished for `sig.c`, which signs the digest rather than exposing it:
 * node's `Sign` is a `Hash` whose last step is a key operation. */
unsigned char *nts_crypto_hash_take(double handle, size_t *length, const EVP_MD **md) {
    Context *context = context_at(handle);
    if (context == NULL || context->kind != CONTEXT_HASH) return NULL;
    *length = context->length;
    *md = context->digest;
    unsigned char *out = malloc(*length == 0 ? 1 : *length);
    bool ok = out != NULL && context_finish(context, out);
    context_free(context);
    if (ok) return out;
    free(out);
    return NULL;
}

void nts_crypto_release(double handle) {
    Context *context = context_at(handle);
    if (context != NULL) context_free(context);
}

/* ----------------------------------------------------------- one-shot */

/* Node's `Hash::OneShotDigest`, after the TypeScript has refused an unknown
 * name and a length a non-XOF digest cannot produce. */
static NtsView *digest_bytes(double id, const void *bytes, size_t size, double length) {
    ERR_clear_error();
    const EVP_MD *md = digest_at(id);
    if (md == NULL) return NULL;
    size_t out_length = (size_t)EVP_MD_get_size(md);
    if (is_xof(md)) {
        if (length >= 0) {
            out_length = (size_t)length;
        } else if (out_length == 0) {
            out_length = shake_default(md);
        }
    }
    if (out_length == 0) return nts_view_from_bytes(NULL, 0);
    unsigned char stack[EVP_MAX_MD_SIZE];
    unsigned char *out = out_length <= sizeof(stack) ? stack : malloc(out_length);
    EVP_MD_CTX *ctx = out == NULL ? NULL : EVP_MD_CTX_new();
    bool ok = ctx != NULL && EVP_DigestInit_ex(ctx, md, NULL) == 1 &&
              EVP_DigestUpdate(ctx, bytes, size) == 1 &&
              (is_xof(md) ? EVP_DigestFinalXOF(ctx, out, out_length) == 1
                          : EVP_DigestFinal_ex(ctx, out, NULL) == 1);
    EVP_MD_CTX_free(ctx);
    NtsView *result = NULL;
    if (ok) {
        result = nts_view_from_bytes(out, (double)out_length);
    } else {
        fail();
    }
    if (out != stack) free(out);
    return result;
}

NtsView *nts_crypto_digest(double id, NtsView *input, double length) {
    return digest_bytes(id, nts_view_bytes(input), (size_t)nts_view_byte_length(input), length);
}

NtsView *nts_crypto_digest_utf8(double id, NtsString *input, double length) {
    size_t size = 0;
    char *utf8 = nts_node_to_utf8_alloc(input, &size);
    if (utf8 == NULL) return NULL;
    NtsView *result = digest_bytes(id, utf8, size, length);
    free(utf8);
    return result;
}

/* ------------------------------------------------------------ derivations */

/* ncrypto's `CSPRNG`: retry after a reseed for as long as the reseed works. */
static bool csprng(unsigned char *out, size_t size) {
    do {
        if (RAND_status() == 1 && RAND_bytes_ex(NULL, out, size, 0) == 1) return true;
    } while (RAND_poll() == 1);
    return false;
}

static bool pbkdf2(const unsigned char *password, size_t password_length,
                   const unsigned char *salt, size_t salt_length, int iterations,
                   const EVP_MD *md, unsigned char *out, size_t length) {
    /* A zero-length key is a failure with nothing queued -- "Deriving bits
     * failed" -- because ncrypto's zero-byte allocation is falsy and node
     * reads that as the derivation failing. HKDF is the same; scrypt checks
     * for zero first and answers empty. Measured against node v24.20.0. */
    if (length == 0) return false;
    return PKCS5_PBKDF2_HMAC((const char *)password, (int)password_length, salt,
                             (int)salt_length, iterations, md, (int)length, out) == 1;
}

/* ncrypto's `hkdf`: extract-and-expand, with the RFC 5869 salt of `HashLen`
 * zeros when the caller gave none. */
static bool hkdf(const EVP_MD *md, const unsigned char *key, size_t key_length,
                 const unsigned char *salt, size_t salt_length, const unsigned char *info,
                 size_t info_length, unsigned char *out, size_t length) {
    /* As `pbkdf2`: zero is a failure with nothing queued. */
    if (length == 0) return false;
    static const unsigned char zeros[EVP_MAX_MD_SIZE] = {0};
    if (salt_length == 0) {
        salt = zeros;
        salt_length = (size_t)EVP_MD_get_size(md);
    }
    EVP_KDF *kdf = EVP_KDF_fetch(NULL, "HKDF", NULL);
    EVP_KDF_CTX *ctx = kdf == NULL ? NULL : EVP_KDF_CTX_new(kdf);
    EVP_KDF_free(kdf);
    if (ctx == NULL) return false;
    static const unsigned char empty[1] = {0};
    OSSL_PARAM params[] = {
        OSSL_PARAM_construct_utf8_string(OSSL_KDF_PARAM_DIGEST, (char *)EVP_MD_get0_name(md), 0),
        OSSL_PARAM_construct_octet_string(OSSL_KDF_PARAM_KEY,
                                          (void *)(key_length == 0 ? empty : key), key_length),
        OSSL_PARAM_construct_octet_string(OSSL_KDF_PARAM_SALT, (void *)salt, salt_length),
        OSSL_PARAM_construct_octet_string(OSSL_KDF_PARAM_INFO,
                                          (void *)(info_length == 0 ? empty : info), info_length),
        OSSL_PARAM_construct_end(),
    };
    bool ok = EVP_KDF_derive(ctx, out, length, params) == 1;
    EVP_KDF_CTX_free(ctx);
    return ok;
}

static bool scrypt(const unsigned char *password, size_t password_length,
                   const unsigned char *salt, size_t salt_length, uint64_t n, uint64_t r,
                   uint64_t p, uint64_t maxmem, unsigned char *out, size_t length) {
    /* "It's useless, yes, but allowed via the API." */
    if (length == 0) return true;
    return EVP_PBE_scrypt((const char *)password, password_length, salt, salt_length, n, r, p,
                          maxmem, out, length) == 1;
}

bool nts_crypto_scrypt_valid(double n, double r, double p, double maxmem) {
    ERR_clear_error();
    bool ok = EVP_PBE_scrypt(NULL, 0, NULL, 0, (uint64_t)n, (uint64_t)r, (uint64_t)p,
                             (uint64_t)maxmem, NULL, 0) == 1;
    if (!ok) fail();
    return ok;
}

/* The synchronous forms: derive into a scratch buffer, hand it back as bytes. */
static NtsView *derived(bool ok, unsigned char *out, size_t length) {
    NtsView *result = NULL;
    if (ok) {
        result = nts_view_from_bytes(out, (double)length);
    } else {
        fail();
    }
    free(out);
    return result;
}

static unsigned char *scratch(size_t length) { return malloc(length == 0 ? 1 : length); }

#define VIEW(view) nts_view_bytes(view), (size_t)nts_view_byte_length(view)

bool nts_crypto_random_fill(NtsView *target, double offset, double size) {
    ERR_clear_error();
    unsigned char *bytes = nts_view_bytes(target);
    if (bytes == NULL) return size == 0;
    bool ok = csprng(bytes + (size_t)offset, (size_t)size);
    if (!ok) fail();
    return ok;
}

NtsView *nts_crypto_pbkdf2(NtsView *password, NtsView *salt, double iterations, double length,
                           double id) {
    ERR_clear_error();
    unsigned char *out = scratch((size_t)length);
    if (out == NULL) return NULL;
    return derived(pbkdf2(VIEW(password), VIEW(salt), (int)iterations, digest_at(id), out,
                          (size_t)length),
                   out, (size_t)length);
}

/* ncrypto's `checkHkdfLength`: HKDF-Expand makes at most 255 blocks, because
 * its counter is one byte starting at 1. Read from the `EVP_MD`, which
 * answers even where no digest can be fetched -- under FIPS mode, the bound
 * is still checked before the derivation fails. */
bool nts_crypto_hkdf_length_ok(double id, double length) {
    const EVP_MD *md = digest_at(id);
    return md != NULL && length <= 255.0 * (double)EVP_MD_get_size(md);
}

NtsView *nts_crypto_hkdf(double id, NtsView *key, NtsView *salt, NtsView *info, double length) {
    ERR_clear_error();
    unsigned char *out = scratch((size_t)length);
    if (out == NULL) return NULL;
    return derived(hkdf(digest_at(id), VIEW(key), VIEW(salt), VIEW(info), out, (size_t)length),
                   out, (size_t)length);
}

NtsView *nts_crypto_scrypt(NtsView *password, NtsView *salt, double n, double r, double p,
                           double maxmem, double length) {
    ERR_clear_error();
    unsigned char *out = scratch((size_t)length);
    if (out == NULL) return NULL;
    return derived(scrypt(VIEW(password), VIEW(salt), (uint64_t)n, (uint64_t)r, (uint64_t)p,
                          (uint64_t)maxmem, out, (size_t)length),
                   out, (size_t)length);
}

/* ------------------------------------------------------------------ jobs */

typedef enum { JOB_RANDOM, JOB_PBKDF2, JOB_HKDF, JOB_SCRYPT, JOB_WORK } JobKind;

/* One unit of pool work. Inputs are private copies; `target` is the one
 * program object held, retained, and only touched on the loop thread. A
 * `JOB_WORK` is another translation unit's, which owns `state`. */
typedef struct {
    uv_work_t request;
    JobKind kind;
    NtsCryptoWork work;
    void (*dispose)(void *state);
    void *state;
    const EVP_MD *md;
    unsigned char *inputs[3];
    size_t lengths[3];
    int iterations;
    uint64_t n, r, p, maxmem;
    unsigned char *out;
    size_t length;
    NtsView *target;
    size_t offset;
    bool ok;
    ErrorRecord error;
    NtsHeader *done;
} Job;

static unsigned char *copy_of(NtsView *view, size_t *length) {
    *length = (size_t)nts_view_byte_length(view);
    unsigned char *copy = malloc(*length == 0 ? 1 : *length);
    if (copy != NULL && *length > 0) memcpy(copy, nts_view_bytes(view), *length);
    return copy;
}

static void job_run(uv_work_t *request) {
    Job *job = request->data;
    ERR_clear_error();
    switch (job->kind) {
    case JOB_RANDOM:
        job->ok = csprng(job->out, job->length);
        break;
    case JOB_PBKDF2:
        job->ok = pbkdf2(job->inputs[0], job->lengths[0], job->inputs[1], job->lengths[1],
                         job->iterations, job->md, job->out, job->length);
        break;
    case JOB_HKDF:
        job->ok = hkdf(job->md, job->inputs[0], job->lengths[0], job->inputs[1],
                       job->lengths[1], job->inputs[2], job->lengths[2], job->out, job->length);
        break;
    case JOB_SCRYPT:
        job->ok = scrypt(job->inputs[0], job->lengths[0], job->inputs[1], job->lengths[1], job->n,
                         job->r, job->p, job->maxmem, job->out, job->length);
        break;
    case JOB_WORK:
        job->ok = job->work(job->state, &job->out, &job->length);
        break;
    }
    if (!job->ok) record_capture(&job->error);
}

static void job_free(Job *job) {
    if (job->dispose != NULL) job->dispose(job->state);
    for (size_t i = 0; i < 3; i++) free(job->inputs[i]);
    free(job->out);
    record_clear(&job->error);
    if (job->target != NULL) nts_release((NtsHeader *)job->target);
    nts_release(job->done);
    free(job);
}

static void job_after(uv_work_t *request, int status) {
    Job *job = request->data;
    if (status != 0) job->ok = false;
    if (!job->ok) record_move(&last_error, &job->error);
    if (job->kind == JOB_RANDOM) {
        unsigned char *bytes = nts_view_bytes(job->target);
        if (job->ok && bytes != NULL && job->length > 0) {
            memcpy(bytes + job->offset, job->out, job->length);
        }
        ((void (*)(NtsHeader *, bool))job->done->descriptor->methods[nts_closure_call_slot])(
            job->done, job->ok);
    } else {
        NtsView *bytes = nts_view_from_bytes(job->ok ? job->out : NULL,
                                             job->ok ? (double)job->length : 0);
        ((void (*)(NtsHeader *, bool, NtsView *))job->done->descriptor
             ->methods[nts_closure_call_slot])(job->done, job->ok, bytes);
        /* A closure borrows its arguments; this was ours. */
        nts_release((NtsHeader *)bytes);
    }
    job_free(job);
    /* The completion is the owner-thread boundary at which the program's
     * reaction must be allowed to run, where no host checkpoints for us; a
     * no-op where one does. See `zlib.c`. */
    nts_checkpoint();
}

static Job *job_new(JobKind kind, size_t length, NtsHeader *done) {
    Job *job = calloc(1, sizeof(Job));
    if (job == NULL) return NULL;
    job->kind = kind;
    job->length = length;
    job->out = malloc(length == 0 ? 1 : length);
    if (job->out == NULL) {
        free(job);
        return NULL;
    }
    nts_retain(done);
    job->done = done;
    job->request.data = job;
    return job;
}

/* `uv_queue_work` refuses only a request with no work callback, which this
 * never is; a refusal is still delivered, so `done` is called exactly once. */
static void job_queue(Job *job) {
    int queued = uv_queue_work(uv_default_loop(), &job->request, job_run, job_after);
    if (queued != 0) job_after(&job->request, queued);
}

void nts_crypto_random_fill_job(NtsView *target, double offset, double size, NtsHeader *done) {
    Job *job = job_new(JOB_RANDOM, (size_t)size, done);
    if (job == NULL) return;
    nts_retain((NtsHeader *)target);
    job->target = target;
    job->offset = (size_t)offset;
    job_queue(job);
}

void nts_crypto_pbkdf2_job(NtsView *password, NtsView *salt, double iterations, double length,
                           double id, NtsHeader *done) {
    Job *job = job_new(JOB_PBKDF2, (size_t)length, done);
    if (job == NULL) return;
    job->md = digest_at(id);
    job->iterations = (int)iterations;
    job->inputs[0] = copy_of(password, &job->lengths[0]);
    job->inputs[1] = copy_of(salt, &job->lengths[1]);
    job_queue(job);
}

void nts_crypto_hkdf_job(double id, NtsView *key, NtsView *salt, NtsView *info, double length,
                         NtsHeader *done) {
    Job *job = job_new(JOB_HKDF, (size_t)length, done);
    if (job == NULL) return;
    job->md = digest_at(id);
    job->inputs[0] = copy_of(key, &job->lengths[0]);
    job->inputs[1] = copy_of(salt, &job->lengths[1]);
    job->inputs[2] = copy_of(info, &job->lengths[2]);
    job_queue(job);
}

void nts_crypto_scrypt_job(NtsView *password, NtsView *salt, double n, double r, double p,
                           double maxmem, double length, NtsHeader *done) {
    Job *job = job_new(JOB_SCRYPT, (size_t)length, done);
    if (job == NULL) return;
    job->n = (uint64_t)n;
    job->r = (uint64_t)r;
    job->p = (uint64_t)p;
    job->maxmem = (uint64_t)maxmem;
    job->inputs[0] = copy_of(password, &job->lengths[0]);
    job->inputs[1] = copy_of(salt, &job->lengths[1]);
    job_queue(job);
}

/* Another translation unit's job, delivered as the derivations are: `done(ok,
 * bytes)` on the loop thread, with the error record set from the pool thread's
 * queue when `work` fails. `state` is disposed of after delivery, or at once
 * if the job cannot be made. */
void nts_crypto_queue_work(NtsCryptoWork work, void (*dispose)(void *state), void *state,
                           NtsHeader *done) {
    Job *job = calloc(1, sizeof(Job));
    if (job == NULL) {
        dispose(state);
        return;
    }
    job->kind = JOB_WORK;
    job->work = work;
    job->dispose = dispose;
    job->state = state;
    nts_retain(done);
    job->done = done;
    job->request.data = job;
    job_queue(job);
}

/* ---------------------------------------------------------------- timing */

bool nts_crypto_timing_safe_equal(NtsView *a, NtsView *b) {
    size_t length = (size_t)nts_view_byte_length(a);
    if (length != (size_t)nts_view_byte_length(b)) return false;
    return CRYPTO_memcmp(nts_view_bytes(a), nts_view_bytes(b), length) == 0;
}

/* The linked library's, which is what node's compile-time constant describes
 * for node's own build. */
double nts_crypto_openssl_version_number(void) { return (double)OpenSSL_version_num(); }

/* ncrypto's `isFipsEnabled` and `setFipsEnabled`. Setting only changes the
 * default properties -- it succeeds without a FIPS provider loaded, and every
 * fetch after it then fails, which is what `test-crypto-no-algorithm` expects
 * of node. */
bool nts_crypto_fips_enabled(void) { return EVP_default_properties_is_fips_enabled(NULL) == 1; }

bool nts_crypto_set_fips(bool enable) {
    if (nts_crypto_fips_enabled() == enable) return true;
    ERR_clear_error();
    bool ok = EVP_default_properties_enable_fips(NULL, enable ? 1 : 0) == 1 &&
              nts_crypto_fips_enabled() == enable;
    if (!ok) fail();
    return ok;
}
