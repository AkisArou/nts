/* Web Crypto's secret-key ciphers: node's `AESCipherJob`
 * (`src/crypto/crypto_aes.cc`) -- CBC, CTR, GCM, KW and OCB, each over
 * OpenSSL's EVP cipher of the key's length -- and its
 * `ChaCha20Poly1305CipherJob` (`crypto_chacha20_poly1305.cc`), which is the
 * same AEAD routine with a 12-byte nonce and a 16-byte tag, on the thread
 * pool.
 *
 * `AES_Cipher` is the one path for every mode but CTR: an AEAD's tag follows
 * the ciphertext it authenticates, and decryption splits it off first. CTR is
 * node's -- Chromium's -- own, because Web Crypto's counter is the low
 * `length` bits of the block and wraps to zero within them, where OpenSSL's
 * counter carries across the whole block: input that would pass the wrap is
 * enciphered in two calls, the second from the block with its counter
 * zeroed, and input needing more blocks than the counter has is a failure. */
#include <openssl/bn.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <stdlib.h>
#include <string.h>
#include "crypto_internal.h"
#include "nts_crypto.h"
#include "shared.h"

/* Mirrored as `AesMode` in `src/webcrypto/aes.ts`. */
enum { kAesCbc = 0, kAesCtr = 1, kAesGcm = 2, kAesKw = 3, kAesOcb = 4, kChaCha20Poly1305 = 5 };

/* Mirrored as `AesConfig` in `src/webcrypto/aes.ts`: what node's
 * `AESCipherTraits::AdditionalConfig` throws before any job runs. */
enum { kAesConfigOk = 0, kAesUnknownCipher = -1, kAesInvalidIv = -2, kAesInvalidCounter = -3, kAesInvalidTagLength = -4 };

static const unsigned char default_wrap_iv[8] = {0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6, 0xa6};
enum { kAesBlockSize = 16 };

/* The cipher a mode and key length name, as node's `VARIANTS` table does. */
static const EVP_CIPHER *aes_cipher(int mode, size_t key_bytes) {
    switch (mode) {
    case kAesCbc: return key_bytes == 16 ? EVP_aes_128_cbc() : key_bytes == 24 ? EVP_aes_192_cbc() : key_bytes == 32 ? EVP_aes_256_cbc() : NULL;
    case kAesCtr: return key_bytes == 16 ? EVP_aes_128_ctr() : key_bytes == 24 ? EVP_aes_192_ctr() : key_bytes == 32 ? EVP_aes_256_ctr() : NULL;
    case kAesGcm: return key_bytes == 16 ? EVP_aes_128_gcm() : key_bytes == 24 ? EVP_aes_192_gcm() : key_bytes == 32 ? EVP_aes_256_gcm() : NULL;
    case kAesKw: return key_bytes == 16 ? EVP_aes_128_wrap() : key_bytes == 24 ? EVP_aes_192_wrap() : key_bytes == 32 ? EVP_aes_256_wrap() : NULL;
    case kAesOcb: return key_bytes == 16 ? EVP_aes_128_ocb() : key_bytes == 24 ? EVP_aes_192_ocb() : key_bytes == 32 ? EVP_aes_256_ocb() : NULL;
    case kChaCha20Poly1305: return key_bytes == 32 ? EVP_chacha20_poly1305() : NULL;
    default: return NULL;
    }
}

static bool is_aead(int mode) { return mode == kAesGcm || mode == kAesOcb || mode == kChaCha20Poly1305; }

/* ChaCha20-Poly1305's fixed sizes. */
enum { kChaCha20Poly1305IvSize = 12, kChaCha20Poly1305TagSize = 16 };

/* `AESCipherTraits::AdditionalConfig`'s refusals. `length` is CTR's counter
 * bits, or an AEAD's tag bytes. */
double nts_crypto_aes_config(double mode, double key_bytes, double iv_bytes, double length) {
    const EVP_CIPHER *cipher = aes_cipher((int)mode, (size_t)key_bytes);
    if (cipher == NULL) return kAesUnknownCipher;
    size_t iv_length = mode == kAesKw ? sizeof(default_wrap_iv) : (size_t)iv_bytes;
    if (mode == kAesCtr && (iv_length != 16 || length == 0 || length > 128)) return kAesInvalidCounter;
    if (is_aead((int)mode) && length > 128) return kAesInvalidTagLength;
    if (mode == kChaCha20Poly1305) {
        if (iv_length != kChaCha20Poly1305IvSize) return kAesInvalidIv;
    } else if (mode == kAesOcb) {
        if (iv_length == 0 || iv_length > 15) return kAesInvalidIv;
    } else if (iv_length < (size_t)EVP_CIPHER_get_iv_length(cipher)) {
        return kAesInvalidIv;
    }
    return kAesConfigOk;
}

