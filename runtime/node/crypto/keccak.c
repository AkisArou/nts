/* Web Crypto's Keccak functions beyond OpenSSL's SHA-3 and SHAKE digests:
 *
 *   - cSHAKE with a function name or customization, node's `CShakeJob`
 *     (`src/crypto/crypto_hash.cc`), over OpenSSL's KECCAK-KMAC digests, the
 *     Keccak sponge with cSHAKE's padding;
 *   - KMAC, node's `KmacJob` (`crypto_kmac.cc`), OpenSSL's KMAC MACs, and
 *     cSHAKE again for what those refuse: a length or key length that is not
 *     whole bytes, or a key shorter than four bytes;
 *   - TurboSHAKE and KangarooTwelve, node's `TurboShakeJob` and
 *     `KangarooTwelveJob` (`crypto_turboshake.cc`): Keccak-p[1600, 12], which
 *     OpenSSL does not have, so node carries its own and this is its port.
 *
 * A variant is its security strength, 128 or 256. Each job copies its inputs,
 * since it outlives the call that made it. */
#include <limits.h>
#include <openssl/core_names.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/params.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include "crypto_internal.h"
#include "nts_crypto.h"
#include "shared.h"

/* -- Keccak-p[1600, 12] --------------------------------------------------- */

static uint64_t rol64(uint64_t value, int offset) {
    return offset == 0 ? value : (value << offset) | (value >> (64 - offset));
}

static uint64_t load_le64(const uint8_t *src) {
    uint64_t value = 0;
    for (int i = 7; i >= 0; i--) value = (value << 8) | src[i];
    return value;
}

static void store_le64(uint8_t *dst, uint64_t value) {
    for (int i = 0; i < 8; i++) dst[i] = (uint8_t)(value >> (8 * i));
}

static const unsigned char rhotates[5][5] = {
    {0, 1, 62, 28, 27}, {36, 44, 6, 55, 20}, {3, 10, 43, 25, 39}, {41, 45, 15, 21, 8}, {18, 2, 61, 56, 14},
};

static const uint64_t iotas[24] = {
    0x0000000000000001ULL, 0x0000000000008082ULL, 0x800000000000808aULL, 0x8000000080008000ULL,
    0x000000000000808bULL, 0x0000000080000001ULL, 0x8000000080008081ULL, 0x8000000000008009ULL,
    0x000000000000008aULL, 0x0000000000000088ULL, 0x0000000080008009ULL, 0x000000008000000aULL,
    0x000000008000808bULL, 0x800000000000008bULL, 0x8000000000008089ULL, 0x8000000000008003ULL,
    0x8000000000008002ULL, 0x8000000000000080ULL, 0x000000000000800aULL, 0x800000008000000aULL,
    0x8000000080008081ULL, 0x8000000000008080ULL, 0x0000000080000001ULL, 0x8000000080008008ULL,
};

/* The last twelve of Keccak-f[1600]'s 24 rounds: theta, rho, pi, chi, iota. */
static void keccak_p1600_12(uint64_t a[5][5]) {
    for (size_t round = 12; round < 24; round++) {
        uint64_t c[5], d[5];
        for (size_t x = 0; x < 5; x++) c[x] = a[0][x] ^ a[1][x] ^ a[2][x] ^ a[3][x] ^ a[4][x];
        for (size_t x = 0; x < 5; x++) d[x] = c[(x + 4) % 5] ^ rol64(c[(x + 1) % 5], 1);
        for (size_t y = 0; y < 5; y++) {
            for (size_t x = 0; x < 5; x++) a[y][x] = rol64(a[y][x] ^ d[x], rhotates[y][x]);
        }
        uint64_t t[5][5];
        memcpy(t, a, sizeof(t));
        for (size_t y = 0; y < 5; y++) {
            for (size_t x = 0; x < 5; x++) a[y][x] = t[x][(3 * y + x) % 5];
        }
        for (size_t y = 0; y < 5; y++) {
            uint64_t row[5];
            for (size_t x = 0; x < 5; x++) row[x] = a[y][x] ^ (~a[y][(x + 1) % 5] & a[y][(x + 2) % 5]);
            memcpy(a[y], row, sizeof(row));
        }
        a[0][0] ^= iotas[round];
    }
}

