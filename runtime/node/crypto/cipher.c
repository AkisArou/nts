/* `node:crypto`'s symmetric ciphers: node's `src/crypto/crypto_cipher.cc`
 * `CipherBase` and `GetCipherInfo`, over OpenSSL 3's `EVP_CIPHER_CTX`.
 *
 * What is node's here is every decision a program can observe: which IV
 * lengths are refused for which modes, when an authentication tag length is
 * required and which ones are valid, CCM's message-length limit and its
 * deferred authentication failure, which calls answer `false` rather than
 * throwing, and where a GCM tag is taken. Each refusal node makes in C++ is
 * returned as a status the TypeScript turns into node's error, because the
 * error's class and wording are the TypeScript's to own. */
#include <limits.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/objects.h>
#include <stdlib.h>
#include <string.h>
#include "crypto_internal.h"
#include "nts_crypto.h"
#include "shared.h"

/* The statuses besides success. Mirrored as `CipherStatus` in
 * `src/cipher.ts`, which throws the error node throws for each. */
enum {
    kCipherCryptoError = 0,
    kCipherInvalidIv = -1,
    kCipherInvalidKeyLength = -2,
    kCipherAuthTagRequired = -3,
    kCipherInvalidAuthTagLength = -4,
    kCipherCcmDecryptInFips = -5,
    kCipherInvalidMessageLength = -6,
    kCipherMissingPlaintextLength = -7,
    kCipherInvalidState = -8,
    kCipherShortGcmTag = -9,
    kCipherUnauthenticated = -10,
};

static double last_status;

double nts_crypto_cipher_status(void) { return last_status; }

/* ------------------------------------------------------------ the registry */

/* As `crypto.c`'s digests: the legacy lookup for the name, then an explicit
 * fetch of the canonical name so that initialising does not fetch again. A
 * cipher that resolves and will not fetch -- `rc4` without the legacy
 * provider -- keeps its implicit `EVP_CIPHER`, so `getCipherInfo` still
 * describes it, as node's does, and initialising it fails with OpenSSL's
 * reason. */
typedef struct {
    char *name;
    const EVP_CIPHER *cipher;
    EVP_CIPHER *owned;
} Algorithm;

static Algorithm *algorithms;
static size_t algorithm_count;

static int algorithm_lookup(const char *name, const EVP_CIPHER *implicit) {
    for (size_t i = 0; i < algorithm_count; i++) {
        if (strcmp(algorithms[i].name, name) == 0) return (int)i;
    }
    if (implicit == NULL) implicit = EVP_get_cipherbyname(name);
    if (implicit == NULL) return -1;
    EVP_CIPHER *explicit_cipher = NULL;
    const char *canonical = EVP_CIPHER_get0_name(implicit);
    if (canonical != NULL) {
        ERR_set_mark();
        explicit_cipher = EVP_CIPHER_fetch(NULL, canonical, NULL);
        ERR_pop_to_mark();
    }
    Algorithm *grown = realloc(algorithms, (algorithm_count + 1) * sizeof(Algorithm));
    char *copy = strdup(name);
    if (grown == NULL || copy == NULL) {
        if (grown != NULL) algorithms = grown;
        free(copy);
        EVP_CIPHER_free(explicit_cipher);
        return -1;
    }
    algorithms = grown;
    algorithms[algorithm_count] = (Algorithm){
        .name = copy,
        .cipher = explicit_cipher != NULL ? explicit_cipher : implicit,
        .owned = explicit_cipher,
    };
    return (int)algorithm_count++;
}

static const EVP_CIPHER *algorithm_at(double id) {
    if (id < 0 || id >= (double)algorithm_count) return NULL;
    return algorithms[(size_t)id].cipher;
}

const EVP_CIPHER *nts_crypto_cipher_at(double id) { return algorithm_at(id); }

double nts_crypto_cipher_id(NtsString *name) {
    size_t length = 0;
    char *utf8 = nts_node_to_utf8_alloc(name, &length);
    if (utf8 == NULL) return -1;
    int id = algorithm_lookup(utf8, NULL);
    free(utf8);
    return (double)id;
}