/* A job's inputs, copied, and its output. */
typedef struct {
    int mode;
    bool encrypt;
    unsigned char *key;
    size_t key_length;
    unsigned char *in;
    size_t in_length;
    unsigned char *iv;
    size_t iv_length;
    unsigned char *additional;
    size_t additional_length;
    size_t length;
    unsigned char *out;
    size_t out_length;
} AesJob;

static void aes_dispose(void *state) {
    AesJob *job = state;
    OPENSSL_clear_free(job->key, job->key_length);
    free(job->in);
    free(job->iv);
    free(job->additional);
    free(job->out);
    free(job);
}

/* node's `AES_Cipher`: every mode but CTR. */
static bool aes_cipher_run(AesJob *job) {
    const EVP_CIPHER *cipher = aes_cipher(job->mode, job->key_length);
    EVP_CIPHER_CTX *ctx = cipher == NULL ? NULL : EVP_CIPHER_CTX_new();
    if (ctx == NULL) return false;
    bool aead = is_aead(job->mode);
    const unsigned char *iv = job->mode == kAesKw ? default_wrap_iv : job->iv;
    size_t iv_length = job->mode == kAesKw ? sizeof(default_wrap_iv) : job->iv_length;
    size_t tag_length = job->mode == kChaCha20Poly1305 ? kChaCha20Poly1305TagSize : aead ? job->length : 0;
    size_t data_length = job->in_length;
    bool ok = true;
    if (job->mode == kAesKw) EVP_CIPHER_CTX_set_flags(ctx, EVP_CIPHER_CTX_FLAG_WRAP_ALLOW);
    ok = EVP_CipherInit_ex(ctx, cipher, NULL, NULL, NULL, job->encrypt) == 1;
    if (ok && (job->mode == kAesGcm || job->mode == kAesOcb)) {
        ok = EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_SET_IVLEN, (int)iv_length, NULL) == 1;
    }
    ok = ok && EVP_CIPHER_CTX_set_key_length(ctx, (int)job->key_length) == 1 &&
         EVP_CipherInit_ex(ctx, NULL, NULL, job->key, iv, job->encrypt) == 1;
    if (ok && aead) {
        if (!job->encrypt) {
            /* The tag follows the ciphertext. */
            if (data_length < tag_length) {
                ok = false;
            } else {
                data_length -= tag_length;
                if (job->mode == kAesOcb) {
                    ok = EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_SET_TAG, (int)tag_length, NULL) == 1;
                }
                ok = ok && EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_SET_TAG, (int)tag_length,
                                               job->in + data_length) == 1;
            }
        } else if (job->mode == kAesOcb) {
            ok = EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_SET_TAG, (int)tag_length, NULL) == 1;
        }
    }
    int block_size = ok ? EVP_CIPHER_CTX_get_block_size(ctx) : 0;
    size_t capacity = data_length + (size_t)block_size + (job->encrypt ? tag_length : 0);
    if (ok && capacity > INT32_MAX) ok = false;
    int written = 0;
    if (ok && aead && job->additional_length > 0) {
        ok = EVP_CipherUpdate(ctx, NULL, &written, job->additional, (int)job->additional_length) == 1;
    }
    job->out = ok ? malloc(capacity == 0 ? 1 : capacity) : NULL;
    ok = ok && job->out != NULL;
    size_t total = 0;
    /* An empty update is skipped, as node's AES path skips it for older
     * OpenSSLs; its ChaCha20-Poly1305 path makes it. */
    if (ok && (data_length > 0 || job->mode == kChaCha20Poly1305)) {
        ok = EVP_CipherUpdate(ctx, job->out, &written, job->in, (int)data_length) == 1;
        total += (size_t)written;
    }
    if (ok) {
        written = block_size;
        ok = EVP_CipherFinal_ex(ctx, job->out + total, &written) == 1;
        total += (size_t)written;
    }
    if (ok && job->encrypt && aead) {
        ok = EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_AEAD_GET_TAG, (int)tag_length, job->out + total) == 1;
        total += tag_length;
    }
    EVP_CIPHER_CTX_free(ctx);
    job->out_length = total;
    return ok;
}

/* node's `AES_CTR_Cipher2`: one run from `counter`, which must produce as
 * much as it was given. */