/* A TurboSHAKE sponge that absorbs in pieces, so KangarooTwelve's nodes need
 * no buffer of their own. */
typedef struct {
    uint64_t a[5][5];
    uint8_t block[168];
    size_t rate;
    size_t filled;
} TurboShake;

static void turboshake_init(TurboShake *sponge, int variant) {
    memset(sponge, 0, sizeof(*sponge));
    sponge->rate = variant == 128 ? 168 : 136;
}

static void turboshake_absorb_block(TurboShake *sponge, const uint8_t *block) {
    for (size_t i = 0; i < sponge->rate / 8; i++) sponge->a[i / 5][i % 5] ^= load_le64(block + i * 8);
    keccak_p1600_12(sponge->a);
}

static void turboshake_absorb(TurboShake *sponge, const uint8_t *input, size_t length) {
    if (sponge->filled > 0) {
        size_t take = sponge->rate - sponge->filled;
        if (take > length) take = length;
        memcpy(sponge->block + sponge->filled, input, take);
        sponge->filled += take;
        input += take;
        length -= take;
        if (sponge->filled < sponge->rate) return;
        turboshake_absorb_block(sponge, sponge->block);
        sponge->filled = 0;
    }
    for (; length >= sponge->rate; input += sponge->rate, length -= sponge->rate) {
        turboshake_absorb_block(sponge, input);
    }
    if (length > 0) memcpy(sponge->block, input, length);
    sponge->filled = length;
}

static void turboshake_absorb_byte(TurboShake *sponge, uint8_t byte) {
    turboshake_absorb(sponge, &byte, 1);
}

/* The domain byte and the final bit, then `length` bytes squeezed out. */
static void turboshake_squeeze(TurboShake *sponge, uint8_t domain, uint8_t *output, size_t length) {
    memset(sponge->block + sponge->filled, 0, sponge->rate - sponge->filled);
    sponge->block[sponge->filled] ^= domain;
    sponge->block[sponge->rate - 1] ^= 0x80;
    turboshake_absorb_block(sponge, sponge->block);
    for (size_t offset = 0;;) {
        size_t block = length - offset < sponge->rate ? length - offset : sponge->rate;
        for (size_t i = 0; i < block; i += 8) {
            uint8_t lane[8];
            store_le64(lane, sponge->a[i / 40][(i / 8) % 5]);
            memcpy(output + offset + i, lane, block - i < 8 ? block - i : 8);
        }
        offset += block;
        if (offset >= length) break;
        keccak_p1600_12(sponge->a);
    }
}

/* KangarooTwelve's `length_encode`: big-endian bytes, then their count. */
static size_t length_encode(size_t value, uint8_t out[sizeof(size_t) + 1]) {
    size_t n = 0;
    for (size_t v = value; v > 0; v >>= 8) n++;
    for (size_t i = 0; i < n; i++) out[i] = (uint8_t)(value >> (8 * (n - 1 - i)));
    out[n] = (uint8_t)n;
    return n + 1;
}

enum { kChunkSize = 8192 };

/* Node's `KangarooTwelve`: S = message || customization ||
 * length_encode(|customization|), one TurboSHAKE call when S fits a chunk,
 * and otherwise a tree of chunk chaining values under a final node. */