/* ncrypto's `Cipher::FromNid`, registered under its short name. */
double nts_crypto_cipher_id_of_nid(double nid) {
    const EVP_CIPHER *cipher = EVP_get_cipherbynid((int)nid);
    if (cipher == NULL) return -1;
    const char *name = OBJ_nid2sn((int)nid);
    if (name == NULL) return -1;
    return (double)algorithm_lookup(name, cipher);
}

typedef struct {
    NtsArray *names;
} CipherNames;

static void collect_cipher(const EVP_CIPHER *cipher, const char *from, const char *to, void *arg) {
    (void)cipher;
    (void)to;
    if (from == NULL) return;
    /* Node's filter: only what an explicit fetch reaches. */
    int id = algorithm_lookup(from, NULL);
    if (id < 0 || algorithms[id].owned == NULL) return;
    CipherNames *names = arg;
    nts_array_push_ref(names->names, nts_string_from_utf8(from, strlen(from)));
}

NtsArray *nts_crypto_cipher_names(void) {
    CipherNames names = {.names = nts_array_new(&nts_desc_ref, 0)};
    ERR_set_mark();
    EVP_CIPHER_do_all_sorted(collect_cipher, &names);
    ERR_pop_to_mark();
    return names.names;
}

static int mode_of(const EVP_CIPHER *cipher) { return EVP_CIPHER_get_mode(cipher); }

static bool is_chacha20_poly1305(const EVP_CIPHER *cipher) {
    return EVP_CIPHER_get_nid(cipher) == NID_chacha20_poly1305;
}

/* ncrypto's `isSupportedAuthenticatedMode`. */
static bool is_aead(const EVP_CIPHER *cipher) {
    int mode = mode_of(cipher);
    return mode == EVP_CIPH_GCM_MODE || mode == EVP_CIPH_CCM_MODE || mode == EVP_CIPH_OCB_MODE ||
           is_chacha20_poly1305(cipher);
}

/* NIST SP 800-38D, page 9. */
static bool valid_gcm_tag_length(unsigned int length) {
    return length == 4 || length == 8 || (length >= 12 && length <= 16);
}

NtsString *nts_crypto_cipher_name(double id) {
    const EVP_CIPHER *cipher = algorithm_at(id);
    const char *name = cipher == NULL ? NULL : OBJ_nid2sn(EVP_CIPHER_get_nid(cipher));
    return nts_string_from_utf8(name == NULL ? "" : name, name == NULL ? 0 : strlen(name));
}

/* ncrypto's `getModeLabel`: empty for a mode it has no word for. */
NtsString *nts_crypto_cipher_mode(double id) {
    const EVP_CIPHER *cipher = algorithm_at(id);
    const char *label = "";
    if (cipher != NULL) {
        switch (mode_of(cipher)) {
        case EVP_CIPH_CCM_MODE: label = "ccm"; break;
        case EVP_CIPH_CFB_MODE: label = "cfb"; break;
        case EVP_CIPH_CBC_MODE: label = "cbc"; break;
        case EVP_CIPH_CTR_MODE: label = "ctr"; break;
        case EVP_CIPH_ECB_MODE: label = "ecb"; break;
        case EVP_CIPH_GCM_MODE: label = "gcm"; break;
        case EVP_CIPH_OCB_MODE: label = "ocb"; break;
        case EVP_CIPH_OFB_MODE: label = "ofb"; break;
        case EVP_CIPH_STREAM_CIPHER: label = "stream"; break;
        case EVP_CIPH_WRAP_MODE: label = "wrap"; break;
        case EVP_CIPH_XTS_MODE: label = "xts"; break;
        default: break;
        }
    }
    return nts_string_from_utf8(label, strlen(label));
}

/* Node's `GetCipherInfo`, as `[nid, blockSize, ivLength, keyLength]`:
 * `blockSize` -1 for a stream cipher, which has none worth reporting, and an
 * empty array when a length the caller asked to test is not usable. A negative
 * test length is "not asked". */