static bool aes_ctr_run(AesJob *job, const unsigned char *in, size_t length, const unsigned char *counter,
                        unsigned char *out) {
    EVP_CIPHER_CTX *ctx = EVP_CIPHER_CTX_new();
    int written = 0;
    int final_length = 0;
    bool ok = ctx != NULL &&
              EVP_CipherInit_ex(ctx, aes_cipher(kAesCtr, job->key_length), NULL, job->key, counter, job->encrypt) == 1 &&
              EVP_CipherUpdate(ctx, out, &written, in, (int)length) == 1 &&
              EVP_CipherFinal_ex(ctx, out + written, &final_length) == 1 &&
              (size_t)written + (size_t)final_length == length;
    EVP_CIPHER_CTX_free(ctx);
    return ok;
}

/* node's `GetCounter`: the counter's own bits of the block. */
static BIGNUM *ctr_counter(const AesJob *job) {
    size_t remainder = job->length % 8;
    size_t byte_length = (job->length + 7) / 8;
    unsigned char counter[16];
    memcpy(counter, job->iv + job->iv_length - byte_length, byte_length);
    if (remainder != 0) counter[0] &= (unsigned char)~(0xFF << remainder);
    return BN_bin2bn(counter, (int)byte_length, NULL);
}

/* node's `AES_CTR_Cipher`. */
static bool aes_ctr_cipher(AesJob *job) {
    size_t blocks_needed = job->in_length == 0 ? 0 : 1 + (job->in_length - 1) / kAesBlockSize;
    BIGNUM *counters = BN_new();
    BIGNUM *current = ctr_counter(job);
    BIGNUM *needed = BN_new();
    BIGNUM *until_reset = BN_new();
    bool ok = counters != NULL && current != NULL && needed != NULL && until_reset != NULL &&
              BN_set_word(counters, 1) == 1 && BN_lshift(counters, counters, (int)job->length) == 1 &&
              BN_set_word(needed, blocks_needed) == 1 && BN_cmp(needed, counters) <= 0 &&
              BN_sub(until_reset, counters, current) == 1;
    job->out = ok ? malloc(job->in_length == 0 ? 1 : job->in_length) : NULL;
    ok = ok && job->out != NULL;
    if (ok && BN_cmp(until_reset, needed) >= 0) {
        ok = aes_ctr_run(job, job->in, job->in_length, job->iv, job->out);
    } else if (ok) {
        /* To the wrap, then on from the block with its counter zeroed. */
        size_t first = (size_t)BN_get_word(until_reset) * kAesBlockSize;
        ok = aes_ctr_run(job, job->in, first, job->iv, job->out);
        unsigned char zeroed[16];
        memcpy(zeroed, job->iv, 16);
        size_t length_bytes = job->length / 8;
        size_t index = 16 - length_bytes;
        memset(zeroed + index, 0, length_bytes);
        if (job->length % 8 != 0) zeroed[index - 1] &= (unsigned char)(0xFF << (job->length % 8));
        ok = ok && aes_ctr_run(job, job->in + first, job->in_length - first, zeroed, job->out + first);
    }
    BN_free(counters);
    BN_free(current);
    BN_free(needed);
    BN_free(until_reset);
    job->out_length = job->in_length;
    return ok;
}

static bool aes_run(void *state) {
    AesJob *job = state;
    return job->mode == kAesCtr ? aes_ctr_cipher(job) : aes_cipher_run(job);
}

static void aes_deliver(void *state, bool ok, NtsHeader *done) {
    AesJob *job = state;
    nts_crypto_deliver_bytes(done, ok, job->out, job->out_length);
}

static const NtsCryptoWork aes_work = {aes_run, aes_deliver, aes_dispose};

/* An AES cipher job, delivered to `done(ok, bytes)`: `length` is CTR's
 * counter bits or an AEAD's tag bytes, `additional` an AEAD's additional
 * data. The configuration was checked by `nts_crypto_aes_config`. */
void nts_crypto_aes_job(double mode, bool encrypt, NtsView *key, NtsView *data, NtsView *iv, double length,
                        NtsView *additional, NtsHeader *done) {
    AesJob *job = calloc(1, sizeof(AesJob));
    if (job == NULL) return;
    job->mode = (int)mode;
    job->encrypt = encrypt;
    job->length = (size_t)length;
    job->key = nts_crypto_copy_view(key, &job->key_length);
    job->in = nts_crypto_copy_view(data, &job->in_length);
    job->iv = nts_crypto_copy_view(iv, &job->iv_length);
    job->additional = nts_crypto_copy_view(additional, &job->additional_length);
    if (job->key == NULL || job->in == NULL || job->iv == NULL || job->additional == NULL) {
        aes_dispose(job);
        return;
    }
    nts_crypto_queue_work(&aes_work, job, done);
}