static void kangaroo_twelve(int variant, const uint8_t *message, size_t message_length, const uint8_t *custom,
                            size_t custom_length, uint8_t *output, size_t output_length) {
    uint8_t suffix[sizeof(size_t) + 1];
    size_t suffix_length = length_encode(custom_length, suffix);
    const uint8_t *parts[3] = {message, custom, suffix};
    size_t lengths[3] = {message_length, custom_length, suffix_length};
    size_t total = message_length + custom_length + suffix_length;
    size_t cv_length = variant == 128 ? 32 : 64;

    TurboShake final;
    turboshake_init(&final, variant);
    if (total <= kChunkSize) {
        for (int i = 0; i < 3; i++) turboshake_absorb(&final, parts[i], lengths[i]);
        turboshake_squeeze(&final, 0x07, output, output_length);
        return;
    }
    /* S's bytes in order, part by part; `chunk` is the node being fed. */
    TurboShake leaf;
    TurboShake *chunk = &final;
    size_t in_chunk = 0, leaves = 0;
    for (int part = 0; part < 3; part++) {
        const uint8_t *bytes = parts[part];
        size_t remaining = lengths[part];
        while (remaining > 0) {
            if (in_chunk == kChunkSize) {
                if (chunk == &final) {
                    static const uint8_t marker[8] = {0x03};
                    turboshake_absorb(&final, marker, sizeof(marker));
                } else {
                    uint8_t cv[64];
                    turboshake_squeeze(&leaf, 0x0b, cv, cv_length);
                    turboshake_absorb(&final, cv, cv_length);
                    leaves++;
                }
                turboshake_init(&leaf, variant);
                chunk = &leaf;
                in_chunk = 0;
            }
            size_t take = kChunkSize - in_chunk < remaining ? kChunkSize - in_chunk : remaining;
            turboshake_absorb(chunk, bytes, take);
            in_chunk += take;
            bytes += take;
            remaining -= take;
        }
    }
    uint8_t cv[64];
    turboshake_squeeze(&leaf, 0x0b, cv, cv_length);
    turboshake_absorb(&final, cv, cv_length);
    leaves++;
    uint8_t count[sizeof(size_t) + 1];
    turboshake_absorb(&final, count, length_encode(leaves, count));
    turboshake_absorb_byte(&final, 0xff);
    turboshake_absorb_byte(&final, 0xff);
    turboshake_squeeze(&final, 0x06, output, output_length);
}

/* -- cSHAKE and KMAC -------------------------------------------------------- */

/* NIST SP 800-185's `left_encode` and `right_encode`. */
static size_t encode_length(size_t value, bool left, uint8_t out[sizeof(size_t) + 1]) {
    size_t n = 1;
    for (size_t v = value >> 8; v > 0; v >>= 8) n++;
    uint8_t *digits = left ? out + 1 : out;
    for (size_t i = 0; i < n; i++) digits[i] = (uint8_t)(value >> (8 * (n - 1 - i)));
    out[left ? 0 : n] = (uint8_t)n;
    return n + 1;
}

static bool update_encoded_length(EVP_MD_CTX *ctx, size_t value, bool left, size_t *written) {
    uint8_t encoded[sizeof(size_t) + 1];
    size_t length = encode_length(value, left, encoded);
    *written += length;
    return EVP_DigestUpdate(ctx, encoded, length) == 1;
}

/* `encode_string`: a string's length in bits, then its bytes. The bit length
 * is its own, which for KMAC's key may stop inside the last byte. */
static bool update_encoded_string(EVP_MD_CTX *ctx, const uint8_t *bytes, size_t length, size_t bits,
                                  size_t *written) {
    *written += length;
    return update_encoded_length(ctx, bits, true, written) && (length == 0 || EVP_DigestUpdate(ctx, bytes, length) == 1);
}

/* `bytepad`: the rate, one or two encoded strings, zeros to the rate. */
static bool update_bytepad(EVP_MD_CTX *ctx, size_t rate, const uint8_t *first, size_t first_length,
                           size_t first_bits, const uint8_t *second, size_t second_length, bool has_second) {
    static const uint8_t zeros[168];
    size_t written = 0;
    bool ok = update_encoded_length(ctx, rate, true, &written) &&
              update_encoded_string(ctx, first, first_length, first_bits, &written) &&
              (!has_second || update_encoded_string(ctx, second, second_length, second_length * 8, &written));
    size_t padding = (rate - written % rate) % rate;
    return ok && (padding == 0 || EVP_DigestUpdate(ctx, zeros, padding) == 1);
}

/* Node's `TruncateToBitLength`: the last byte keeps its top `bits % 8` bits. */
static void truncate_to_bit_length(uint8_t *out, size_t bits) {
    if (bits % 8 != 0) out[bits / 8] &= (uint8_t)(0xff << (8 - bits % 8));
}

enum { kMaxCShakeCustomization = 512 };

/* Node's `DeriveCShakeBits`: bytepad(N, S), then, for KMAC, the padded key,
 * the input, and, for KMAC, right_encode of the output's length in bits. */