NtsArray *nts_crypto_cipher_info(double id, double key_length, double iv_length) {
    NtsArray *none = nts_array_new(&nts_node_desc_double, 0);
    const EVP_CIPHER *cipher = algorithm_at(id);
    if (cipher == NULL) return none;
    int iv = EVP_CIPHER_get_iv_length(cipher);
    int key = EVP_CIPHER_get_key_length(cipher);
    int block = EVP_CIPHER_get_block_size(cipher);
    if (key_length >= 0 || iv_length >= 0) {
        EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
        ERR_set_mark();
        bool usable = ctx != NULL && EVP_CipherInit_ex(ctx, cipher, NULL, NULL, NULL, 1) == 1;
        if (usable && key_length >= 0) {
            usable = EVP_CIPHER_CTX_set_key_length(ctx, (int)key_length) == 1;
            if (usable) key = (int)key_length;
        }
        if (usable && iv_length >= 0) {
            int check = (int)iv_length;
            int mode = mode_of(cipher);
            /* CCM takes 7 to 13 bytes, GCM anything, OCB what the context
             * accepts, and every other mode exactly its own length. */
            if (mode == EVP_CIPH_CCM_MODE) {
                usable = check >= 7 && check <= 13;
            } else if (mode == EVP_CIPH_OCB_MODE) {
                usable = EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_SET_IVLEN, check, NULL) == 1;
            } else if (mode != EVP_CIPH_GCM_MODE) {
                usable = check == iv;
            }
            if (usable) iv = check;
        }
        ERR_pop_to_mark();
        EVP_CIPHER_CTX_free(ctx);
        if (!usable) return none;
    }
    nts_release((NtsHeader *)none);
    NtsArray *info = nts_array_new(&nts_node_desc_double, 4);
    double *items = NTS_ITEMS(info, double);
    items[0] = (double)EVP_CIPHER_get_nid(cipher);
    items[1] = mode_of(cipher) == EVP_CIPH_STREAM_CIPHER ? -1 : (double)block;
    items[2] = (double)iv;
    items[3] = (double)key;
    return info;
}

/* ------------------------------------------------------------- contexts */

#define NO_AUTH_TAG_LENGTH UINT_MAX
#define MAX_AUTH_TAG_LENGTH 16

enum { kAuthTagUnknown, kAuthTagComputed, kAuthTagSetByUser };

typedef struct {
    bool used;
    bool encrypt;
    EVP_CIPHER_CTX *ctx;
    int auth_tag_state;
    unsigned int auth_tag_len;
    unsigned char auth_tag[MAX_AUTH_TAG_LENGTH];
    bool pending_auth_failed;
    int max_message_size;
} CipherContext;

static CipherContext *ciphers;
static size_t cipher_capacity;

static double cipher_claim(void) {
    size_t index = 0;
    while (index < cipher_capacity && ciphers[index].used) index++;
    if (index == cipher_capacity) {
        size_t grown = cipher_capacity == 0 ? 8 : cipher_capacity * 2;
        CipherContext *moved = realloc(ciphers, grown * sizeof(CipherContext));
        if (moved == NULL) return 0;
        memset(moved + cipher_capacity, 0, (grown - cipher_capacity) * sizeof(CipherContext));
        ciphers = moved;
        cipher_capacity = grown;
    }
    memset(&ciphers[index], 0, sizeof(CipherContext));
    ciphers[index].used = true;
    return (double)(index + 1);
}

static CipherContext *cipher_at(double handle) {
    if (handle < 1 || handle > (double)cipher_capacity) return NULL;
    CipherContext *context = &ciphers[(size_t)handle - 1];
    return context->used ? context : NULL;
}

void nts_crypto_cipher_release(double handle) {
    CipherContext *context = cipher_at(handle);
    if (context == NULL) return;
    EVP_CIPHER_CTX_free(context->ctx);
    memset(context, 0, sizeof(*context));
}

static bool context_mode_is(const CipherContext *context, int mode) {
    return mode_of(EVP_CIPHER_CTX_get0_cipher(context->ctx)) == mode;
}

static bool context_is_aead(const CipherContext *context) {
    return is_aead(EVP_CIPHER_CTX_get0_cipher(context->ctx));
}