static bool derive_cshake(int variant, const uint8_t *name, size_t name_length, const uint8_t *custom,
                          size_t custom_length, const uint8_t *key, size_t key_length, size_t key_bits,
                          bool kmac, const uint8_t *input, size_t input_length, size_t bits, uint8_t *out) {
    if (custom_length > kMaxCShakeCustomization) return false;
    if (bits == 0) return true;
    size_t rate = variant == 128 ? 168 : 136;
    EVP_MD *md = EVP_MD_fetch(NULL, variant == 128 ? OSSL_DIGEST_NAME_KECCAK_KMAC128 : OSSL_DIGEST_NAME_KECCAK_KMAC256,
                              NULL);
    EVP_MD_CTX *ctx = md == NULL ? NULL : EVP_MD_CTX_new();
    bool ok = ctx != NULL && EVP_DigestInit_ex(ctx, md, NULL) == 1 &&
              update_bytepad(ctx, rate, name, name_length, name_length * 8, custom, custom_length, true) &&
              (!kmac || update_bytepad(ctx, rate, key, key_length, key_bits, NULL, 0, false)) &&
              (input_length == 0 || EVP_DigestUpdate(ctx, input, input_length) == 1);
    if (ok && kmac) {
        size_t written = 0;
        ok = update_encoded_length(ctx, bits, false, &written);
    }
    ok = ok && EVP_DigestFinalXOF(ctx, out, (bits + 7) / 8) == 1;
    EVP_MD_CTX_free(ctx);
    EVP_MD_free(md);
    if (ok) truncate_to_bit_length(out, bits);
    return ok;
}

static const uint8_t kmac_name[] = {'K', 'M', 'A', 'C'};

/* Node's `KmacTraits::DeriveBits`: OpenSSL's KMAC within the limits OpenSSL
 * sets it, and cSHAKE where it refuses the shape. */
static bool derive_kmac(int variant, const uint8_t *key, size_t key_length, size_t key_bits, const uint8_t *custom,
                        size_t custom_length, const uint8_t *input, size_t input_length, size_t bits, uint8_t *out) {
    size_t out_length = (bits + 7) / 8;
    if (key_length > 512 || (key_bits + 7) / 8 > 512 || custom_length > 512 || out_length > 0xffffff / 8) {
        return false;
    }
    if (bits == 0) return true;
    if (bits % 8 != 0 || key_bits % 8 != 0 || key_length < 4) {
        if (key_length < (key_bits + 7) / 8) return false;
        return derive_cshake(variant, kmac_name, sizeof(kmac_name), custom, custom_length, key, (key_bits + 7) / 8,
                             key_bits, true, input, input_length, bits, out);
    }
    EVP_MAC *mac = EVP_MAC_fetch(NULL, variant == 128 ? OSSL_MAC_NAME_KMAC128 : OSSL_MAC_NAME_KMAC256, NULL);
    EVP_MAC_CTX *ctx = mac == NULL ? NULL : EVP_MAC_CTX_new(mac);
    OSSL_PARAM params[3];
    size_t n = 0;
    params[n++] = OSSL_PARAM_construct_size_t(OSSL_MAC_PARAM_SIZE, &out_length);
    if (custom_length > 0) {
        params[n++] = OSSL_PARAM_construct_octet_string(OSSL_MAC_PARAM_CUSTOM, (void *)custom, custom_length);
    }
    params[n] = OSSL_PARAM_construct_end();
    size_t written = 0;
    bool ok = ctx != NULL && EVP_MAC_init(ctx, key, key_length, params) == 1 &&
              EVP_MAC_update(ctx, input, input_length) == 1 && EVP_MAC_final(ctx, out, &written, out_length) == 1 &&
              written == out_length;
    EVP_MAC_CTX_free(ctx);
    EVP_MAC_free(mac);
    return ok;
}

/* -- jobs ------------------------------------------------------------------- */

typedef enum { kCShake, kKmac, kTurboShake, kKangarooTwelve } KeccakKind;

/* A job's inputs, copied: its data, a function name or key, a customization. */
typedef struct {
    KeccakKind kind;
    int variant;
    unsigned char *data;
    size_t data_length;
    unsigned char *name;
    size_t name_length;
    unsigned char *custom;
    size_t custom_length;
    size_t key_bits;
    size_t bits;
    uint8_t domain;
    unsigned char *out;
    size_t out_length;
} KeccakJob;