/* Node's `InitAuthenticated`. */
static double init_authenticated(CipherContext *context, int iv_len, unsigned int auth_tag_len) {
    if (EVP_CIPHER_CTX_ctrl(context->ctx, EVP_CTRL_AEAD_SET_IVLEN, iv_len, NULL) != 1) {
        return kCipherInvalidIv;
    }
    if (context_mode_is(context, EVP_CIPH_CCM_MODE)) {
        if (!context->encrypt && EVP_default_properties_is_fips_enabled(NULL) == 1) {
            return kCipherCcmDecryptInFips;
        }
        /* The message length is limited to min(INT_MAX, 2^(8*(15-iv_len))-1)
         * bytes. */
        context->max_message_size = INT_MAX;
        if (iv_len == 12) context->max_message_size = 16777215;
        if (iv_len == 13) context->max_message_size = 65535;
    }
    const bool gcm = context_mode_is(context, EVP_CIPH_GCM_MODE);
    if (auth_tag_len == NO_AUTH_TAG_LENGTH) {
        /* GCM accepts any valid tag length when decrypting without one given,
         * deprecated (DEP0182) but supported. */
        if (gcm) return 1;
        if (is_chacha20_poly1305(EVP_CIPHER_CTX_get0_cipher(context->ctx))) {
            auth_tag_len = EVP_CHACHAPOLY_TLS_TAG_LEN;
        } else {
            return kCipherAuthTagRequired;
        }
    } else if ((gcm && !valid_gcm_tag_length(auth_tag_len)) ||
               (!gcm && EVP_CIPHER_CTX_ctrl(context->ctx, EVP_CTRL_AEAD_SET_TAG, (int)auth_tag_len,
                                            NULL) != 1)) {
        return kCipherInvalidAuthTagLength;
    }
    context->auth_tag_len = auth_tag_len;
    return 1;
}

/* Node's `CipherBase::New`, `InitIv` and `CommonInit`: a handle, or a status. */
double nts_crypto_cipher_new(double id, bool encrypt, NtsView *key, NtsView *iv, double auth_tag_length) {
    const EVP_CIPHER *cipher = algorithm_at(id);
    if (cipher == NULL) return kCipherCryptoError;
    const int expected_iv_len = EVP_CIPHER_get_iv_length(cipher);
    const int iv_len = (int)nts_view_byte_length(iv);
    const bool has_iv = iv_len > 0;
    if (!has_iv && expected_iv_len != 0) return kCipherInvalidIv;
    if (!is_aead(cipher) && has_iv && iv_len != expected_iv_len) return kCipherInvalidIv;
    /* OpenSSL does not refuse these itself under some conditions:
     * https://www.openssl.org/news/secadv/20190306.txt */
    if (is_chacha20_poly1305(cipher) && iv_len > 12) return kCipherInvalidIv;

    ERR_clear_error();
    double handle = cipher_claim();
    CipherContext *context = cipher_at(handle);
    if (context == NULL) return kCipherCryptoError;
    context->encrypt = encrypt;
    context->auth_tag_len = NO_AUTH_TAG_LENGTH;
    context->auth_tag_state = kAuthTagUnknown;
    context->ctx = EVP_CIPHER_CTX_new();
    double status = kCipherCryptoError;
    if (context->ctx == NULL) goto failed;
    if (mode_of(cipher) == EVP_CIPH_WRAP_MODE) {
        EVP_CIPHER_CTX_set_flags(context->ctx, EVP_CIPHER_CTX_FLAG_WRAP_ALLOW);
    }
    if (EVP_CipherInit_ex(context->ctx, cipher, NULL, NULL, NULL, encrypt ? 1 : 0) != 1) goto failed;
    if (is_aead(cipher)) {
        status = init_authenticated(context, iv_len,
                                    auth_tag_length < 0 ? NO_AUTH_TAG_LENGTH : (unsigned int)auth_tag_length);
        if (status != 1) goto refused;
        status = kCipherCryptoError;
    }
    if (EVP_CIPHER_CTX_set_key_length(context->ctx, (int)nts_view_byte_length(key)) != 1) {
        status = kCipherInvalidKeyLength;
        goto refused;
    }
    if (EVP_CipherInit_ex(context->ctx, NULL, NULL, nts_view_bytes(key), has_iv ? nts_view_bytes(iv) : NULL,
                          encrypt ? 1 : 0) != 1) {
        goto failed;
    }
    return handle;

failed:
    /* "Failed to initialize cipher", with whatever OpenSSL queued. */
    nts_crypto_record_failure();
refused:
    ERR_clear_error();
    nts_crypto_cipher_release(handle);
    return status;
}

/* Node's `CipherBase::Update`. NULL is a failure whose kind is the status:
 * a CCM message too long, or an unsupported state with its cause on the
 * error record. */
static NtsView *cipher_update(CipherContext *context, const unsigned char *data, size_t len) {
    last_status = kCipherCryptoError;
    ERR_clear_error();
    if (context == NULL || context->ctx == NULL || len > INT_MAX) {
        nts_crypto_record_failure();
        return NULL;
    }
    if (context_mode_is(context, EVP_CIPH_CCM_MODE) && (long)len > (long)context->max_message_size) {
        last_status = kCipherInvalidMessageLength;
        return NULL;
    }
    const int block_size = EVP_CIPHER_CTX_get_block_size(context->ctx);
    if (len + (size_t)block_size > INT_MAX) {
        nts_crypto_record_failure();
        return NULL;
    }
    int out_len = (int)len + block_size;
    if (context->encrypt && context_mode_is(context, EVP_CIPH_WRAP_MODE) &&
        EVP_CipherUpdate(context->ctx, NULL, &out_len, data, (int)len) != 1) {
        nts_crypto_record_failure();
        return NULL;
    }
    unsigned char *out = malloc(out_len == 0 ? 1 : (size_t)out_len);
    if (out == NULL) {
        nts_crypto_record_failure();
        return NULL;
    }
    int ok = EVP_CipherUpdate(context->ctx, out, &out_len, data, (int)len);
    /* In CCM mode an update fails when the tag does not authenticate; node
     * remembers that and throws it from `final`. */
    if (ok != 1 && !context->encrypt && context_mode_is(context, EVP_CIPH_CCM_MODE)) {
        context->pending_auth_failed = true;
        ok = 1;
    }
    NtsView *result = NULL;
    if (ok == 1) {
        result = nts_view_from_bytes(out, out_len < 0 ? 0 : (double)out_len);
    } else {
        nts_crypto_record_failure();
    }
    free(out);
    ERR_clear_error();
    return result;
}

NtsView *nts_crypto_cipher_update(double handle, NtsView *data) {
    return cipher_update(cipher_at(handle), nts_view_bytes(data), (size_t)nts_view_byte_length(data));
}

NtsView *nts_crypto_cipher_update_utf8(double handle, NtsString *data) {
    size_t length = 0;
    char *utf8 = nts_node_to_utf8_alloc(data, &length);
    if (utf8 == NULL) return NULL;
    NtsView *result = cipher_update(cipher_at(handle), (const unsigned char *)utf8, length);
    free(utf8);
    return result;
}

/* Node's `CipherBase::Final`. NULL is a failure: `kCipherInvalidState` when
 * there is no context left, or else `kCipherUnauthenticated` or
 * `kCipherCryptoError` -- node words the two differently -- with OpenSSL's
 * cause on the error record. The context is gone afterwards either way. */
NtsView *nts_crypto_cipher_final(double handle) {
    ERR_clear_error();
    CipherContext *context = cipher_at(handle);
    if (context == NULL || context->ctx == NULL) {
        last_status = kCipherInvalidState;
        return NULL;
    }
    const bool authenticated = context_is_aead(context);
    int block_size = EVP_CIPHER_CTX_get_block_size(context->ctx);
    unsigned char *out = malloc(block_size <= 0 ? 1 : (size_t)block_size);
    int out_len = 0;
    bool ok = out != NULL;
    if (ok && !context->encrypt && context_mode_is(context, EVP_CIPH_CCM_MODE)) {
        /* CCM checks the tag in `update`; `EVP_CipherFinal_ex` must not be
         * called and would fail. */
        ok = !context->pending_auth_failed;
    } else if (ok) {
        ok = EVP_CipherFinal_ex(context->ctx, out, &out_len) == 1;
        if (ok && context->encrypt && authenticated) {
            /* GCM's tag defaults to 16 bytes when encrypting; CCM and OCB
             * were given theirs. */
            if (context->auth_tag_len == NO_AUTH_TAG_LENGTH) context->auth_tag_len = EVP_GCM_TLS_TAG_LEN;
            ok = EVP_CIPHER_CTX_ctrl(context->ctx, EVP_CTRL_AEAD_GET_TAG, (int)context->auth_tag_len,
                                     context->auth_tag) == 1;
            if (ok) context->auth_tag_state = kAuthTagComputed;
        }
    }
    EVP_CIPHER_CTX_free(context->ctx);
    context->ctx = NULL;
    NtsView *result = NULL;
    if (ok) {
        result = nts_view_from_bytes(out, out_len < 0 ? 0 : (double)out_len);
    } else {
        last_status = authenticated ? kCipherUnauthenticated : kCipherCryptoError;
        nts_crypto_record_failure();
    }
    free(out);
    return result;
}