static void keccak_dispose(void *state) {
    KeccakJob *job = state;
    if (job->kind == kKmac) OPENSSL_cleanse(job->name, job->name_length);
    free(job->data);
    free(job->name);
    free(job->custom);
    free(job->out);
    free(job);
}

static KeccakJob *keccak_new(KeccakKind kind, double variant, NtsView *data, NtsView *name, NtsView *custom,
                             size_t bits) {
    KeccakJob *job = calloc(1, sizeof(KeccakJob));
    if (job == NULL) return NULL;
    job->kind = kind;
    job->variant = variant == 128 ? 128 : 256;
    job->bits = bits;
    job->out_length = (bits + 7) / 8;
    job->data = nts_crypto_copy_view(data, &job->data_length);
    job->name = nts_crypto_copy_view(name, &job->name_length);
    job->custom = nts_crypto_copy_view(custom, &job->custom_length);
    job->out = malloc(job->out_length == 0 ? 1 : job->out_length);
    if (job->data == NULL || job->name == NULL || job->custom == NULL || job->out == NULL) {
        keccak_dispose(job);
        return NULL;
    }
    return job;
}

static bool keccak_run(void *state) {
    KeccakJob *job = state;
    switch (job->kind) {
    case kCShake:
        return derive_cshake(job->variant, job->name, job->name_length, job->custom, job->custom_length, NULL, 0, 0,
                             false, job->data, job->data_length, job->bits, job->out);
    case kKmac:
        return derive_kmac(job->variant, job->name, job->name_length, job->key_bits, job->custom,
                           job->custom_length, job->data, job->data_length, job->bits, job->out);
    case kTurboShake: {
        TurboShake sponge;
        turboshake_init(&sponge, job->variant);
        turboshake_absorb(&sponge, job->data, job->data_length);
        turboshake_squeeze(&sponge, job->domain, job->out, job->out_length);
        return true;
    }
    case kKangarooTwelve:
        kangaroo_twelve(job->variant, job->data, job->data_length, job->custom, job->custom_length, job->out,
                        job->out_length);
        return true;
    }
    return false;
}

static void keccak_deliver(void *state, bool ok, NtsHeader *done) {
    KeccakJob *job = state;
    nts_crypto_deliver_bytes(done, ok, job->out, job->out_length);
}

static const NtsCryptoWork keccak_work = {keccak_run, keccak_deliver, keccak_dispose};

static void keccak_queue(KeccakJob *job, NtsHeader *done) {
    if (job != NULL) nts_crypto_queue_work(&keccak_work, job, done);
}

/* cSHAKE128 or cSHAKE256 of `data` under a function name and customization,
 * `length` bits of it. */
void nts_crypto_cshake_job(double variant, NtsView *data, NtsView *function_name, NtsView *customization,
                           double length, NtsHeader *done) {
    keccak_queue(keccak_new(kCShake, variant, data, function_name, customization, (size_t)length), done);
}

/* KMAC128 or KMAC256 of `data` under a key of `key_length` bits, `length`
 * bits of it. */
void nts_crypto_kmac_job(double variant, NtsView *key, double key_length, NtsView *data, NtsView *customization,
                         double length, NtsHeader *done) {
    KeccakJob *job = keccak_new(kKmac, variant, data, key, customization, (size_t)length);
    if (job != NULL) job->key_bits = (size_t)key_length;
    keccak_queue(job, done);
}

/* TurboSHAKE128 or TurboSHAKE256 of `data` under a domain byte, `length`
 * bytes of it. */
void nts_crypto_turboshake_job(double variant, double domain, double length, NtsView *data, NtsHeader *done) {
    KeccakJob *job = keccak_new(kTurboShake, variant, data, NULL, NULL, (size_t)length * 8);
    if (job != NULL) job->domain = (uint8_t)domain;
    keccak_queue(job, done);
}

/* KT128 or KT256 of `data` under a customization, `length` bytes of it. */
void nts_crypto_kangaroo_twelve_job(double variant, NtsView *customization, double length, NtsView *data,
                                    NtsHeader *done) {
    keccak_queue(keccak_new(kKangarooTwelve, variant, data, NULL, customization, (size_t)length * 8), done);
}