bool nts_crypto_cipher_set_auto_padding(double handle, bool padding) {
    CipherContext *context = cipher_at(handle);
    if (context == NULL || context->ctx == NULL) return false;
    return EVP_CIPHER_CTX_set_padding(context->ctx, padding ? 1 : 0) == 1;
}

/* Node's `GetAuthTag`: only after `final`, only when encrypting an
 * authenticated cipher. NULL otherwise, which the TypeScript reports. */
NtsView *nts_crypto_cipher_auth_tag(double handle) {
    CipherContext *context = cipher_at(handle);
    if (context == NULL || context->ctx != NULL || !context->encrypt ||
        context->auth_tag_len == NO_AUTH_TAG_LENGTH || context->auth_tag_state != kAuthTagComputed) {
        return NULL;
    }
    return nts_view_from_bytes(context->auth_tag, (double)context->auth_tag_len);
}

/* Node's `SetAuthTag`: 1, or 0 for node's `false`, or
 * `kCipherInvalidAuthTagLength`. When the status afterwards is
 * `kCipherShortGcmTag`, node emits DEP0182 for this call. */
double nts_crypto_cipher_set_auth_tag(double handle, NtsView *tag) {
    last_status = 1;
    CipherContext *context = cipher_at(handle);
    if (context == NULL || context->ctx == NULL || !context_is_aead(context) || context->encrypt ||
        context->auth_tag_state != kAuthTagUnknown) {
        return 0;
    }
    unsigned int tag_len = (unsigned int)nts_view_byte_length(tag);
    const bool gcm = context_mode_is(context, EVP_CIPH_GCM_MODE);
    bool valid;
    if (gcm) {
        valid = (context->auth_tag_len == NO_AUTH_TAG_LENGTH || context->auth_tag_len == tag_len) &&
                valid_gcm_tag_length(tag_len);
    } else {
        valid = context->auth_tag_len == tag_len;
    }
    if (!valid) return kCipherInvalidAuthTagLength;
    if (gcm && context->auth_tag_len == NO_AUTH_TAG_LENGTH && tag_len != EVP_GCM_TLS_TAG_LEN) {
        last_status = kCipherShortGcmTag;
    }
    context->auth_tag_len = tag_len;
    ERR_set_mark();
    int ok = EVP_CIPHER_CTX_ctrl(context->ctx, EVP_CTRL_AEAD_SET_TAG, (int)tag_len, nts_view_bytes(tag));
    ERR_pop_to_mark();
    if (ok != 1) return 0;
    context->auth_tag_state = kAuthTagSetByUser;
    return 1;
}

/* Node's `SetAAD`: 1, or 0 for node's `false`, or a status. CCM needs the
 * plaintext's length first; a negative one is "not given". */
double nts_crypto_cipher_set_aad(double handle, NtsView *aad, double plaintext_length) {
    CipherContext *context = cipher_at(handle);
    if (context == NULL || context->ctx == NULL || !context_is_aead(context)) return 0;
    int out_len = 0;
    ERR_set_mark();
    double result = 1;
    if (context_mode_is(context, EVP_CIPH_CCM_MODE)) {
        if (plaintext_length < 0) {
            result = kCipherMissingPlaintextLength;
        } else if (plaintext_length > (double)context->max_message_size) {
            result = kCipherInvalidMessageLength;
        } else if (EVP_CipherUpdate(context->ctx, NULL, &out_len, NULL, (int)plaintext_length) != 1) {
            result = 0;
        }
    }
    if (result == 1) {
        result = EVP_CipherUpdate(context->ctx, NULL, &out_len, nts_view_bytes(aad),
                                  (int)nts_view_byte_length(aad)) == 1
                     ? 1
                     : 0;
    }
    ERR_pop_to_mark();
    return result;
}
