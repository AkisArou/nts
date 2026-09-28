/* `crypto.c`, `cipher.c`, `keys.c`, `sig.c`, `rsa.c`, `keygen.c`, `dh.c`, `prime.c`, `argon2.c`, `kem.c`,
 * `spkac.c`, `x509.c` and `aes.c`, called directly.
 *
 * The TypeScript over these natives runs on node against node's own crypto,
 * so nothing but this runs the C: the compiled lane refuses every public
 * crypto function today, for compiler reasons recorded with the module. Each
 * check is a published known answer -- FIPS 180 and 202 digests, RFC 4231
 * HMAC, RFC 6070 PBKDF2, RFC 5869 HKDF, RFC 7914 scrypt, SP 800-38A AES,
 * RFC 8032 Ed25519, RFC 7748 X25519, RFC 9106 Argon2 --
 * or a round trip through OpenSSL, or node's own behaviour where it is
 * node's rather than a standard's: PBKDF2 and HKDF of length 0 fail, scrypt's
 * answers empty, SHAKE's default length, which statuses a cipher answers.
 *
 * Run from the repository root, which is where the fixture keys are:
 *
 *   tooling/conformance/c-tests.sh
 */
#if defined(__linux__) && !defined(_GNU_SOURCE)
#define _GNU_SOURCE
#endif

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <uv.h>

#include "nts_crypto.h"
#include "shared.h"

const uint32_t nts_closure_call_slot = 0;

static int failures;

static void expect_true(const char *what, bool ok) {
    printf("%s %s\n", ok ? "ok  " : "FAIL", what);
    if (!ok) failures++;
}

static NtsString *text(const char *value) { return nts_string_from_utf8(value, strlen(value)); }

static NtsView *bytes(const void *data, size_t length) { return nts_view_from_bytes(data, (double)length); }

static NtsView *utf8(const char *value) { return bytes(value, strlen(value)); }

static NtsView *hex(const char *digits) {
    size_t length = strlen(digits) / 2;
    unsigned char *out = malloc(length == 0 ? 1 : length);
    for (size_t i = 0; i < length; i++) sscanf(digits + 2 * i, "%2hhx", &out[i]);
    NtsView *view = bytes(out, length);
    free(out);
    return view;
}

static bool is_hex(NtsView *view, const char *digits) {
    if (view == NULL) return false;
    size_t length = (size_t)nts_view_byte_length(view);
    if (strlen(digits) != length * 2) return false;
    const unsigned char *data = nts_view_bytes(view);
    for (size_t i = 0; i < length; i++) {
        char pair[3];
        snprintf(pair, sizeof(pair), "%02x", data[i]);
        if (strncmp(pair, digits + 2 * i, 2) != 0) return false;
    }
    return true;
}

/* The error record's text, joined, for a substring check. */
static bool errors_mention(const char *needle) {
    NtsArray *record = nts_crypto_take_errors();
    NtsString **items = NTS_ITEMS(record, NtsString *);
    bool found = false;
    for (uint32_t i = 0; i < record->header.length && !found; i++) {
        size_t length = 0;
        char *value = nts_node_to_utf8_alloc(items[i], &length);
        found = value != NULL && strstr(value, needle) != NULL;
        free(value);
    }
    return found;
}

static char *string_of(NtsString *value) {
    size_t length = 0;
    return nts_node_to_utf8_alloc(value, &length);
}

static NtsView *file(const char *path) {
    FILE *f = fopen(path, "rb");
    if (f == NULL) return bytes("", 0);
    static unsigned char buffer[1 << 16];
    size_t length = fread(buffer, 1, sizeof(buffer), f);
    fclose(f);
    return bytes(buffer, length);
}

/* ------------------------------------------------------------ digests */

static void digests(void) {
    double sha256 = nts_crypto_digest_id(text("sha256"));
    expect_true("sha256 is known", sha256 >= 0);
    expect_true("an unknown digest is -1", nts_crypto_digest_id(text("nope")) == -1);
    expect_true("sha256 is 32 bytes", nts_crypto_digest_size(sha256) == 32);

    double handle = nts_crypto_hash_new(sha256, -1);
    expect_true("a hash context opens", handle > 0);
    nts_crypto_update_utf8(handle, text("a"));
    nts_crypto_update(handle, utf8("bc"));
    expect_true("sha256(abc), FIPS 180-2", is_hex(nts_crypto_final(handle),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
    expect_true("a finished context is gone", !nts_crypto_update(handle, utf8("x")));

    double copied = nts_crypto_hash_new(sha256, -1);
    nts_crypto_update(copied, utf8("ab"));
    double copy = nts_crypto_hash_copy(copied, -1);
    nts_crypto_update(copy, utf8("c"));
    expect_true("a copy carries the state", is_hex(nts_crypto_final(copy),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"));
    nts_crypto_release(copied);

    double shake = nts_crypto_digest_id(text("shake128"));
    expect_true("shake128 is an XOF", nts_crypto_digest_is_xof(shake));
    expect_true("SHAKE128 defaults to 16 bytes, node's DEP0198 length",
                is_hex(nts_crypto_final(nts_crypto_hash_new(shake, -1)), "7f9c2ba4e88f827d616045507605853e"));
    expect_true("SHAKE128 at 8 bytes", is_hex(nts_crypto_digest(shake, utf8(""), 8), "7f9c2ba4e88f827d"));

    expect_true("an output length on a non-XOF fails", nts_crypto_hash_new(sha256, 5) == 0);
    expect_true("  and says why", errors_mention("not XOF or invalid length"));

    expect_true("sha512(\"\") one-shot, FIPS 180-2",
                is_hex(nts_crypto_digest_utf8(nts_crypto_digest_id(text("sha512")), text(""), -1),
                       "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce"
                       "47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e"));

    double hmac = nts_crypto_hmac_new(sha256, hex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"));
    nts_crypto_update(hmac, utf8("Hi There"));
    expect_true("HMAC-SHA256, RFC 4231 case 1", is_hex(nts_crypto_final(hmac),
        "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"));
    double empty_key = nts_crypto_hmac_new(sha256, bytes("", 0));
    expect_true("HMAC takes an empty key", empty_key > 0);
    expect_true("  HMAC-SHA256('', '')", is_hex(nts_crypto_final(empty_key),
        "b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad"));

    NtsArray *names = nts_crypto_hash_names();
    expect_true("getHashes has names", names->header.length > 10);
}

/* --------------------------------------------------------- derivations */

static int jobs_done;
static bool job_ok;
static char job_hex[8192];

static void on_job(NtsHeader *self, bool ok, NtsView *out) {
    (void)self;
    jobs_done++;
    job_ok = ok;
    job_hex[0] = '\0';
    size_t length = (size_t)nts_view_byte_length(out);
    const unsigned char *data = nts_view_bytes(out);
    for (size_t i = 0; i < length && 2 * i + 2 < sizeof(job_hex); i++) {
        snprintf(job_hex + 2 * i, 3, "%02x", data[i]);
    }
}

static void *const job_methods[] = {(void *)(void (*)(NtsHeader *, bool, NtsView *))on_job};
static const NtsDescriptor job_desc = {
    NTS_KIND_OBJECT, (uint32_t)sizeof(NtsHeader), 0u, 0u, NULL, job_methods, "OnJob", 0u, NULL,
};
static NtsHeader job_callback = {&job_desc, NTS_IMMORTAL, 0u, 0u};

static void derivations(void) {
    double sha1 = nts_crypto_digest_id(text("sha1"));
    double sha256 = nts_crypto_digest_id(text("sha256"));
    expect_true("PBKDF2-SHA1, RFC 6070 case 1",
                is_hex(nts_crypto_pbkdf2(utf8("password"), utf8("salt"), 1, 20, sha1),
                       "0c60c80f961f0e71f3a9b524af6012062fe037a6"));
    expect_true("PBKDF2 of length 0 fails, as node's does",
                nts_crypto_pbkdf2(utf8("p"), utf8("s"), 1, 0, sha256) == NULL);

    expect_true("HKDF-SHA256, RFC 5869 case 1",
                is_hex(nts_crypto_hkdf(sha256, hex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"),
                                       hex("000102030405060708090a0b0c"), hex("f0f1f2f3f4f5f6f7f8f9"), 42),
                       "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"));
    expect_true("HKDF with no salt takes HashLen zeros, RFC 5869 case 3",
                is_hex(nts_crypto_hkdf(sha256, hex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"), bytes("", 0),
                                       bytes("", 0), 42),
                       "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8"));
    expect_true("HKDF of length 0 fails", nts_crypto_hkdf(sha256, utf8("k"), utf8("s"), utf8("i"), 0) == NULL);
    expect_true("HKDF of an empty key is node's answer, which is why the extract step is by hand",
                is_hex(nts_crypto_hkdf(sha256, bytes("", 0), utf8("salt"), utf8("info"), 32),
                       "7aac7b8120501c2c8e1ee50e6cde135361e99ceb9d8d406ac528b9e9175614c0"));

    expect_true("scrypt parameters N=16 r=1 p=1 are valid", nts_crypto_scrypt_valid(16, 1, 1, 32 << 20));
    expect_true("N=3 is not", !nts_crypto_scrypt_valid(3, 1, 1, 32 << 20));
    nts_crypto_take_errors();
    expect_true("scrypt, RFC 7914 case 1",
                is_hex(nts_crypto_scrypt(bytes("", 0), bytes("", 0), 16, 1, 1, 32 << 20, 64),
                       "77d6576238657b203b19ca42c18a0497f16b4844e3074ae8dfdffa3fede21442"
                       "fcd0069ded0948f8326a753a0fc81f17e8d3e0fb2e0d3628cf35e20c38d18906"));
    NtsView *nothing = nts_crypto_scrypt(utf8("p"), utf8("s"), 16, 1, 1, 32 << 20, 0);
    expect_true("scrypt of length 0 is empty", nothing != NULL && nts_view_byte_length(nothing) == 0);

    nts_crypto_pbkdf2_job(utf8("password"), utf8("salt"), 2, 20, sha1, &job_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("a PBKDF2 job calls back once, RFC 6070 case 2",
                jobs_done == 1 && job_ok && strcmp(job_hex, "ea6c014dc72d6f8ccd1ed92ace1d41f0d8de8957") == 0);

    nts_crypto_hkdf_job(sha256, utf8("k"), utf8("s"), utf8("i"), 0, &job_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("a failing job calls back with ok false", jobs_done == 2 && !job_ok);

    nts_crypto_digest_job(sha256, utf8("abc"), -1, &job_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("a digest job, FIPS 180-2's sha256(abc)",
                jobs_done == 3 && job_ok &&
                    strcmp(job_hex, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad") == 0);
    nts_crypto_digest_job(nts_crypto_digest_id(text("shake128")), utf8(""), 8, &job_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("  an XOF's at the length asked", jobs_done == 4 && job_ok && strcmp(job_hex, "7f9c2ba4e88f827d") == 0);
    nts_crypto_hmac_job(sha256, hex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"), utf8("Hi There"), &job_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("an HMAC job, RFC 4231 case 1",
                jobs_done == 5 && job_ok &&
                    strcmp(job_hex, "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7") == 0);
    nts_crypto_hmac_job(sha256, bytes("", 0), bytes("", 0), &job_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("  under an empty key", jobs_done == 6 && job_ok &&
                    strcmp(job_hex, "b613679a0814d9ec772f95d778c35fc5ff1697c493715653c6c712144292c5ad") == 0);

    unsigned char zeros[64] = {0};
    NtsView *target = bytes(zeros, sizeof(zeros));
    expect_true("random fill fills", nts_crypto_random_fill(target, 8, 32));
    const unsigned char *filled = nts_view_bytes(target);
    bool head_untouched = true;
    bool middle_changed = false;
    for (int i = 0; i < 8; i++) head_untouched = head_untouched && filled[i] == 0;
    for (int i = 8; i < 40; i++) middle_changed = middle_changed || filled[i] != 0;
    expect_true("  within its range only", head_untouched && middle_changed);

    expect_true("timingSafeEqual on equal bytes", nts_crypto_timing_safe_equal(utf8("abc"), utf8("abc")));
    expect_true("timingSafeEqual on different bytes", !nts_crypto_timing_safe_equal(utf8("abc"), utf8("abd")));
}

/* ------------------------------------------------------------- ciphers */

static void ciphers(void) {
    double cbc = nts_crypto_cipher_id(text("aes-128-cbc"));
    expect_true("aes-128-cbc is known", cbc >= 0);
    expect_true("an unknown cipher is -1", nts_crypto_cipher_id(text("nope")) == -1);

    NtsView *key = hex("2b7e151628aed2a6abf7158809cf4f3c");
    NtsView *iv = hex("000102030405060708090a0b0c0d0e0f");
    double enc = nts_crypto_cipher_new(cbc, true, key, iv, -1);
    expect_true("a cipher opens", enc > 0);
    nts_crypto_cipher_set_auto_padding(enc, false);
    expect_true("AES-128-CBC, SP 800-38A F.2.1 block 1",
                is_hex(nts_crypto_cipher_update(enc, hex("6bc1bee22e409f96e93d7e117393172a")),
                       "7649abac8119b246cee98e9b12e9197d"));
    NtsView *tail = nts_crypto_cipher_final(enc);
    expect_true("  and no padding block", tail != NULL && nts_view_byte_length(tail) == 0);
    expect_true("a second final is an invalid state",
                nts_crypto_cipher_final(enc) == NULL && nts_crypto_cipher_status() == -8);

    expect_true("a short IV is refused", nts_crypto_cipher_new(cbc, true, key, hex("0001"), -1) == -1);
    expect_true("no IV where one is needed is refused", nts_crypto_cipher_new(cbc, true, key, bytes("", 0), -1) == -1);
    expect_true("a short key is refused", nts_crypto_cipher_new(cbc, true, hex("00"), iv, -1) == -2);

    double gcm = nts_crypto_cipher_id(text("aes-128-gcm"));
    NtsView *nonce = hex("000000000000000000000000");
    double seal = nts_crypto_cipher_new(gcm, true, key, nonce, -1);
    expect_true("GCM takes AAD", nts_crypto_cipher_set_aad(seal, utf8("aad"), -1) == 1);
    NtsView *sealed = nts_crypto_cipher_update(seal, utf8("secret"));
    nts_crypto_cipher_final(seal);
    NtsView *tag = nts_crypto_cipher_auth_tag(seal);
    expect_true("GCM computes a 16-byte tag", tag != NULL && nts_view_byte_length(tag) == 16);
    double open = nts_crypto_cipher_new(gcm, false, key, nonce, -1);
    nts_crypto_cipher_set_aad(open, utf8("aad"), -1);
    expect_true("GCM takes the tag", nts_crypto_cipher_set_auth_tag(open, tag) == 1);
    NtsView *opened = nts_crypto_cipher_update(open, sealed);
    expect_true("GCM round trips", opened != NULL && nts_view_byte_length(opened) == 6 &&
                                      memcmp(nts_view_bytes(opened), "secret", 6) == 0);
    expect_true("  and authenticates", nts_crypto_cipher_final(open) != NULL);

    double forged = nts_crypto_cipher_new(gcm, false, key, nonce, -1);
    nts_crypto_cipher_set_auth_tag(forged, hex("00000000000000000000000000000000"));
    nts_crypto_cipher_update(forged, sealed);
    expect_true("a wrong tag does not authenticate",
                nts_crypto_cipher_final(forged) == NULL && nts_crypto_cipher_status() == -10);
    nts_crypto_take_errors();

    double short_tag = nts_crypto_cipher_new(gcm, false, key, nonce, -1);
    nts_crypto_cipher_set_auth_tag(short_tag, hex("00000000"));
    expect_true("a short GCM tag without authTagLength is DEP0182", nts_crypto_cipher_status() == -9);
    expect_true("GCM refuses a 5-byte tag length", nts_crypto_cipher_new(gcm, true, key, nonce, 5) == -4);

    double ccm = nts_crypto_cipher_id(text("aes-128-ccm"));
    expect_true("CCM needs a tag length", nts_crypto_cipher_new(ccm, true, key, nonce, -1) == -3);
    double ccm_seal = nts_crypto_cipher_new(ccm, true, key, nonce, 16);
    expect_true("CCM with AAD needs the plaintext length", nts_crypto_cipher_set_aad(ccm_seal, utf8("a"), -1) == -7);

    char *mode = string_of(nts_crypto_cipher_mode(gcm));
    char *name = string_of(nts_crypto_cipher_name(gcm));
    NtsArray *info = nts_crypto_cipher_info(gcm, -1, -1);
    double *facts = NTS_ITEMS(info, double);
    expect_true("getCipherInfo(aes-128-gcm)", strcmp(mode, "gcm") == 0 && strcmp(name, "id-aes128-GCM") == 0 &&
                                                   info->header.length == 4 && facts[0] == 895 && facts[2] == 12 &&
                                                   facts[3] == 16);
    free(mode);
    free(name);
    expect_true("an IV length CCM cannot take is no info",
                nts_crypto_cipher_info(ccm, -1, 14)->header.length == 0);
    expect_true("getCiphers has names", nts_crypto_cipher_names()->header.length > 50);
}

/* ------------------------------------------------------------------ keys */

#define KEYS "third_party/node/test/fixtures/keys/"

static void keys(void) {
    NtsView *none = bytes("", 0);
    double rsa = nts_crypto_key_parse_private(1, -1, file(KEYS "rsa_private.pem"), none, false);
    expect_true("an RSA private key parses", rsa > 0);
    char *type = string_of(nts_crypto_key_type(rsa));
    expect_true("  as rsa", strcmp(type, "rsa") == 0);
    free(type);
    double *details = NTS_ITEMS(nts_crypto_key_details(rsa), double);
    expect_true("  with a 2048-bit modulus", details[0] == 2048);
    expect_true("  and exponent 65537", is_hex(nts_crypto_key_public_exponent(rsa), "010001"));

    double pub = nts_crypto_key_parse_public(1, -1, file(KEYS "rsa_public.pem"), none, false);
    expect_true("its public key parses, and equals it", pub > 0 && nts_crypto_key_equals(rsa, pub));
    double from_private = nts_crypto_key_parse_public(1, -1, file(KEYS "rsa_private.pem"), none, false);
    expect_true("a private PEM answers for its public half", nts_crypto_key_equals(from_private, pub));
    double from_cert = nts_crypto_key_parse_public(1, -1, file(KEYS "agent1-cert.pem"), none, false);
    expect_true("a certificate answers with its key", from_cert > 0);

    NtsView *spki = nts_crypto_key_export_public(rsa, 0, 2);
    double reparsed = nts_crypto_key_parse_public(0, 2, spki, none, false);
    expect_true("SPKI DER round trips", reparsed > 0 && nts_crypto_key_equals(reparsed, rsa));
    NtsView *pkcs1 = nts_crypto_key_export_public(rsa, 0, 0);
    expect_true("PKCS#1 public DER round trips", nts_crypto_key_equals(nts_crypto_key_parse_public(0, 0, pkcs1, none, false), rsa));
    NtsView *pkcs1_private = nts_crypto_key_export_private(rsa, 0, 0, -1, none);
    expect_true("PKCS#1 private DER, read as public, is the private key's half",
                nts_crypto_key_equals(nts_crypto_key_parse_public(0, 0, pkcs1_private, none, false), rsa));

    double aes = nts_crypto_cipher_id(text("aes-256-cbc"));
    NtsView *encrypted = nts_crypto_key_export_private(rsa, 1, 1, aes, utf8("pw"));
    expect_true("an encrypted PKCS#8 PEM is written", encrypted != NULL &&
        memcmp(nts_view_bytes(encrypted), "-----BEGIN ENCRYPTED PRIVATE KEY-----", 37) == 0);
    expect_true("  and needs its passphrase", nts_crypto_key_parse_private(1, -1, encrypted, none, false) <= 0);
    nts_crypto_take_errors();
    expect_true("  and opens with it",
                nts_crypto_key_equals(nts_crypto_key_parse_private(1, -1, encrypted, utf8("pw"), true), rsa));

    NtsArray *jwk = nts_crypto_key_export_jwk(rsa, true);
    expect_true("an RSA private JWK has eight members", jwk->header.length == 8);
    expect_true("  which import back", nts_crypto_key_equals(nts_crypto_key_from_jwk_rsa(jwk, true), rsa));

    double ec = nts_crypto_key_parse_private(1, -1, file(KEYS "ec_p256_private.pem"), none, false);
    NtsArray *names = nts_crypto_key_detail_names(ec);
    char *curve = string_of(NTS_ITEMS(names, NtsString *)[0]);
    expect_true("an EC key names its curve", strcmp(curve, "prime256v1") == 0);
    free(curve);
    NtsArray *ec_jwk = nts_crypto_key_export_jwk(ec, true);
    NtsView **parts = NTS_ITEMS(ec_jwk, NtsView *);
    expect_true("an EC JWK has x, y and d, 32 bytes each", ec_jwk->header.length == 3 &&
                                                              nts_view_byte_length(parts[0]) == 32 &&
                                                              nts_view_byte_length(parts[2]) == 32);
    expect_true("  which import back",
                nts_crypto_key_equals(nts_crypto_key_from_jwk_ec(text("P-256"), parts[0], parts[1], parts[2], true), ec));
    NtsArray *curves = nts_crypto_curve_names();
    bool has_p256 = false;
    for (uint32_t i = 0; i < curves->header.length; i++) {
        char *name = string_of(NTS_ITEMS(curves, NtsString *)[i]);
        has_p256 = has_p256 || strcmp(name, "prime256v1") == 0;
        free(name);
    }
    expect_true("getCurves names prime256v1 among dozens", has_p256 && curves->header.length > 50);
    expect_true("an unknown curve is its own status",
                nts_crypto_key_from_jwk_ec(text("nope"), parts[0], parts[1], parts[2], true) == -2);
    expect_true("a point off the curve is refused",
                nts_crypto_key_from_jwk_ec(text("P-256"), parts[0], parts[0], parts[2], false) == 0);
    NtsView *raw_point = nts_crypto_key_export_raw(ec, false, true);
    expect_true("a compressed point is 33 bytes", raw_point != NULL && nts_view_byte_length(raw_point) == 33);
    expect_true("  and imports back",
                nts_crypto_key_equals(nts_crypto_key_from_raw_ec(text("prime256v1"), raw_point, false), ec));

    double ed = nts_crypto_key_parse_private(1, -1, file(KEYS "ed25519_private.pem"), none, false);
    NtsView *seed = nts_crypto_key_export_raw(ed, true, false);
    expect_true("an Ed25519 raw private key is 32 bytes", seed != NULL && nts_view_byte_length(seed) == 32);
    expect_true("  and imports back", nts_crypto_key_equals(nts_crypto_key_from_okp(text("Ed25519"), seed, true), ed));
    expect_true("an unknown OKP curve is its own status", nts_crypto_key_from_okp(text("nope"), seed, true) == -3);

    double pss = nts_crypto_key_parse_private(1, -1, file(KEYS "rsa_pss_private_2048_sha256_sha256_16.pem"), none, false);
    NtsArray *pss_names = nts_crypto_key_detail_names(pss);
    char *digest = string_of(NTS_ITEMS(pss_names, NtsString *)[1]);
    char *mgf1 = string_of(NTS_ITEMS(pss_names, NtsString *)[2]);
    double *pss_details = NTS_ITEMS(nts_crypto_key_details(pss), double);
    expect_true("an RSA-PSS key reports its restrictions",
                strcmp(digest, "sha256") == 0 && strcmp(mgf1, "sha256") == 0 && pss_details[2] == 16);
    free(digest);
    free(mgf1);
    expect_true("  and has no JWK", nts_crypto_key_export_jwk(pss, false)->header.length == 0 &&
                                        nts_crypto_key_status() == -3);

    /* ncrypto's provider forms, which node's answers show. */
    NtsView *traditional = nts_crypto_key_export_private(rsa, 1, 0, aes, none);
    expect_true("PKCS#1 PEM under a cipher and an empty passphrase is legacy PEM encryption, and no prompt",
                traditional != NULL && memmem(nts_view_bytes(traditional), (size_t)nts_view_byte_length(traditional),
                                              "Proc-Type: 4,ENCRYPTED", 22) != NULL);
    expect_true("  and opens with the empty passphrase",
                nts_crypto_key_equals(nts_crypto_key_parse_private(1, -1, traditional, none, true), rsa));
    NtsView *empty_pkcs8 = nts_crypto_key_export_private(rsa, 1, 1, aes, none);
    expect_true("PKCS#8 under an empty passphrase round trips too",
                nts_crypto_key_equals(nts_crypto_key_parse_private(1, -1, empty_pkcs8, none, true), rsa));
    NtsView *sec1 = nts_crypto_key_export_private(ec, 0, 3, -1, none);
    double sec1_as_pkcs1 = nts_crypto_key_parse_private(0, 0, sec1, none, false);
    expect_true("SEC1 DER named as PKCS#1 is still read, as an EC key -- the type is not a check ncrypto makes",
                sec1_as_pkcs1 > 0 && nts_crypto_key_equals(sec1_as_pkcs1, ec));
    expect_true("an EC key has no PKCS#1 form", nts_crypto_key_export_private(ec, 0, 0, -1, none) == NULL);
    nts_crypto_take_errors();

    expect_true("garbage is not a key", nts_crypto_key_parse_private(1, -1, utf8("garbage"), none, false) == 0);
    expect_true("  and OpenSSL says so", errors_mention("DECODER routines::unsupported"));
}

/* ---------------------------------------------------------- signatures */

static bool same_bytes(NtsView *a, NtsView *b) {
    return a != NULL && b != NULL && nts_view_byte_length(a) == nts_view_byte_length(b) &&
           memcmp(nts_view_bytes(a), nts_view_bytes(b), (size_t)nts_view_byte_length(a)) == 0;
}

/* A stream's signature: `update` then `sign_final`, as `Sign` does it. */
static NtsView *stream_sign(double digest, const char *data, double key, double padding, double salt) {
    double handle = nts_crypto_sign_init(digest);
    nts_crypto_update(handle, utf8(data));
    return nts_crypto_sign_final(handle, key, padding, salt);
}

static double stream_verify(double digest, const char *data, double key, NtsView *signature, double padding,
                            double salt) {
    double handle = nts_crypto_sign_init(digest);
    nts_crypto_update(handle, utf8(data));
    return nts_crypto_verify_final(handle, key, signature, padding, salt);
}

static void signatures(void) {
    NtsView *none = bytes("", 0);
    double sha256 = nts_crypto_digest_id(text("sha256"));

    double seed = nts_crypto_key_from_okp(
        text("Ed25519"), hex("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"), true);
    double point = nts_crypto_key_from_okp(
        text("Ed25519"), hex("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"), false);
    NtsView *ed_sig = nts_crypto_sign_job_sync(false, seed, none, -1, NAN, NAN, none, none);
    expect_true("Ed25519, RFC 8032 test 1",
                is_hex(ed_sig, "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e3970"
                               "1cf9b46bd25bf5f0595bbe24655141438e7a100b"));
    expect_true("  verifies with its public key",
                is_hex(nts_crypto_sign_job_sync(true, point, none, -1, NAN, NAN, none, ed_sig), "01"));
    expect_true("  and not for other data",
                is_hex(nts_crypto_sign_job_sync(true, point, utf8("x"), -1, NAN, NAN, none, ed_sig), "00"));
    expect_true("an Ed25519 key cannot finish a stream", nts_crypto_key_is_one_shot(seed));
    double ctx_seed = nts_crypto_key_from_okp(
        text("Ed25519"), hex("0305334e381af78f141cb666f6199f57bc3495335a256a95bd2a55bf546663f6"), true);
    expect_true("Ed25519ctx, RFC 8032 7.2 -- a context switches the instance, not only a parameter",
                is_hex(nts_crypto_sign_job_sync(false, ctx_seed, hex("f726936d19c800494e3fdaff20b276a8"), -1, NAN, NAN,
                                                hex("666f6f"), none),
                       "55a4cc2f70a54e04288c5f4cd1e45a7bb520b36292911876cada7323198dd87a"
                       "8b36950b95130022907a7fb7c4e9b2d5f6cca685a587b4b21f4b888e4e7edb0d"));

    unsigned char identity[32] = {1};
    unsigned char small_order_sig[64] = {1};
    double weak = nts_crypto_key_from_okp(text("Ed25519"), bytes(identity, 32), false);
    expect_true("a small-order key and signature verify nothing, as node decides",
                is_hex(nts_crypto_sign_job_sync(true, weak, utf8("anything"), -1, NAN, NAN, none,
                                                bytes(small_order_sig, 64)),
                       "00"));
    nts_crypto_take_errors();

    double rsa = nts_crypto_key_parse_private(1, -1, file(KEYS "rsa_private.pem"), none, false);
    double rsa_public = nts_crypto_key_parse_public(1, -1, file(KEYS "rsa_public.pem"), none, false);
    expect_true("an RSA key can finish a stream", !nts_crypto_key_is_one_shot(rsa));
    NtsView *streamed = stream_sign(sha256, "abc", rsa, NAN, NAN);
    expect_true("an RSA stream signs with the key's size", streamed != NULL && nts_view_byte_length(streamed) == 256);
    expect_true("  the same bytes as the one-shot form, PKCS#1 v1.5 being deterministic",
                same_bytes(streamed, nts_crypto_sign_job_sync(false, rsa, utf8("abc"), sha256, NAN, NAN, none, none)));
    expect_true("  which verify with the public key", stream_verify(sha256, "abc", rsa_public, streamed, NAN, NAN) == 1);
    expect_true("  and not for other data", stream_verify(sha256, "abd", rsa_public, streamed, NAN, NAN) == 0);

    NtsView *pss = stream_sign(sha256, "abc", rsa, 6, -2);
    expect_true("RSA-PSS with the longest salt verifies with the salt recovered",
                stream_verify(sha256, "abc", rsa_public, pss, 6, -2) == 1);
    expect_true("  but not as PKCS#1 v1.5", stream_verify(sha256, "abc", rsa_public, pss, 1, NAN) == 0);

    expect_true("an unknown padding fails", stream_sign(sha256, "abc", rsa, 99, NAN) == NULL);
    expect_true("  with OpenSSL's reason", errors_mention("illegal or unsupported padding mode"));
    expect_true("  and so does verifying with it", stream_verify(sha256, "abc", rsa_public, streamed, 99, NAN) == 0);

    double handle = nts_crypto_sign_init(sha256);
    nts_crypto_sign_final(handle, rsa, NAN, NAN);
    expect_true("a finished stream is gone", nts_crypto_sign_final(handle, rsa, NAN, NAN) == NULL);
    nts_crypto_take_errors();

    NtsView *context = nts_crypto_sign_job_sync(false, rsa, utf8("abc"), sha256, NAN, NAN, utf8("ctx"), none);
    expect_true("an RSA key refuses a context string", context == NULL && nts_crypto_sign_status() == -3);
    nts_crypto_take_errors();

    double ec = nts_crypto_key_parse_private(1, -1, file(KEYS "ec_p256_private.pem"), none, false);
    expect_true("P-256's r and s are 32 bytes each", nts_crypto_key_dsa_size(ec) == 32);
    expect_true("  and an RSA key has none", nts_crypto_key_dsa_size(rsa) == 0);
    NtsView *der = stream_sign(sha256, "abc", ec, NAN, NAN);
    NtsView *p1363 = nts_crypto_signature_to_p1363(32, der);
    expect_true("an ECDSA signature converts to IEEE P1363", p1363 != NULL && nts_view_byte_length(p1363) == 64);
    expect_true("  and back to the same DER", same_bytes(nts_crypto_signature_to_der(32, p1363), der));
    expect_true("  which verifies", stream_verify(sha256, "abc", ec, der, NAN, NAN) == 1);
    expect_true("P1363 of the wrong length is malformed", nts_crypto_signature_to_der(32, bytes(identity, 32)) == NULL);
    expect_true("DER that does not parse does not convert", nts_crypto_signature_to_p1363(32, utf8("garbage")) == NULL);

    nts_crypto_sign_job(true, ec, utf8("abc"), sha256, NAN, NAN, none, der, &job_callback);
    int before = jobs_done;
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("a verification job calls back once, with a true byte",
                jobs_done == before + 1 && job_ok && strcmp(job_hex, "01") == 0);
}

/* ------------------------------------------------------ RSA encryption */

static void rsa_encryption(void) {
    NtsView *none = bytes("", 0);
    double sha256 = nts_crypto_digest_id(text("sha256"));
    double rsa = nts_crypto_key_parse_private(1, -1, file(KEYS "rsa_private.pem"), none, false);
    double rsa_public = nts_crypto_key_parse_public(1, -1, file(KEYS "rsa_public.pem"), none, false);
    NtsView *message = utf8("attack at dawn");

    NtsView *oaep = nts_crypto_public_key_cipher(0, rsa_public, message, 4, -1, none);
    expect_true("OAEP encrypts to the modulus's size", oaep != NULL && nts_view_byte_length(oaep) == 256);
    expect_true("  and decrypts", same_bytes(nts_crypto_public_key_cipher(1, rsa, oaep, 4, -1, none), message));
    expect_true("  but not under another digest", nts_crypto_public_key_cipher(1, rsa, oaep, 4, sha256, none) == NULL);
    expect_true("  which OpenSSL explains", errors_mention("oaep decoding error"));

    NtsView *labelled = nts_crypto_public_key_cipher(0, rsa_public, message, 4, sha256, utf8("label"));
    expect_true("OAEP-SHA256 with a label round trips",
                same_bytes(nts_crypto_public_key_cipher(1, rsa, labelled, 4, sha256, utf8("label")), message));
    expect_true("  and needs the same label",
                nts_crypto_public_key_cipher(1, rsa, labelled, 4, sha256, utf8("other")) == NULL);
    nts_crypto_take_errors();

    expect_true("PKCS#1 v1.5 private decryption has implicit rejection here", nts_crypto_rsa_implicit_rejection(rsa) == 1);
    NtsView *pkcs1 = nts_crypto_public_key_cipher(0, rsa_public, message, 1, -1, none);
    expect_true("  and round trips", same_bytes(nts_crypto_public_key_cipher(1, rsa, pkcs1, 1, -1, none), message));
    double ec = nts_crypto_key_parse_private(1, -1, file(KEYS "ec_p256_private.pem"), none, false);
    expect_true("an EC key cannot be asked", nts_crypto_rsa_implicit_rejection(ec) == 0);
    nts_crypto_take_errors();

    /* A PKCS#1 v1.5 signature is the private operation over a DigestInfo, so
     * the two must agree to the byte. */
    NtsView *digest_info = hex("3031300d060960864801650304020105000420"
                               "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    NtsView *raw = nts_crypto_public_key_cipher(2, rsa, digest_info, 1, -1, none);
    expect_true("privateEncrypt of SHA-256's DigestInfo for \"abc\" is its RSA signature",
                same_bytes(raw, stream_sign(sha256, "abc", rsa, NAN, NAN)));
    expect_true("  and publicDecrypt recovers the DigestInfo",
                same_bytes(nts_crypto_public_key_cipher(3, rsa_public, raw, 1, -1, none), digest_info));
    expect_true("a public key cannot decrypt", nts_crypto_public_key_cipher(1, rsa_public, oaep, 4, -1, none) == NULL);
    nts_crypto_take_errors();
}

/* ------------------------------------------------------ key generation */

static int keygen_calls;
static bool keygen_ok;
static double keygen_key;

static void on_keygen(NtsHeader *self, bool ok, double key) {
    (void)self;
    keygen_calls++;
    keygen_ok = ok;
    keygen_key = key;
}

static void *const keygen_methods[] = {(void *)(void (*)(NtsHeader *, bool, double))on_keygen};
static const NtsDescriptor keygen_desc = {
    NTS_KIND_OBJECT, (uint32_t)sizeof(NtsHeader), 0u, 0u, NULL, keygen_methods, "OnKeygen", 0u, NULL,
};
static NtsHeader keygen_callback = {&keygen_desc, NTS_IMMORTAL, 0u, 0u};

static bool key_type_is(double key, const char *expected) {
    char *type = string_of(nts_crypto_key_type(key));
    bool same = strcmp(type, expected) == 0;
    free(type);
    return same;
}

/* A generated key signs, and its public half verifies: the pair is a pair. */
static bool signs_and_verifies(double key) {
    NtsView *none = bytes("", 0);
    double sha256 = nts_crypto_digest_id(text("sha256"));
    bool one_shot = nts_crypto_key_is_one_shot(key);
    double digest = one_shot ? -1 : sha256;
    NtsView *signature = nts_crypto_sign_job_sync(false, key, utf8("pair"), digest, NAN, NAN, none, none);
    double public_half = nts_crypto_key_parse_public(0, 2, nts_crypto_key_export_public(key, 0, 2), none, false);
    return signature != NULL &&
           is_hex(nts_crypto_sign_job_sync(true, public_half, utf8("pair"), digest, NAN, NAN, none, signature), "01");
}

static void key_generation(void) {
    double sha256 = nts_crypto_digest_id(text("sha256"));

    double rsa = nts_crypto_keygen_run(nts_crypto_keygen_rsa(false, 1024, 3, -1, -1, -1));
    double *rsa_details = NTS_ITEMS(nts_crypto_key_details(rsa), double);
    expect_true("an RSA key of 1024 bits is generated", rsa > 0 && key_type_is(rsa, "rsa") && rsa_details[0] == 1024);
    expect_true("  with the exponent asked for", is_hex(nts_crypto_key_public_exponent(rsa), "03"));
    expect_true("  and is a pair", signs_and_verifies(rsa));

    double pss = nts_crypto_keygen_run(nts_crypto_keygen_rsa(true, 1024, 65537, sha256, -1, -1));
    NtsArray *pss_names = nts_crypto_key_detail_names(pss);
    char *mgf1 = string_of(NTS_ITEMS(pss_names, NtsString *)[2]);
    double *pss_details = NTS_ITEMS(nts_crypto_key_details(pss), double);
    expect_true("an RSA-PSS key restricted to SHA-256 takes it for MGF1 and a 32-byte salt, as node sets them",
                key_type_is(pss, "rsa-pss") && strcmp(mgf1, "sha256") == 0 && pss_details[2] == 32);
    free(mgf1);

    double ec = nts_crypto_keygen_run(nts_crypto_keygen_ec(text("P-384"), false));
    char *curve = string_of(NTS_ITEMS(nts_crypto_key_detail_names(ec), NtsString *)[0]);
    expect_true("an EC key on P-384 is on secp384r1", ec > 0 && strcmp(curve, "secp384r1") == 0);
    free(curve);
    expect_true("  and is a pair", signs_and_verifies(ec));
    expect_true("an unknown curve configures nothing", nts_crypto_keygen_ec(text("nope"), false) == 0);

    double ed = nts_crypto_keygen_run(nts_crypto_keygen_nid(text("ed448")));
    expect_true("an Ed448 key is generated, and is a pair", key_type_is(ed, "ed448") && signs_and_verifies(ed));
    double ml_dsa = nts_crypto_keygen_run(nts_crypto_keygen_nid(text("ml-dsa-44")));
    expect_true("an ML-DSA-44 key is generated, and named as node names it", key_type_is(ml_dsa, "ml-dsa-44"));
    expect_true("  signs the message itself, and is a pair",
                nts_crypto_key_is_one_shot(ml_dsa) && signs_and_verifies(ml_dsa));
    NtsView *seed = nts_crypto_key_export_seed(ml_dsa);
    expect_true("  keeps a 32-byte seed", seed != NULL && nts_view_byte_length(seed) == 32);
    expect_true("  from which the same key is made again",
                nts_crypto_key_equals(nts_crypto_key_from_post_quantum(text("ml-dsa-44"), seed, 2), ml_dsa));
    NtsView *ml_public = nts_crypto_key_export_raw(ml_dsa, false, false);
    expect_true("  and whose raw public key, 1312 bytes, imports as its public half",
                ml_public != NULL && nts_view_byte_length(ml_public) == 1312 &&
                    nts_crypto_key_equals(nts_crypto_key_from_post_quantum(text("ml-dsa-44"), ml_public, 0), ml_dsa));
    expect_true("an unknown type configures nothing", nts_crypto_keygen_nid(text("rsa")) == 0);

    double dsa = nts_crypto_keygen_run(nts_crypto_keygen_dsa(1024, 160));
    double *dsa_details = NTS_ITEMS(nts_crypto_key_details(dsa), double);
    expect_true("a DSA key's parameters are generated to the sizes asked",
                key_type_is(dsa, "dsa") && dsa_details[0] == 1024 && dsa_details[1] == 160);
    expect_true("  and is a pair", signs_and_verifies(dsa));

    double dh = nts_crypto_keygen_run(nts_crypto_keygen_dh_group(text("MODP14")));
    expect_true("a DH key in a named group, in any case", key_type_is(dh, "dh"));
    expect_true("an unknown group configures nothing", nts_crypto_keygen_dh_group(text("modp3")) == 0);

    double bad = nts_crypto_keygen_run(nts_crypto_keygen_rsa(false, 1024, 1, -1, -1, -1));
    expect_true("an exponent of 1 fails to generate", bad == 0);
    expect_true("  and OpenSSL says why", errors_mention("pub exponent out of range"));

    nts_crypto_keygen_queue(nts_crypto_keygen_ec(text("prime256v1"), false), &keygen_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("a generation job calls back once, with its key",
                keygen_calls == 1 && keygen_ok && key_type_is(keygen_key, "ec"));
}

/* ------------------------------------------------------- key agreement */

static void key_agreement(void) {
    double alice = nts_crypto_dh_group(text("modp14"));
    double bob = nts_crypto_dh_group(text("MODP14"));
    expect_true("a MODP group is found in any case", alice > 0 && bob > 0);
    expect_true("  and its parameters pass DH_check", nts_crypto_dh_check(alice) == 0);
    NtsView *alice_public = nts_crypto_dh_generate_keys(alice);
    NtsView *bob_public = nts_crypto_dh_generate_keys(bob);
    NtsView *alice_secret = nts_crypto_dh_compute_secret(alice, bob_public);
    expect_true("two parties agree on a secret the prime's size",
                alice_secret != NULL && nts_view_byte_length(alice_secret) == 256 &&
                    same_bytes(alice_secret, nts_crypto_dh_compute_secret(bob, alice_public)));
    unsigned char one = 1;
    expect_true("a public key of 1 is too small",
                nts_crypto_dh_compute_secret(alice, bytes(&one, 1)) == NULL && nts_crypto_dh_status() == -2);
    expect_true("an unknown group is none", nts_crypto_dh_group(text("modp3")) == 0);

    /* `verifyError` is ncrypto's `CheckDhParams`, not `DH_check`: these are
     * node's own answers for the inputs `test-crypto-dh-curves` uses. */
    const char *oakley = "ffffffffffffffffc90fdaa22168c234c4c6628b80dc1cd129024e088a67cc74"
                         "020bbea63b139b22514a08798e3404ddef9519b3cd3a431b302b0a6df25f1437"
                         "4fe1356d6d51c245e485b576625e7ec6f44c42e9a637ed6b0bff5cb6f406b7ed"
                         "ee386bfb5a899fa5ae9f24117c4b1fe649286651ece65381ffffffffffffffff";
    char not_prime[257];
    snprintf(not_prime, sizeof(not_prime), "%s", oakley);
    not_prime[254] = 'f';
    not_prime[255] = 'd';
    unsigned char two = 2;
    unsigned char twenty_three = 23;
    expect_true("verifyError: the second Oakley group is sound",
                nts_crypto_dh_check(nts_crypto_dh_new_prime(hex(oakley), 2)) == 0);
    expect_true("  its last byte changed is DH_CHECK_P_NOT_PRIME",
                nts_crypto_dh_check(nts_crypto_dh_new_prime_generator(hex(not_prime), bytes(&two, 1))) == 1);
    expect_true("  a prime that is not safe is DH_CHECK_P_NOT_SAFE_PRIME",
                nts_crypto_dh_check(nts_crypto_dh_new_prime_generator(
                    hex("d2d6d13e1c1e0bbb63c742199dee010411f089ac74f0f7213348388280700fd6"
                        "0ef9c1e7b096a4257dcbce61c544a5d1d23db4c49c63ce302f63be5cf5804327"),
                    bytes(&two, 1))) == 2);
    expect_true("  the prime 2 with generator 2 is 139, as node reports",
                nts_crypto_dh_check(nts_crypto_dh_new_prime(bytes(&two, 1), 2)) == 139);
    expect_true("  23 is only too small, 128",
                nts_crypto_dh_check(nts_crypto_dh_new_prime_generator(bytes(&twenty_three, 1), bytes(&two, 1))) == 128);
    expect_true("  and the RFC 2409 groups, which OpenSSL has no name for, are checked and sound",
                nts_crypto_dh_check(nts_crypto_dh_group(text("modp1"))) == 0 &&
                    nts_crypto_dh_check(nts_crypto_dh_group(text("modp2"))) == 0);
    double explicit_dh = nts_crypto_dh_new_prime(hex(oakley), 2);
    double group_dh = nts_crypto_dh_group(text("modp2"));
    NtsView *explicit_public = nts_crypto_dh_generate_keys(explicit_dh);
    NtsView *group_public = nts_crypto_dh_generate_keys(group_dh);
    expect_true("an explicit key and the same group agree, one by derivation and one by arithmetic",
                same_bytes(nts_crypto_dh_compute_secret(explicit_dh, group_public),
                           nts_crypto_dh_compute_secret(group_dh, explicit_public)));
    NtsView *kept = nts_crypto_dh_get(group_dh, 3);
    nts_crypto_dh_generate_keys(group_dh);
    expect_true("generating again keeps a private key already there", same_bytes(nts_crypto_dh_get(group_dh, 3), kept));
    expect_true("a prime of one bit is refused", nts_crypto_dh_new_size(1, 2) == -4);
    expect_true("  with OpenSSL's reason", errors_mention("modulus too small"));

    double ours = nts_crypto_ecdh_new(text("prime256v1"));
    double theirs = nts_crypto_ecdh_new(text("prime256v1"));
    expect_true("an ECDH object on a NIST name is refused, as node takes short names only",
                nts_crypto_ecdh_new(text("P-256")) == -1);
    nts_crypto_ecdh_generate_keys(ours);
    nts_crypto_ecdh_generate_keys(theirs);
    NtsView *our_point = nts_crypto_ecdh_get_public_key(ours, 4);
    NtsView *their_point = nts_crypto_ecdh_get_public_key(theirs, 2);
    expect_true("a P-256 point is 65 bytes, or 33 compressed",
                nts_view_byte_length(our_point) == 65 && nts_view_byte_length(their_point) == 33);
    expect_true("  and converts between the two",
                same_bytes(nts_crypto_ecdh_convert_key(our_point, text("prime256v1"), 2),
                           nts_crypto_ecdh_get_public_key(ours, 2)));
    NtsView *shared = nts_crypto_ecdh_compute_secret(ours, their_point);
    expect_true("two ECDH parties agree on the x-coordinate, 32 bytes",
                shared != NULL && nts_view_byte_length(shared) == 32 &&
                    same_bytes(shared, nts_crypto_ecdh_compute_secret(theirs, our_point)));
    expect_true("bytes that are no point are the public key's fault",
                nts_crypto_ecdh_compute_secret(ours, utf8("nope")) == NULL && nts_crypto_dh_status() == -3);
    unsigned char zero = 0;
    expect_true("a private key of 0 is not on the curve's range",
                nts_crypto_ecdh_set_private_key(ours, bytes(&zero, 1)) == -5);
    expect_true("a private key of 1 is accepted", nts_crypto_ecdh_set_private_key(ours, bytes(&one, 1)) == 1);
    expect_true("  and its public key is the generator",
                is_hex(nts_crypto_ecdh_get_public_key(ours, 4),
                       "046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296"
                       "4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5"));

    double x_private = nts_crypto_key_from_okp(
        text("X25519"), hex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a"), true);
    double x_public = nts_crypto_key_from_okp(
        text("X25519"), hex("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f"), false);
    expect_true("X25519, RFC 7748 section 6.1",
                is_hex(nts_crypto_dh_stateless(x_private, x_public),
                       "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742"));
    double ec = nts_crypto_key_parse_private(1, -1, file(KEYS "ec_p256_private.pem"), bytes("", 0), false);
    expect_true("an X25519 key and an EC key agree on nothing", nts_crypto_dh_stateless(x_private, ec) == NULL);
    expect_true("  and OpenSSL says why", errors_mention("operation not supported for this keytype") ||
                                              errors_mention("different"));
    int before = jobs_done;
    nts_crypto_dh_stateless_job(x_private, x_public, &job_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("an agreement job calls back once, with the same secret",
                jobs_done == before + 1 && job_ok &&
                    strcmp(job_hex, "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742") == 0);
}

/* --------------------------------------------------------------- primes */

static void primes(void) {
    NtsView *none = bytes("", 0);
    NtsView *prime = nts_crypto_prime_generate(64, false, none, false, none, false);
    expect_true("a 64-bit prime is 8 bytes with its top bit set",
                prime != NULL && nts_view_byte_length(prime) == 8 && (nts_view_bytes(prime)[0] & 0x80) != 0);
    expect_true("  and checks as prime", nts_crypto_prime_check(prime, 0) == 1);
    unsigned char four = 4;
    unsigned char mersenne[] = {0x7f, 0xff, 0xff, 0xff};
    expect_true("4 is not", nts_crypto_prime_check(bytes(&four, 1), 0) == 0);
    expect_true("2^31 - 1 is, whatever rounds are asked -- OpenSSL 3 chooses", nts_crypto_prime_check(bytes(mersenne, 4), 20) == 1);

    unsigned char add = 12;
    unsigned char rem = 11;
    NtsView *congruent = nts_crypto_prime_generate(32, false, bytes(&add, 1), true, bytes(&rem, 1), true);
    const unsigned char *c = congruent == NULL ? NULL : nts_view_bytes(congruent);
    unsigned long value = c == NULL ? 0 : ((unsigned long)c[0] << 24) | (c[1] << 16) | (c[2] << 8) | c[3];
    expect_true("a prime with add 12 and rem 11 is 11 mod 12", congruent != NULL && value % 12 == 11);
    unsigned char big_add[] = {0x01, 0x00, 0x00, 0x00, 0x00};
    expect_true("an add wider than the prime is refused before generating",
                nts_crypto_prime_options(32, bytes(big_add, 5), true, none, false) == -1);
    expect_true("  and a rem not below add", nts_crypto_prime_options(32, bytes(&rem, 1), true, bytes(&add, 1), true) == -2);

    size_t huge_length = 67108864;
    unsigned char *huge = calloc(huge_length, 1);
    huge[0] = 1;
    expect_true("a 64 MiB candidate is no number OpenSSL will hold", !nts_crypto_prime_candidate_ok(bytes(huge, huge_length)));
    expect_true("  and OpenSSL says so", errors_mention("bignum too long"));
    free(huge);

    int before = jobs_done;
    nts_crypto_prime_check_job(bytes(mersenne, 4), 0, &job_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("a check job answers one true byte", jobs_done == before + 1 && job_ok && strcmp(job_hex, "01") == 0);
    nts_crypto_prime_generate_job(16, true, none, false, none, false, &job_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("a generation job answers a 16-bit safe prime", jobs_done == before + 2 && job_ok && strlen(job_hex) == 4);
}

/* --------------------------------------------------------------- argon2 */

static void argon2(void) {
    expect_true("this OpenSSL has Argon2", nts_crypto_argon2_supported());
    unsigned char message[32], nonce[16], secret[8], ad[12];
    memset(message, 0x01, sizeof(message));
    memset(nonce, 0x02, sizeof(nonce));
    memset(secret, 0x03, sizeof(secret));
    memset(ad, 0x04, sizeof(ad));
    static const char *const expected[] = {
        "512b391b6f1162975371d30919734294f868e3be3984f3c1a13a4db9fabe4acb",
        "c814d9d1dc7f37aa13f0d77f2494bda1c8de6b016dd388d29952a4c4672b6ce8",
        "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659",
    };
    static const char *const names[] = {"Argon2d, RFC 9106 5.1", "Argon2i, RFC 9106 5.2", "Argon2id, RFC 9106 5.3"};
    for (int type = 0; type < 3; type++) {
        expect_true(names[type], is_hex(nts_crypto_argon2(type, bytes(message, 32), bytes(nonce, 16), 4, 32, 32, 3,
                                                           bytes(secret, 8), bytes(ad, 12)),
                                         expected[type]));
    }
    NtsView *empty = nts_crypto_argon2(2, bytes(message, 32), bytes(nonce, 16), 1, 0, 8, 1, bytes("", 0), bytes("", 0));
    expect_true("a tag of no length is empty, and no failure", empty != NULL && nts_view_byte_length(empty) == 0);
    int before = jobs_done;
    nts_crypto_argon2_job(2, bytes(message, 32), bytes(nonce, 16), 4, 32, 32, 3, bytes(secret, 8), bytes(ad, 12),
                          &job_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("an Argon2 job derives the same tag", jobs_done == before + 1 && job_ok && strcmp(job_hex, expected[2]) == 0);
}

/* ---------------------------------------------------- key encapsulation */

static int pair_calls;
static bool pair_ok;
static size_t pair_lengths[2];

static void on_pair(NtsHeader *self, bool ok, NtsView *first, NtsView *second) {
    (void)self;
    pair_calls++;
    pair_ok = ok;
    pair_lengths[0] = (size_t)nts_view_byte_length(first);
    pair_lengths[1] = (size_t)nts_view_byte_length(second);
}

static void *const pair_methods[] = {(void *)(void (*)(NtsHeader *, bool, NtsView *, NtsView *))on_pair};
static const NtsDescriptor pair_desc = {
    NTS_KIND_OBJECT, (uint32_t)sizeof(NtsHeader), 0u, 0u, NULL, pair_methods, "OnPair", 0u, NULL,
};
static NtsHeader pair_callback = {&pair_desc, NTS_IMMORTAL, 0u, 0u};

static void key_encapsulation(void) {
    double ml_kem = nts_crypto_keygen_run(nts_crypto_keygen_nid(text("ml-kem-768")));
    NtsArray *sealed = nts_crypto_kem_encapsulate(ml_kem);
    NtsView **parts = NTS_ITEMS(sealed, NtsView *);
    expect_true("ML-KEM-768 encapsulates a 32-byte key in 1088 bytes",
                sealed->header.length == 2 && nts_view_byte_length(parts[0]) == 32 &&
                    nts_view_byte_length(parts[1]) == 1088);
    expect_true("  which its private key recovers", same_bytes(nts_crypto_kem_decapsulate(ml_kem, parts[1]), parts[0]));

    double x = nts_crypto_keygen_run(nts_crypto_keygen_nid(text("x25519")));
    NtsArray *dhkem = nts_crypto_kem_encapsulate(x);
    NtsView **x_parts = NTS_ITEMS(dhkem, NtsView *);
    expect_true("X25519 is a KEM through DHKEM, and round trips",
                dhkem->header.length == 2 && same_bytes(nts_crypto_kem_decapsulate(x, x_parts[1]), x_parts[0]));

    double rsa = nts_crypto_key_parse_private(1, -1, file(KEYS "rsa_private.pem"), bytes("", 0), false);
    NtsArray *rsasve = nts_crypto_kem_encapsulate(rsa);
    expect_true("RSA is a KEM through RSASVE", rsasve->header.length == 2 &&
                                                   nts_view_byte_length(NTS_ITEMS(rsasve, NtsView *)[1]) == 256);
    expect_true("  and a ciphertext of the wrong size is no answer",
                nts_crypto_kem_decapsulate(rsa, utf8("short")) == NULL);
    double ed = nts_crypto_key_parse_private(1, -1, file(KEYS "ed25519_private.pem"), bytes("", 0), false);
    expect_true("an Ed25519 key is no KEM", nts_crypto_kem_encapsulate(ed)->header.length == 0);
    NtsArray *record = nts_crypto_take_errors();
    expect_true("  and leaves OpenSSL's queue empty, as ncrypto does", record->header.length == 3);

    nts_crypto_kem_encapsulate_job(ml_kem, &pair_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("an encapsulation job delivers both, once",
                pair_calls == 1 && pair_ok && pair_lengths[0] == 32 && pair_lengths[1] == 1088);
}

/* ---------------------------------------------------------------- SPKAC */

static void spkac(void) {
    NtsView *valid = file(KEYS "rsa_spkac.spkac");
    expect_true("node's SPKAC fixture verifies", nts_crypto_spkac_verify(valid));
    expect_true("  and its broken twin does not", !nts_crypto_spkac_verify(file(KEYS "rsa_spkac_invalid.spkac")));
    NtsView *challenge = nts_crypto_spkac_challenge(valid);
    expect_true("its challenge is the one it was made with",
                challenge != NULL && nts_view_byte_length(challenge) == 19 &&
                    memcmp(nts_view_bytes(challenge), "this-is-a-challenge", 19) == 0);
    double carried = nts_crypto_key_parse_public(1, -1, nts_crypto_spkac_public_key(valid), bytes("", 0), false);
    double expected = nts_crypto_key_parse_public(1, -1, file(KEYS "rsa_public.pem"), bytes("", 0), false);
    expect_true("  and its key is the fixture's RSA key", nts_crypto_key_equals(carried, expected));
    expect_true("garbage is no SPKAC, and leaves nothing on the queue",
                nts_crypto_spkac_public_key(utf8("garbage")) == NULL &&
                    nts_crypto_take_errors()->header.length == 3);
}

/* ------------------------------------------------------------ X.509 */

#define X509E "third_party/node/test/fixtures/x509-escaping/"

/* `test-x509-escaping`'s expectations for its `alt-N`, `info-N` and `subj-N`
 * certificates, and three certificates `test-crypto-x509` writes inline --
 * copied from those files by a script, not retyped. */
static const char *const expected_alt_names[] = {
    "DNS:\"good.example.com\\u002c DNS:evil.example.com\"",
    "URI:http://example.com/",
    "URI:http://example.com/?a=b&c=d",
    "URI:\"http://example.com/a\\u002cb\"",
    "URI:http://example.com/a%2Cb",
    "URI:\"http://example.com/a\\u002c DNS:good.example.com\"",
    "DNS:\"ex\\u00e4mple.com\"",
    "DNS:\"\\\"evil.example.com\\\"\"",
    "IP Address:8.8.8.8",
    "IP Address:8.8.4.4",
    "IP Address:<invalid length=5>",
    "IP Address:<invalid length=6>",
    "IP Address:A0B:C0D:E0F:0:0:0:7A7B:7C7D",
    "email:foo@example.com",
    "email:\"foo@example.com\\u002c DNS:good.example.com\"",
    "DirName:\"L=Hannover\\u002cC=DE\"",
    "DirName:\"L=M\xc3""\xbc""nchen\\u002cC=DE\"",
    "DirName:\"L=Berlin\\\\\\u002c DNS:good.example.com\\u002cC=DE\"",
    "DirName:\"L=Berlin\\\\\\u002c DNS:good.example.com\\u0000evil.example.com\\u002cC=DE\"",
    "DirName:\"L=Berlin\\\\\\u002c DNS:good.example.com\\\\\\\\\\u0000evil.example.com\\u002cC=DE\"",
    "DirName:\"L=Berlin\\u000d\\u000a\\u002cC=DE\"",
    "DirName:\"L=Berlin/CN=good.example.com\\u002cC=DE\"",
    "Registered ID:1.2.840.113549.1.1.11",
    "Registered ID:1.3.9999.12.34",
    "othername:XmppAddr:abc123",
    "othername:\"XmppAddr:abc123\\u002c DNS:good.example.com\"",
    "othername:\"XmppAddr:good.example.com\\u0000abc123\"",
    "othername:<unsupported>",
    "othername:SRVName:abc123",
    "othername:<unsupported>",
    "othername:\"SRVName:abc\\u0000def\"",
};

static const char *const expected_info_access[] = {
    "OCSP - URI:\"http://good.example.com/\\u000aOCSP - URI:http://evil.example.com/\"",
    "CA Issuers - URI:\"http://ca.example.com/\\u000aOCSP - URI:http://evil.example.com\"\nOCSP - DNS:\"good.example.com\\u000aOCSP - URI:http://ca.nodejs.org/ca.cert\"",
    "1.3.9999.12.34 - URI:http://ca.example.com/",
    "OCSP - othername:XmppAddr:good.example.com\nOCSP - othername:<unsupported>\nOCSP - othername:SRVName:abc123",
    "OCSP - othername:\"XmppAddr:good.example.com\\u0000abc123\"",
};

static const char *const expected_subjects[] = {
    "L=Somewhere\nCN=evil.example.com",
    "L=Somewhere\\00evil.example.com",
    "L=Somewhere\\0ACN=evil.example.com",
    "L=Somewhere\\, CN = evil.example.com",
    "L=Somewhere/CN=evil.example.com",
    "L=M\xc3""\xbc""nchen\\\\\\0ACN=evil.example.com",
    "L=Somewhere + CN=evil.example.com",
    "L=Somewhere \\+ CN=evil.example.com",
    "L=L1 + L=L2\nL=L3",
    "L=L1\nL=L2\nL=L3",
};

static const char undecodable_key_pem[] =
    "-----BEGIN CERTIFICATE-----\n"
    "MIIDpDCCAw0CFEc1OZ8g17q+PZnna3iQ/gfoZ7f3MA0GCSqGSIb3DQEBBQUAMIHX\n"
    "MRMwEQYLKwYBBAGCNzwCAQMTAkdJMR0wGwYDVQQPExRQcml2YXRlIE9yZ2FuaXph\n"
    "dGlvbjEOMAwGA1UEBRMFOTkxOTExCzAJBgNVBAYTAkdJMRIwEAYDVQQIFAlHaWJy\n"
    "YWx0YXIxEjAQBgNVBAcUCUdpYnJhbHRhcjEgMB4GA1UEChQXV0hHIChJbnRlcm5h\n"
    "dGlvbmFsKSBMdGQxHDAaBgNVBAsUE0ludGVyYWN0aXZlIEJldHRpbmcxHDAaBgNV\n"
    "BAMUE3d3dy53aWxsaWFtaGlsbC5jb20wIhgPMjAxNDAyMDcwMDAwMDBaGA8yMDE1\n"
    "MDIyMTIzNTk1OVowgbAxCzAJBgNVBAYTAklUMQ0wCwYDVQQIEwRSb21lMRAwDgYD\n"
    "VQQHEwdQb21lemlhMRYwFAYDVQQKEw1UZWxlY29taXRhbGlhMRIwEAYDVQQrEwlB\n"
    "RE0uQVAuUE0xHTAbBgNVBAMTFHd3dy50ZWxlY29taXRhbGlhLml0MTUwMwYJKoZI\n"
    "hvcNAQkBFiZ2YXNlc2VyY2l6aW9wb3J0YWxpY29AdGVsZWNvbWl0YWxpYS5pdDCB\n"
    "nzANBgkqhkiG9w0BAQEFAAOBjQA4gYkCgYEA5m/Vf7PevH+inMfUJOc8GeR7WVhM\n"
    "CQwcMM5k46MSZo7kCk7VZuaq5G2JHGAGnLPaPUkeXlrf5qLpTxXXxHNtz+WrDlFt\n"
    "boAdnTcqpX3+72uBGOaT6Wi/9YRKuCs5D5/cAxAc3XjHfpRXMoXObj9Vy7mLndfV\n"
    "/wsnTfU9QVeBkgsCAwEAAaOBkjCBjzAdBgNVHQ4EFgQUfLjAjEiC83A+NupGrx5+\n"
    "Qe6nhRMwbgYIKwYBBQUHAQwEYjBgoV6gXDBaMFgwVhYJaW1hZ2UvZ2lmMCEwHzAH\n"
    "BgUrDgMCGgQUS2u5KJYGDLvQUjibKaxLB4shBRgwJhYkaHR0cDovL2xvZ28udmVy\n"
    "aXNpZ24uY29tL3ZzbG9nbzEuZ2lmMA0GCSqGSIb3DQEBBQUAA4GBALLiAMX0cIMp\n"
    "+V/JgMRhMEUKbrt5lYKfv9dil/f22ezZaFafb070jGMMPVy9O3/PavDOkHtTv3vd\n"
    "tAt3hIKFD1bJt6c6WtMH2Su3syosWxmdmGk5ihslB00lvLpfj/wed8i3bkcB1doq\n"
    "UcXd/5qu2GhokrKU2cPttU+XAN2Om6a0\n"
    "-----END CERTIFICATE-----\n";

static const char utc_time_pem[] =
    "-----BEGIN CERTIFICATE-----\n"
    "MIIE/TCCAuWgAwIBAgIUHbXPaFnjeBehMvdHkXZ+E3a78QswDQYJKoZIhvcNAQEL\n"
    "BQAwDTELMAkGA1UEBhMCS1IwIBgPMTk0OTEyMjUyMzU5NThaFw01MDAxMDEyMzU5\n"
    "NThaMA0xCzAJBgNVBAYTAktSMIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKC\n"
    "AgEAtFfV2DB2dZFFaR1PPZMmyo0mSDAxGReoixxlhQTFZZymU71emWV/6gR8MxAE\n"
    "L5+uzpgBvOZWgEbELWeV/gzZGU/x1Cki0dSJ0B8Qwr5HvKX6oOZrJ8t+wn4SRceq\n"
    "r6MRPskDpTjnvelt+VURGmawtKKHll5fSqfjRWkQC8WQHdogXylRjd3oIh9p1D5P\n"
    "hphK/jKddxsRkLhJKQWqTjAy2v8hsJAxvpCPnlqMCXxjbQV41UTY8+kY3RPG3d6c\n"
    "yHBGM7dzM7XWVc79V9z/rjdRcxE2eBqrJT/yR3Cok8wWVVfQEgBfpolHUZxA8K4N\n"
    "tubTez9zsJy7xUG7udf91wXWVHMBHXg6m/u5nIW0fAXGMtnG/H6FMyyBDbJoUlqm\n"
    "VRTG71DzvBXpd/qx2P5LkU1JjWY3U8HSn6Q1DJzMIrbOmWpdlFYXxzLlXU2vG8Q3\n"
    "PmdAHDDYW3M2YBVCdKqOtsuL2dMDuqRWdi3iCCPSR2UCm4HzAVYSe2FP8SPcY3xs\n"
    "1NX+oDSpTxXruJYHGUp10/pXoqMrGT1IBgv2Dhsm3jcfRLSXkaBDJIKLO6dXmLBt\n"
    "rlxM0DphiKnP6lDjpv7EDMdwsakz0zib3JrTmSLSbwZXR4abITmtbYbTpY3XAq7c\n"
    "adO8YCMTCtb50ZbYEpGDAjOcWFHUlQQMsgZM2zc8ZHPY4EkCAwEAAaNTMFEwHQYD\n"
    "VR0OBBYEFExDmZyzdo8ccjX7iFIwU7JYMV+qMB8GA1UdIwQYMBaAFExDmZyzdo8c\n"
    "cjX7iFIwU7JYMV+qMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggIB\n"
    "ADEF/JIH+Ku9NqrO47Q/CEn9qpIgmqX10d1joDjchPY3OHIIyt8Xpo845mPBTM7L\n"
    "dnMJSlkzJEk0ep9qAGGdKpBnLq8B/1mgCWQ81jwrwdYSsY+4xark+7+y0fij6qAt\n"
    "L4T6aA37nbV5q5/DMOwZucFwRTf9ZI1IjC+MaQmnV01vGCogqqfLQ9v26bVBRE1K\n"
    "UIixH0r3f/LWtuo0KaebZbb+oq6Zb8ljKJaUlt5OB8Zy5NrcP69r29QJUR57ukT6\n"
    "rt7fk5mOj2NBLMCErLHa7E6+GAUG94QEgdKzZ4yr2aduhMAfnOnK/HfuXO8TVa8/\n"
    "+oYENr47M8x139+yu92C8Be1MRk0VHteBaScUL+IaY3HgGbYR1lT0azvIyBN/DCN\n"
    "bYczI7JQGYVitLuaUYFw/RtK7Qg1957/ZmGeGa+86aTLXbqsGjI951D81EIzdqod\n"
    "1QW/Jn3yMNeVIzF9eYVEy2DIJjGgM2A8NWbqfWGUAUMRgyTxH1j42tnWG3eRnMsX\n"
    "UnQfpY8i3v6gYoNNgEZktrqgpmukTWgl08TlDtBCjXTBkcBt4dxDApeoy7XWKq+/\n"
    "qBY/+uIsG30BRgJhAwApjdnCs7l5xpwtqluXFwOxyTWNV5IfChO7QFqWPlSVIHML\n"
    "UidvpWWipVLZgK+oDks+bKTobcoXGW9oXobiIYqslXPy\n"
    "-----END CERTIFICATE-----\n";

static const char unknown_signature_pem[] =
    "-----BEGIN CERTIFICATE-----\n"
    "MIGXMHugAwIBAgIBATANBgkrBgEEAYaNHwEFADASMRAwDgYDVQQDEwdVbmtub3du\n"
    "MB4XDTI0MDEwMTAwMDAwMFoXDTM0MDEwMTAwMDAwMFowEjEQMA4GA1UEAxMHVW5r\n"
    "bm93bjAaMA0GCSqGSIb3DQEBAQUAAwkAAAAAAAAAAAAwDQYJKwYBBAGGjR8BBQAD\n"
    "CQAAAAAAAAAAAA==\n"
    "-----END CERTIFICATE-----\n";

static bool string_is(NtsString *value, const char *expected) {
    if (value == NULL) return false;
    char *actual = string_of(value);
    bool same = actual != NULL && strcmp(actual, expected) == 0;
    if (!same) printf("     got %s\n", actual == NULL ? "(null)" : actual);
    free(actual);
    return same;
}

static double certificate(const char *path) { return nts_crypto_x509_parse(file(path)); }

/* Each of upstream's escaping cases, which is every kind of general name the
 * printer writes -- and every way of fooling a parser with one. */
static void certificate_escaping(void) {
    char path[160];
    bool all = true;
    for (size_t i = 0; i < sizeof(expected_alt_names) / sizeof(*expected_alt_names); i++) {
        snprintf(path, sizeof(path), X509E "alt-%zu-cert.pem", i);
        bool same = string_is(nts_crypto_x509_subject_alt_name(certificate(path)), expected_alt_names[i]);
        if (!same) printf("     alt-%zu\n", i);
        all = all && same;
    }
    expect_true("33 subject alternative names escaped as node escapes them", all);
    all = true;
    for (size_t i = 0; i < sizeof(expected_info_access) / sizeof(*expected_info_access); i++) {
        snprintf(path, sizeof(path), X509E "info-%zu-cert.pem", i);
        bool same = string_is(nts_crypto_x509_info_access(certificate(path)), expected_info_access[i]);
        if (!same) printf("     info-%zu\n", i);
        all = all && same;
    }
    expect_true("  the information access, one line per method", all);
    all = true;
    for (size_t i = 0; i < sizeof(expected_subjects) / sizeof(*expected_subjects); i++) {
        snprintf(path, sizeof(path), X509E "subj-%zu-cert.pem", i);
        double cert = certificate(path);
        bool same = string_is(nts_crypto_x509_name(cert, false), expected_subjects[i]) &&
                    string_is(nts_crypto_x509_name(cert, true), expected_subjects[i]);
        if (!same) printf("     subj-%zu\n", i);
        all = all && same;
    }
    expect_true("  and the multi-line subjects and issuers", all);
}

static void certificates(void) {
    double agent1 = certificate(KEYS "agent1-cert.pem");
    double ca1 = certificate(KEYS "ca1-cert.pem");
    expect_true("agent1's certificate parses", agent1 > 0 && ca1 > 0);
    expect_true("  its subject, one line per entry",
                string_is(nts_crypto_x509_name(agent1, false),
                          "C=US\nST=CA\nL=SF\nO=Joyent\nOU=Node.js\nCN=agent1\nemailAddress=ry@tinyclouds.org"));
    expect_true("  its issuer",
                string_is(nts_crypto_x509_name(agent1, true),
                          "C=US\nST=CA\nL=SF\nO=Joyent\nOU=Node.js\nCN=ca1\nemailAddress=ry@tinyclouds.org"));
    expect_true("  no subject alternative name", nts_crypto_x509_subject_alt_name(agent1) == NULL);
    expect_true("  its information access",
                string_is(nts_crypto_x509_info_access(agent1),
                          "OCSP - URI:http://ocsp.nodejs.org/\nCA Issuers - URI:http://ca.nodejs.org/ca.cert"));
    expect_true("  its validity as ASN1_TIME_print writes it",
                string_is(nts_crypto_x509_valid_text(agent1, false), "Sep  3 21:40:37 2022 GMT") &&
                    string_is(nts_crypto_x509_valid_text(agent1, true), "Jun 17 21:40:37 2296 GMT"));
    expect_true("  and in seconds, 2296 past a 32-bit time_t",
                nts_crypto_x509_valid_time(agent1, false) == 1662241237 &&
                    nts_crypto_x509_valid_time(agent1, true) == 10302154837);
    expect_true("  its SHA-1 fingerprint",
                string_is(nts_crypto_x509_fingerprint(agent1, 0),
                          "8B:89:16:C4:99:87:D2:13:1A:64:94:36:38:A5:32:01:F0:95:3B:53"));
    expect_true("  its SHA-256 fingerprint",
                string_is(nts_crypto_x509_fingerprint(agent1, 1),
                          "2C:62:59:16:91:89:AB:90:6A:3E:98:88:A6:D3:C5:58:58:6C:AE:FF:9C:33:"
                          "22:7C:B6:77:D3:34:E7:53:4B:05"));
    expect_true("  its SHA-512 fingerprint",
                string_is(nts_crypto_x509_fingerprint(agent1, 2),
                          "0B:6F:D0:4D:6B:22:53:99:66:62:51:2D:2C:96:F2:58:3F:95:1C:CC:4C:44:"
                          "9D:B5:59:AA:AD:A8:F6:2A:24:8A:BB:06:A5:26:42:52:30:A3:37:61:30:A9:"
                          "5A:42:63:E0:21:2F:D6:70:63:07:96:6F:27:A7:78:12:08:02:7A:8B"));
    expect_true("  its serial number in upper case",
                string_is(nts_crypto_x509_serial_number(agent1), "147D36C1C2F74206DE9FAB5F2226D78ADB00A426"));
    expect_true("  its signature algorithm, by long name and OID",
                string_is(nts_crypto_x509_signature_algorithm(agent1), "sha256WithRSAEncryption") &&
                    string_is(nts_crypto_x509_signature_algorithm_oid(agent1), "1.2.840.113549.1.1.11"));
    NtsView *raw = nts_crypto_x509_raw(agent1);
    expect_true("  its DER, which parses back to the same certificate",
                raw != NULL && nts_view_byte_length(raw) == 1004 &&
                    string_is(nts_crypto_x509_fingerprint(nts_crypto_x509_parse(raw), 0),
                              "8B:89:16:C4:99:87:D2:13:1A:64:94:36:38:A5:32:01:F0:95:3B:53"));
    char *pem = string_of(nts_crypto_x509_pem(agent1));
    static const char pem_head[] =
        "-----BEGIN CERTIFICATE-----\nMIID6DCCAtCgAwIBAgIUFH02wcL3Qgben6tfIibXitsApCYwDQYJKoZIhvcNAQEL\n";
    expect_true("  its PEM", pem != NULL && strncmp(pem, pem_head, sizeof(pem_head) - 1) == 0);
    free(pem);
    expect_true("  no extended key usage, and it is no CA",
                nts_crypto_x509_key_usage(agent1) == NULL && !nts_crypto_x509_check_ca(agent1));
    expect_true("ca1 is a CA", nts_crypto_x509_check_ca(ca1));
    expect_true("  and issued agent1, which did not issue itself",
                nts_crypto_x509_check_issued(agent1, ca1) && !nts_crypto_x509_check_issued(agent1, agent1));

    double ca_key = nts_crypto_x509_public_key(ca1);
    double own_key = nts_crypto_x509_public_key(agent1);
    expect_true("ca1's key verifies agent1's signature, agent1's own does not",
                nts_crypto_x509_verify(agent1, ca_key) && !nts_crypto_x509_verify(agent1, own_key));
    double private_key = nts_crypto_key_parse_private(1, -1, file(KEYS "agent1-key.pem"), bytes("", 0), false);
    expect_true("agent1's private key is the certificate's",
                nts_crypto_x509_check_private_key(agent1, private_key) &&
                    !nts_crypto_x509_check_private_key(ca1, private_key));

    expect_true("checkHost matches the common name",
                nts_crypto_x509_check(agent1, 0, text("agent1"), 0) == 1 &&
                    string_is(nts_crypto_x509_matched_host(agent1, text("agent1"), 0), "agent1") &&
                    nts_crypto_x509_check(agent1, 0, text("agent2"), 0) == 0);
    expect_true("  never with the subject never checked", nts_crypto_x509_check(agent1, 0, text("agent1"), 0x20) == 0);
    expect_true("  and a NUL inside the name is an invalid name",
                nts_crypto_x509_check(agent1, 0, nts_string_from_utf8("agent\0" "1", 7), 0) == -2);
    expect_true("checkEmail matches the subject's address",
                nts_crypto_x509_check(agent1, 1, text("ry@tinyclouds.org"), 0) == 1 &&
                    nts_crypto_x509_check(agent1, 1, text("sally@example.com"), 0) == 0);
    expect_true("checkIP matches nothing, and \"[::]\" is no address",
                nts_crypto_x509_check(agent1, 2, text("127.0.0.1"), 0) == 0 &&
                    nts_crypto_x509_check(agent1, 2, text("[::]"), 0) == -2);
    expect_true("  nothing is left on the queue", nts_crypto_take_errors()->header.length == 3);

    NtsArray *entries = nts_crypto_x509_name_entries(agent1, false);
    NtsString **names = NTS_ITEMS(entries, NtsString *);
    expect_true("the legacy subject, entry by entry",
                entries->header.length == 14 && string_is(names[0], "C") && string_is(names[1], "US") &&
                    string_is(names[12], "emailAddress") && string_is(names[13], "ry@tinyclouds.org"));
    expect_true("  an RSA key, its modulus in BN_print's hex",
                nts_crypto_x509_legacy_family(agent1) == 1 &&
                    string_is(nts_crypto_x509_rsa_number(agent1, false),
                              "D456320AFB20D3827093DC2C4284ED04DFBABD56E1DDAE529E28B790CD4256DB273349F3735FFD337C7A6363"
                              "ECCA5A27B7F73DC7089A96C6D886DB0C62388F1CDD6A963AFCD599D5800E587A11F908960F84ED50BA25A283"
                              "03ECDA6E684FBE7BAEDC9CE8801327B1697AF25097CEE3F175E400984C0DB6A8EB87BE03B4CF94774BA56FFF"
                              "C8C63C68D6ADEB60ABBE69A7B14AB6A6B9E7BAA89B5ADAB8EB07897C07F6D4FA3D660DFF574107D28E8F6346"
                              "7A788624C574197693E959CEA1362FFAE1BBA10C8C0D88840ABFEF103631B2E8F5C39B5548A7EA57E8A39F89"
                              "291813F45A76C448033A2B7ED8403F4BAA147CF35E2D2554AA65CE49695797095BF4DC6B"));
    expect_true("  its exponent and bits",
                string_is(nts_crypto_x509_rsa_number(agent1, true), "0x10001") &&
                    nts_crypto_x509_legacy_bits(agent1) == 2048);
    NtsView *pubkey = nts_crypto_x509_legacy_public_key(agent1);
    expect_true("  its SPKI", pubkey != NULL && nts_view_byte_length(pubkey) == 294 &&
                                  nts_view_bytes(pubkey)[0] == 0x30 && nts_view_bytes(pubkey)[1] == 0x82);
    expect_true("  and no curve", nts_crypto_x509_legacy_curve(agent1, false) == NULL);

    /* `test-crypto-x509`'s own numbers for OpenSSL 3: an RSA-PSS key under
     * `rsaEncryption`'s OID, with its restrictions or with none. */
    double sha256 = nts_crypto_digest_id(text("sha256"));
    NtsView *pss = nts_crypto_x509_legacy_public_key(certificate(KEYS "rsa_pss_cert_2048.pem"));
    expect_true("an unrestricted RSA-PSS key's legacy SPKI",
                pss != NULL && nts_view_byte_length(pss) == 292 &&
                    is_hex(nts_crypto_digest(sha256, pss, -1),
                           "dff998a209bfa2e6ded1208c6e57f5b6bdedfa44b631265e3e244f38e637f6e4"));
    pss = nts_crypto_x509_legacy_public_key(certificate(KEYS "rsa_pss_cert_2048_sha256_sha256_16.pem"));
    expect_true("  a restricted one's, its parameters re-encoded",
                pss != NULL && nts_view_byte_length(pss) == 342 &&
                    is_hex(nts_crypto_digest(sha256, pss, -1),
                           "da0bcd53fbe3969c7cc2730f86abc34e0e1c340264bbdfa3faf01484c2eeece0"));

    double ec = certificate(KEYS "ec-cert.pem");
    NtsView *point = nts_crypto_x509_legacy_public_key(ec);
    expect_true("an EC key's legacy fields: its point, as encoded",
                nts_crypto_x509_legacy_family(ec) == 2 &&
                    is_hex(point, "044a69c14731650736a9b4f1928f1511802d2a130f6f3ce484c942de2aaff83246f605d12772adf2f"
                                  "cf7fc7b8157a8060e3b9a4ce6e8bbffe9eec06339dbdc4d70"));
    expect_true("  its order's bits and both curve names",
                nts_crypto_x509_legacy_bits(ec) == 256 && string_is(nts_crypto_x509_legacy_curve(ec, false), "prime256v1") &&
                    string_is(nts_crypto_x509_legacy_curve(ec, true), "P-256"));
    expect_true("  and no modulus", nts_crypto_x509_rsa_number(ec, false) == NULL);

    NtsArray *usages = nts_crypto_x509_key_usage(certificate(KEYS "agent4-cert.pem"));
    expect_true("an extended key usage, by OID",
                usages != NULL && usages->header.length == 1 &&
                    string_is(NTS_ITEMS(usages, NtsString *)[0], "1.3.6.1.5.5.7.3.2"));

    double undecodable = nts_crypto_x509_parse(utf8(undecodable_key_pem));
    expect_true("a certificate whose key does not decode parses",
                undecodable > 0 && !nts_crypto_x509_check_issued(undecodable, undecodable));
    expect_true("  and its key is a decode error", nts_crypto_x509_public_key(undecodable) == 0 &&
                                                       errors_mention("decode error"));
    double utc = nts_crypto_x509_parse(utf8(utc_time_pem));
    expect_true("dates before 1970, UTCTime's 1949 and 1950",
                nts_crypto_x509_valid_time(utc, false) == -631670402 &&
                    nts_crypto_x509_valid_time(utc, true) == -631065602);
    double unknown = nts_crypto_x509_parse(utf8(unknown_signature_pem));
    expect_true("a signature algorithm OpenSSL does not know has no name, and its OID",
                nts_crypto_x509_signature_algorithm(unknown) == NULL &&
                    string_is(nts_crypto_x509_signature_algorithm_oid(unknown), "1.3.6.1.4.1.99999.1"));
    expect_true("garbage is no certificate, and says why",
                nts_crypto_x509_parse(utf8("garbage")) == 0 && errors_mention("no start line"));

    certificate_escaping();
}

/* ------------------------------------------------------------- Web Crypto AES */

/* node's Web Crypto AES fixtures, `test/fixtures/crypto/aes_*.js`'s passing
 * vectors, copied by a script: mode, key, IV or counter, counter bits or tag
 * bytes, additional data, plaintext, ciphertext. */
static const struct {
    int mode;
    const char *key, *iv;
    int length;
    const char *aad, *plaintext, *ciphertext;
} aes_vectors[] = {
    {0, "dec0d4fcbf3c4741c892dabd1cd4c04e", "55aaf89ba89413d54ea727a76c27a284", 0, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "237f03fee70872e78faec148ddbd01bd77cb96e3381ef4ece2afea17a7afd37ccbe461df9c4d58aea6bbbae1b05cfab1e129877cd756c6867c319a3ce05da50cbef5f1a4f7dce345f269d06cdec1df00e2d927a04e93bf2699e8ceddfe19b9f907b5d76862a3c2a167a1eda70af2255002ffad60146aaa6e5026887f1055f44eac386a0373823aba81ecfffbb270189f52fc01b2845c287d12877440b21fae577272da4e6f00effc4f3f773a764e37f92482e1cd0d4c61d6faaee84367d3b2ce2081bcf364473f9a9fc87d228a2749824b61cbcc6ff44bbab52bcfaf9262cf1b175a90a113ebc75d62ee48869ddccf42a7ec5e390003cafa371aa31485bf43143f96cb57d82c39bcec40506f441a0c0aa35203bf1347bac4b154f4074e29accb1be1e76cce8dddfdccdc8614823671517fc51b65799fdfc173be0c99aee7c45c8e9c3dbd031299cebe3aff9a7342176b5edc9cdce4f14206b82ceef933f06d8ed0bd0b7546aad9aad842e712af79dd101d8b37675bef6f1d6c5eb38a8649821d45b6c0f996a54f2f5bcbe23f57343cacbfbeb3ab9bcd58ac6f3b28c6fad194b173c8282ba5a74374409ff051fdeb898431dfd6ac35072fb8df783b33217c93dd1b3c10fe187373d64b496188d6d1b16a47fed35e3968aaa823255dcbc7261c54"},
    {0, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "55aaf89ba89413d54ea727a76c27a284", 0, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "29d5798cb5e3c86164853ae36a73193f4d331a39ee8c633f47d38054731aec346751910e65a1b53a87c138a7d6dc053455deb71b6586569b40947cd4dbfb412a202c80023280dd16ee38bd531c7a799dd7879780e9c141be5694bf8cc47808ac64a6fe29f54b3806a6f4b26fea17046b061684bbe61147ac71ee4904b45a674d2533767081eec707de7aad1ee8b2e9ea90620eea704d443e3e9fe665622b02cc459c566880228007ad5a7821683b2dfb5d33f0e83c5ebd865a14b87a1de155d526749f50456aa8ecc9458c62f02da085e16a2df5d4a0b0801b7299b69091d648c48ab7573df59638529ee032727d7aaca181ea463ff5881e880980dce59ddec395bd46084728c35d1b07eaa4af66c99573f8b37d427ac21a3ddac6b5988cc730941f0ef1c5034680ef20560fd756f5be5f8d296f00e81c984357c5ff760dfb475416e786bcaf738a25c705eec70263cb4b3ee71596ef5ec9b9db3ad2e497834c94683c4a5206a831fbb603e8add2c91365a6075e0bc2d392e54bf10f32bb24af4ee362e0035fd15d7e70b21d126cf1e84fd22902eed0beab8693bcbfe57a20d1a67681df82d6c359435eda9bb90090ff84d5193b53f23945946d853da31ed6fe36a903d94d427bc1ccc76d7b31badfe508e6a4abc491e10a6ff86fa4d836e1fd"},
    {1, "dec0d4fcbf3c4741c892dabd1cd4c04e", "55aaf89ba89413d54ea727a76c27a284", 64, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "e91175fda4f5ea57c52b0d000bbe98af68c0a59058aeed8ab5b7063503a1ce470d79dad174f90aaafaa5449d848dc8b2c557d1e7fa4b9a41a2fb1e9fea1414b593dab40c04f14b4f81400fe43c93990181b096a15561169aea177f100416e20b6810b00ee1b04fef67f3bede28baf4d41d397daf1511e9020d7766e9e60410de38e1432dbffa0f992dc1f0d4756544e8c765af7df706f90e009db9384c33e44dea543c2a77bbd52022de41e7d71a498de7feb9760eb47e503366c88dcc2d1a387788de2d8f78e72c2bdd8815bc8a54e8d0eee275683ca5041290f031ad5a4454efa17cc4907718f3ef4b75fedbd13583254f441a15a8a3323b12f40b8fbebc816cf9b468d8d7a5a0fb548498c39a6ed84615f894929838aef8e301660f76b632493f23709fedfd5e107f78267f331b60a38c146f9710484a4acdeff110b3b7745ff83aa8cb5de9e15b11e20a785572041f2852a1981156edcf07e46eb64144449cce74b9cc94163a6fda8ae19219721d60b757b5b5ec718dabd50954b6e6a393f656f6346f40229d0c50e01c15701f2a4fe5d25a174edf9b90ee0c0ebf9e06b5fe00558638a1ea3781403b0c9206d9e814d6a79fb7a56060e1c7176af36c6a1ad635981a9bfd8007d8cf6d9f93f0e8e22b93a9a2ccd7090ab1df63cea3f040"},
    {1, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "55aaf89ba89413d54ea727a76c27a284", 64, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "37529a432f50ba4e53385f8266ec3deccceceade7ae29395e9291076c95bb9a24f4792fcdd6ea5894b815edb5d5e4022fabe055a06b1a7e01979555b57983864bf23019cb1b37ffdadb057f728cfb2af0a33d146344cfba0accb4dbf613a7bee523ca6d6860e474a9c0f4d068d4c0acd94cc55cbf21e4285ca15116c97020f2c33b4585008f8fe97c9e29c0627c5d47c48d94be88b9b16c7f2df740a8d2a07556305b82b919f7a87ca2ed19db27262c277c213f2a7eca25e5a6adbea430ba2e1061198171054285aff9e0869c638dcd524cbf1f255da675acad6d78679a9958b7a8f9bb21dd9c580ad196f9a0e4c6a6500d7bb21df74cd5934ce3c4d8d1f39d34a2adb58d224c48097887cde9d3be146a3ea3bade4c6864cf9e445b5c4c2b3ef4e2b8f5eea0ab1c0b9abe7a4fe5b2c0b1d94df6b12953d3273260e80bd094dec97a3177a9cec0b5042be1804040c9439403b8f72f7426fa756ad6266cf2c8659e740329dd0d24f9f85497662cad739f71d6174011c77f8f31fb44226288dfb86817ef17116321c71bb9ed97db6e990f62058580f006683431f229662f1d5e3cdaffe0335467ca72635688c939ec8b32d6465f651a635f73c0a4e7f0aadb0e81f5bcbfaec2671ac97fdc2fd32f24c941775c37a6810d4b171bc8aba90a86603"},
    {2, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 4, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "b4f128b7693493eee0afafeca8f4f17909cae1ed38d8fdfeba666fcfe4be82b19ff60635f971e4fe517efdbf642bfb936b5ba6e7c9f1b4d6702f7ba4ba86364116b5c952ec3b348bac2729597b3e66a75296fa5d60a98759f5ffa4c0a99f19108b914c04908394c5cc2e176ec1e47f78f21836f0b5a262f4f944867a7e97266c7444966d26c2159f8ccdb7236197ba789116eb16d2dfbb8fa2b75dc468336035eafab84ced9d25cbe257de4bf05fdade4051a54bc9d8be0d74d945422fa144f74afd9db5a27935205b7ce669e011bb323d4d674f4739a374ea951b69181f9f0380822a5e7dc88efb94c91195e854321112cbbae2a4e3ca4c4110a3e084341f658148ab9f2ab1fd6256c95f753e0ccd4e247ec47959b925a142b575ba477c846e781bf6a3120d5ac87f52d1f1aa49f78960f4fefb77479c1b6b35212d16009030200b74157df6d9ab9ee08eea8df2a8599a42e3a1b66001584e0c07ef1ece1f596f6b2a25f194e80108fb7592b70930275e3b46e61aa5619c8c8d1f3e0ace3730cf00c5cac56c85af5004109adfff04c4bcb2f01d0d7805e1ca0323e19e5c9849cd6b9de0f563c2ab9cf5f7b7a5283ec86e1d97ce64af5824f25a045249fa8cf5d9099923f2ce4ec579730f508065bff05b97f93e3ef412031187ded25d957bc2e2c6fd"},
    {2, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 4, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "b4f128b7693493eee0afafeca8f4f17909cae1ed38d8fdfeba666fcfe4be82b19ff60635f971e4fe517efdbf642bfb936b5ba6e7c9f1b4d6702f7ba4ba86364116b5c952ec3b348bac2729597b3e66a75296fa5d60a98759f5ffa4c0a99f19108b914c04908394c5cc2e176ec1e47f78f21836f0b5a262f4f944867a7e97266c7444966d26c2159f8ccdb7236197ba789116eb16d2dfbb8fa2b75dc468336035eafab84ced9d25cbe257de4bf05fdade4051a54bc9d8be0d74d945422fa144f74afd9db5a27935205b7ce669e011bb323d4d674f4739a374ea951b69181f9f0380822a5e7dc88efb94c91195e854321112cbbae2a4e3ca4c4110a3e084341f658148ab9f2ab1fd6256c95f753e0ccd4e247ec47959b925a142b575ba477c846e781bf6a3120d5ac87f52d1f1aa49f78960f4fefb77479c1b6b35212d16009030200b74157df6d9ab9ee08eea8df2a8599a42e3a1b66001584e0c07ef1ece1f596f6b2a25f194e80108fb7592b70930275e3b46e61aa5619c8c8d1f3e0ace3730cf00c5cac56c85af5004109adfff04c4bcb2f01d0d7805e1ca0323e19e5c9849cd6b9de0f563c2ab9cf5f7b7a5283ec86e1d97ce64af5824f25a045249fa8cf5d9099923f2ce4ec579730f508065bff05b97f93e3ef412031187ded25d957bde330b17"},
    {2, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 8, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "b4f128b7693493eee0afafeca8f4f17909cae1ed38d8fdfeba666fcfe4be82b19ff60635f971e4fe517efdbf642bfb936b5ba6e7c9f1b4d6702f7ba4ba86364116b5c952ec3b348bac2729597b3e66a75296fa5d60a98759f5ffa4c0a99f19108b914c04908394c5cc2e176ec1e47f78f21836f0b5a262f4f944867a7e97266c7444966d26c2159f8ccdb7236197ba789116eb16d2dfbb8fa2b75dc468336035eafab84ced9d25cbe257de4bf05fdade4051a54bc9d8be0d74d945422fa144f74afd9db5a27935205b7ce669e011bb323d4d674f4739a374ea951b69181f9f0380822a5e7dc88efb94c91195e854321112cbbae2a4e3ca4c4110a3e084341f658148ab9f2ab1fd6256c95f753e0ccd4e247ec47959b925a142b575ba477c846e781bf6a3120d5ac87f52d1f1aa49f78960f4fefb77479c1b6b35212d16009030200b74157df6d9ab9ee08eea8df2a8599a42e3a1b66001584e0c07ef1ece1f596f6b2a25f194e80108fb7592b70930275e3b46e61aa5619c8c8d1f3e0ace3730cf00c5cac56c85af5004109adfff04c4bcb2f01d0d7805e1ca0323e19e5c9849cd6b9de0f563c2ab9cf5f7b7a5283ec86e1d97ce64af5824f25a045249fa8cf5d9099923f2ce4ec579730f508065bff05b97f93e3ef412031187ded25d957bc2e2c6fdef1cc5f0"},
    {2, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 8, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "b4f128b7693493eee0afafeca8f4f17909cae1ed38d8fdfeba666fcfe4be82b19ff60635f971e4fe517efdbf642bfb936b5ba6e7c9f1b4d6702f7ba4ba86364116b5c952ec3b348bac2729597b3e66a75296fa5d60a98759f5ffa4c0a99f19108b914c04908394c5cc2e176ec1e47f78f21836f0b5a262f4f944867a7e97266c7444966d26c2159f8ccdb7236197ba789116eb16d2dfbb8fa2b75dc468336035eafab84ced9d25cbe257de4bf05fdade4051a54bc9d8be0d74d945422fa144f74afd9db5a27935205b7ce669e011bb323d4d674f4739a374ea951b69181f9f0380822a5e7dc88efb94c91195e854321112cbbae2a4e3ca4c4110a3e084341f658148ab9f2ab1fd6256c95f753e0ccd4e247ec47959b925a142b575ba477c846e781bf6a3120d5ac87f52d1f1aa49f78960f4fefb77479c1b6b35212d16009030200b74157df6d9ab9ee08eea8df2a8599a42e3a1b66001584e0c07ef1ece1f596f6b2a25f194e80108fb7592b70930275e3b46e61aa5619c8c8d1f3e0ace3730cf00c5cac56c85af5004109adfff04c4bcb2f01d0d7805e1ca0323e19e5c9849cd6b9de0f563c2ab9cf5f7b7a5283ec86e1d97ce64af5824f25a045249fa8cf5d9099923f2ce4ec579730f508065bff05b97f93e3ef412031187ded25d957bde330b1724defaf8"},
    {2, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 12, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "b4f128b7693493eee0afafeca8f4f17909cae1ed38d8fdfeba666fcfe4be82b19ff60635f971e4fe517efdbf642bfb936b5ba6e7c9f1b4d6702f7ba4ba86364116b5c952ec3b348bac2729597b3e66a75296fa5d60a98759f5ffa4c0a99f19108b914c04908394c5cc2e176ec1e47f78f21836f0b5a262f4f944867a7e97266c7444966d26c2159f8ccdb7236197ba789116eb16d2dfbb8fa2b75dc468336035eafab84ced9d25cbe257de4bf05fdade4051a54bc9d8be0d74d945422fa144f74afd9db5a27935205b7ce669e011bb323d4d674f4739a374ea951b69181f9f0380822a5e7dc88efb94c91195e854321112cbbae2a4e3ca4c4110a3e084341f658148ab9f2ab1fd6256c95f753e0ccd4e247ec47959b925a142b575ba477c846e781bf6a3120d5ac87f52d1f1aa49f78960f4fefb77479c1b6b35212d16009030200b74157df6d9ab9ee08eea8df2a8599a42e3a1b66001584e0c07ef1ece1f596f6b2a25f194e80108fb7592b70930275e3b46e61aa5619c8c8d1f3e0ace3730cf00c5cac56c85af5004109adfff04c4bcb2f01d0d7805e1ca0323e19e5c9849cd6b9de0f563c2ab9cf5f7b7a5283ec86e1d97ce64af5824f25a045249fa8cf5d9099923f2ce4ec579730f508065bff05b97f93e3ef412031187ded25d957bc2e2c6fdef1cc5f07bd8b097"},
    {2, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 12, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "b4f128b7693493eee0afafeca8f4f17909cae1ed38d8fdfeba666fcfe4be82b19ff60635f971e4fe517efdbf642bfb936b5ba6e7c9f1b4d6702f7ba4ba86364116b5c952ec3b348bac2729597b3e66a75296fa5d60a98759f5ffa4c0a99f19108b914c04908394c5cc2e176ec1e47f78f21836f0b5a262f4f944867a7e97266c7444966d26c2159f8ccdb7236197ba789116eb16d2dfbb8fa2b75dc468336035eafab84ced9d25cbe257de4bf05fdade4051a54bc9d8be0d74d945422fa144f74afd9db5a27935205b7ce669e011bb323d4d674f4739a374ea951b69181f9f0380822a5e7dc88efb94c91195e854321112cbbae2a4e3ca4c4110a3e084341f658148ab9f2ab1fd6256c95f753e0ccd4e247ec47959b925a142b575ba477c846e781bf6a3120d5ac87f52d1f1aa49f78960f4fefb77479c1b6b35212d16009030200b74157df6d9ab9ee08eea8df2a8599a42e3a1b66001584e0c07ef1ece1f596f6b2a25f194e80108fb7592b70930275e3b46e61aa5619c8c8d1f3e0ace3730cf00c5cac56c85af5004109adfff04c4bcb2f01d0d7805e1ca0323e19e5c9849cd6b9de0f563c2ab9cf5f7b7a5283ec86e1d97ce64af5824f25a045249fa8cf5d9099923f2ce4ec579730f508065bff05b97f93e3ef412031187ded25d957bde330b1724defaf81b621e51"},
    {2, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 13, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "b4f128b7693493eee0afafeca8f4f17909cae1ed38d8fdfeba666fcfe4be82b19ff60635f971e4fe517efdbf642bfb936b5ba6e7c9f1b4d6702f7ba4ba86364116b5c952ec3b348bac2729597b3e66a75296fa5d60a98759f5ffa4c0a99f19108b914c04908394c5cc2e176ec1e47f78f21836f0b5a262f4f944867a7e97266c7444966d26c2159f8ccdb7236197ba789116eb16d2dfbb8fa2b75dc468336035eafab84ced9d25cbe257de4bf05fdade4051a54bc9d8be0d74d945422fa144f74afd9db5a27935205b7ce669e011bb323d4d674f4739a374ea951b69181f9f0380822a5e7dc88efb94c91195e854321112cbbae2a4e3ca4c4110a3e084341f658148ab9f2ab1fd6256c95f753e0ccd4e247ec47959b925a142b575ba477c846e781bf6a3120d5ac87f52d1f1aa49f78960f4fefb77479c1b6b35212d16009030200b74157df6d9ab9ee08eea8df2a8599a42e3a1b66001584e0c07ef1ece1f596f6b2a25f194e80108fb7592b70930275e3b46e61aa5619c8c8d1f3e0ace3730cf00c5cac56c85af5004109adfff04c4bcb2f01d0d7805e1ca0323e19e5c9849cd6b9de0f563c2ab9cf5f7b7a5283ec86e1d97ce64af5824f25a045249fa8cf5d9099923f2ce4ec579730f508065bff05b97f93e3ef412031187ded25d957bc2e2c6fdef1cc5f07bd8b097ef"},
    {2, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 13, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "b4f128b7693493eee0afafeca8f4f17909cae1ed38d8fdfeba666fcfe4be82b19ff60635f971e4fe517efdbf642bfb936b5ba6e7c9f1b4d6702f7ba4ba86364116b5c952ec3b348bac2729597b3e66a75296fa5d60a98759f5ffa4c0a99f19108b914c04908394c5cc2e176ec1e47f78f21836f0b5a262f4f944867a7e97266c7444966d26c2159f8ccdb7236197ba789116eb16d2dfbb8fa2b75dc468336035eafab84ced9d25cbe257de4bf05fdade4051a54bc9d8be0d74d945422fa144f74afd9db5a27935205b7ce669e011bb323d4d674f4739a374ea951b69181f9f0380822a5e7dc88efb94c91195e854321112cbbae2a4e3ca4c4110a3e084341f658148ab9f2ab1fd6256c95f753e0ccd4e247ec47959b925a142b575ba477c846e781bf6a3120d5ac87f52d1f1aa49f78960f4fefb77479c1b6b35212d16009030200b74157df6d9ab9ee08eea8df2a8599a42e3a1b66001584e0c07ef1ece1f596f6b2a25f194e80108fb7592b70930275e3b46e61aa5619c8c8d1f3e0ace3730cf00c5cac56c85af5004109adfff04c4bcb2f01d0d7805e1ca0323e19e5c9849cd6b9de0f563c2ab9cf5f7b7a5283ec86e1d97ce64af5824f25a045249fa8cf5d9099923f2ce4ec579730f508065bff05b97f93e3ef412031187ded25d957bde330b1724defaf81b621e5196"},
    {2, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 14, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "b4f128b7693493eee0afafeca8f4f17909cae1ed38d8fdfeba666fcfe4be82b19ff60635f971e4fe517efdbf642bfb936b5ba6e7c9f1b4d6702f7ba4ba86364116b5c952ec3b348bac2729597b3e66a75296fa5d60a98759f5ffa4c0a99f19108b914c04908394c5cc2e176ec1e47f78f21836f0b5a262f4f944867a7e97266c7444966d26c2159f8ccdb7236197ba789116eb16d2dfbb8fa2b75dc468336035eafab84ced9d25cbe257de4bf05fdade4051a54bc9d8be0d74d945422fa144f74afd9db5a27935205b7ce669e011bb323d4d674f4739a374ea951b69181f9f0380822a5e7dc88efb94c91195e854321112cbbae2a4e3ca4c4110a3e084341f658148ab9f2ab1fd6256c95f753e0ccd4e247ec47959b925a142b575ba477c846e781bf6a3120d5ac87f52d1f1aa49f78960f4fefb77479c1b6b35212d16009030200b74157df6d9ab9ee08eea8df2a8599a42e3a1b66001584e0c07ef1ece1f596f6b2a25f194e80108fb7592b70930275e3b46e61aa5619c8c8d1f3e0ace3730cf00c5cac56c85af5004109adfff04c4bcb2f01d0d7805e1ca0323e19e5c9849cd6b9de0f563c2ab9cf5f7b7a5283ec86e1d97ce64af5824f25a045249fa8cf5d9099923f2ce4ec579730f508065bff05b97f93e3ef412031187ded25d957bc2e2c6fdef1cc5f07bd8b097efc8"},
    {2, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 14, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "b4f128b7693493eee0afafeca8f4f17909cae1ed38d8fdfeba666fcfe4be82b19ff60635f971e4fe517efdbf642bfb936b5ba6e7c9f1b4d6702f7ba4ba86364116b5c952ec3b348bac2729597b3e66a75296fa5d60a98759f5ffa4c0a99f19108b914c04908394c5cc2e176ec1e47f78f21836f0b5a262f4f944867a7e97266c7444966d26c2159f8ccdb7236197ba789116eb16d2dfbb8fa2b75dc468336035eafab84ced9d25cbe257de4bf05fdade4051a54bc9d8be0d74d945422fa144f74afd9db5a27935205b7ce669e011bb323d4d674f4739a374ea951b69181f9f0380822a5e7dc88efb94c91195e854321112cbbae2a4e3ca4c4110a3e084341f658148ab9f2ab1fd6256c95f753e0ccd4e247ec47959b925a142b575ba477c846e781bf6a3120d5ac87f52d1f1aa49f78960f4fefb77479c1b6b35212d16009030200b74157df6d9ab9ee08eea8df2a8599a42e3a1b66001584e0c07ef1ece1f596f6b2a25f194e80108fb7592b70930275e3b46e61aa5619c8c8d1f3e0ace3730cf00c5cac56c85af5004109adfff04c4bcb2f01d0d7805e1ca0323e19e5c9849cd6b9de0f563c2ab9cf5f7b7a5283ec86e1d97ce64af5824f25a045249fa8cf5d9099923f2ce4ec579730f508065bff05b97f93e3ef412031187ded25d957bde330b1724defaf81b621e519623"},
    {2, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 15, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "b4f128b7693493eee0afafeca8f4f17909cae1ed38d8fdfeba666fcfe4be82b19ff60635f971e4fe517efdbf642bfb936b5ba6e7c9f1b4d6702f7ba4ba86364116b5c952ec3b348bac2729597b3e66a75296fa5d60a98759f5ffa4c0a99f19108b914c04908394c5cc2e176ec1e47f78f21836f0b5a262f4f944867a7e97266c7444966d26c2159f8ccdb7236197ba789116eb16d2dfbb8fa2b75dc468336035eafab84ced9d25cbe257de4bf05fdade4051a54bc9d8be0d74d945422fa144f74afd9db5a27935205b7ce669e011bb323d4d674f4739a374ea951b69181f9f0380822a5e7dc88efb94c91195e854321112cbbae2a4e3ca4c4110a3e084341f658148ab9f2ab1fd6256c95f753e0ccd4e247ec47959b925a142b575ba477c846e781bf6a3120d5ac87f52d1f1aa49f78960f4fefb77479c1b6b35212d16009030200b74157df6d9ab9ee08eea8df2a8599a42e3a1b66001584e0c07ef1ece1f596f6b2a25f194e80108fb7592b70930275e3b46e61aa5619c8c8d1f3e0ace3730cf00c5cac56c85af5004109adfff04c4bcb2f01d0d7805e1ca0323e19e5c9849cd6b9de0f563c2ab9cf5f7b7a5283ec86e1d97ce64af5824f25a045249fa8cf5d9099923f2ce4ec579730f508065bff05b97f93e3ef412031187ded25d957bc2e2c6fdef1cc5f07bd8b097efc8b8"},
    {2, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 15, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "b4f128b7693493eee0afafeca8f4f17909cae1ed38d8fdfeba666fcfe4be82b19ff60635f971e4fe517efdbf642bfb936b5ba6e7c9f1b4d6702f7ba4ba86364116b5c952ec3b348bac2729597b3e66a75296fa5d60a98759f5ffa4c0a99f19108b914c04908394c5cc2e176ec1e47f78f21836f0b5a262f4f944867a7e97266c7444966d26c2159f8ccdb7236197ba789116eb16d2dfbb8fa2b75dc468336035eafab84ced9d25cbe257de4bf05fdade4051a54bc9d8be0d74d945422fa144f74afd9db5a27935205b7ce669e011bb323d4d674f4739a374ea951b69181f9f0380822a5e7dc88efb94c91195e854321112cbbae2a4e3ca4c4110a3e084341f658148ab9f2ab1fd6256c95f753e0ccd4e247ec47959b925a142b575ba477c846e781bf6a3120d5ac87f52d1f1aa49f78960f4fefb77479c1b6b35212d16009030200b74157df6d9ab9ee08eea8df2a8599a42e3a1b66001584e0c07ef1ece1f596f6b2a25f194e80108fb7592b70930275e3b46e61aa5619c8c8d1f3e0ace3730cf00c5cac56c85af5004109adfff04c4bcb2f01d0d7805e1ca0323e19e5c9849cd6b9de0f563c2ab9cf5f7b7a5283ec86e1d97ce64af5824f25a045249fa8cf5d9099923f2ce4ec579730f508065bff05b97f93e3ef412031187ded25d957bde330b1724defaf81b621e519623dc"},
    {2, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 16, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "b4f128b7693493eee0afafeca8f4f17909cae1ed38d8fdfeba666fcfe4be82b19ff60635f971e4fe517efdbf642bfb936b5ba6e7c9f1b4d6702f7ba4ba86364116b5c952ec3b348bac2729597b3e66a75296fa5d60a98759f5ffa4c0a99f19108b914c04908394c5cc2e176ec1e47f78f21836f0b5a262f4f944867a7e97266c7444966d26c2159f8ccdb7236197ba789116eb16d2dfbb8fa2b75dc468336035eafab84ced9d25cbe257de4bf05fdade4051a54bc9d8be0d74d945422fa144f74afd9db5a27935205b7ce669e011bb323d4d674f4739a374ea951b69181f9f0380822a5e7dc88efb94c91195e854321112cbbae2a4e3ca4c4110a3e084341f658148ab9f2ab1fd6256c95f753e0ccd4e247ec47959b925a142b575ba477c846e781bf6a3120d5ac87f52d1f1aa49f78960f4fefb77479c1b6b35212d16009030200b74157df6d9ab9ee08eea8df2a8599a42e3a1b66001584e0c07ef1ece1f596f6b2a25f194e80108fb7592b70930275e3b46e61aa5619c8c8d1f3e0ace3730cf00c5cac56c85af5004109adfff04c4bcb2f01d0d7805e1ca0323e19e5c9849cd6b9de0f563c2ab9cf5f7b7a5283ec86e1d97ce64af5824f25a045249fa8cf5d9099923f2ce4ec579730f508065bff05b97f93e3ef412031187ded25d957bc2e2c6fdef1cc5f07bd8b097efc8b8b7"},
    {2, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 16, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "b4f128b7693493eee0afafeca8f4f17909cae1ed38d8fdfeba666fcfe4be82b19ff60635f971e4fe517efdbf642bfb936b5ba6e7c9f1b4d6702f7ba4ba86364116b5c952ec3b348bac2729597b3e66a75296fa5d60a98759f5ffa4c0a99f19108b914c04908394c5cc2e176ec1e47f78f21836f0b5a262f4f944867a7e97266c7444966d26c2159f8ccdb7236197ba789116eb16d2dfbb8fa2b75dc468336035eafab84ced9d25cbe257de4bf05fdade4051a54bc9d8be0d74d945422fa144f74afd9db5a27935205b7ce669e011bb323d4d674f4739a374ea951b69181f9f0380822a5e7dc88efb94c91195e854321112cbbae2a4e3ca4c4110a3e084341f658148ab9f2ab1fd6256c95f753e0ccd4e247ec47959b925a142b575ba477c846e781bf6a3120d5ac87f52d1f1aa49f78960f4fefb77479c1b6b35212d16009030200b74157df6d9ab9ee08eea8df2a8599a42e3a1b66001584e0c07ef1ece1f596f6b2a25f194e80108fb7592b70930275e3b46e61aa5619c8c8d1f3e0ace3730cf00c5cac56c85af5004109adfff04c4bcb2f01d0d7805e1ca0323e19e5c9849cd6b9de0f563c2ab9cf5f7b7a5283ec86e1d97ce64af5824f25a045249fa8cf5d9099923f2ce4ec579730f508065bff05b97f93e3ef412031187ded25d957bde330b1724defaf81b621e519623dcc6"},
    {2, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 4, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0861eb7146208783d2d17ca0ffb6091d7dc11bf0812e0289a98e3d079136aacf9f6f275f573fa21b0612dbd774225a3972f4669143063398f7a5f27464dbb148b1116e435ddb64d914cf599a2d25695343a28ceb8128b1caae3694379cc1e8f986a3c33372744126496360f9e0451177babcb52b4e9c4c8ae23f05f8095e1a0102eb27ae4a2fb716282f2f0d64770c43b2b838a7ee8f0d2cd0b9976c0611347ab6d2cf2adb254a5e7e24f9252004da2cee4538db1f4dad2ebb672470d5fc2857a4f0a39f20817db26c2f1c1f242a73240e91c39cbf2ea3f9b51f5a491e4839df3f3c4f8c0e751f91de9c79ed20918f600cfe2315153ba8ab9ad9003bcaaf67d6c0af1a122b36b0de4b16077afde0913d2ad049ed548dd1d5e42ef43b0944062358bd0a3e09551c2c521399a0b2f038a0f4c9ad4d3d14e31eb4a71069b9c15fcf2917864ec6b65d1859f7e74be9c289f272c2be828aee5e89c1c27389becfa9539b0ed2a081c3a1eaddff7243620c5d2941b7f467f76552f67d577d4e15ba66cd142820c9ae0f34f0d9b4a26c06d3291287e8b812bca99dbe4ca64bb07f27fb16cb995031f17c89977bcc2b9fbeb1c41275a92e98fb2d19a41b91d6e4370f0283d850ffccaf643b910f6728212dffc8feac8a143a57b6c094db2958e6e546f9bceff130"},
    {2, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 4, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0861eb7146208783d2d17ca0ffb6091d7dc11bf0812e0289a98e3d079136aacf9f6f275f573fa21b0612dbd774225a3972f4669143063398f7a5f27464dbb148b1116e435ddb64d914cf599a2d25695343a28ceb8128b1caae3694379cc1e8f986a3c33372744126496360f9e0451177babcb52b4e9c4c8ae23f05f8095e1a0102eb27ae4a2fb716282f2f0d64770c43b2b838a7ee8f0d2cd0b9976c0611347ab6d2cf2adb254a5e7e24f9252004da2cee4538db1f4dad2ebb672470d5fc2857a4f0a39f20817db26c2f1c1f242a73240e91c39cbf2ea3f9b51f5a491e4839df3f3c4f8c0e751f91de9c79ed20918f600cfe2315153ba8ab9ad9003bcaaf67d6c0af1a122b36b0de4b16077afde0913d2ad049ed548dd1d5e42ef43b0944062358bd0a3e09551c2c521399a0b2f038a0f4c9ad4d3d14e31eb4a71069b9c15fcf2917864ec6b65d1859f7e74be9c289f272c2be828aee5e89c1c27389becfa9539b0ed2a081c3a1eaddff7243620c5d2941b7f467f76552f67d577d4e15ba66cd142820c9ae0f34f0d9b4a26c06d3291287e8b812bca99dbe4ca64bb07f27fb16cb995031f17c89977bcc2b9fbeb1c41275a92e98fb2d19a41b91d6e4370f0283d850ffccaf643b910f6728212dffc8feac8a143a57b6c094db2958e6e546f9f4ba56cb"},
    {2, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 8, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0861eb7146208783d2d17ca0ffb6091d7dc11bf0812e0289a98e3d079136aacf9f6f275f573fa21b0612dbd774225a3972f4669143063398f7a5f27464dbb148b1116e435ddb64d914cf599a2d25695343a28ceb8128b1caae3694379cc1e8f986a3c33372744126496360f9e0451177babcb52b4e9c4c8ae23f05f8095e1a0102eb27ae4a2fb716282f2f0d64770c43b2b838a7ee8f0d2cd0b9976c0611347ab6d2cf2adb254a5e7e24f9252004da2cee4538db1f4dad2ebb672470d5fc2857a4f0a39f20817db26c2f1c1f242a73240e91c39cbf2ea3f9b51f5a491e4839df3f3c4f8c0e751f91de9c79ed20918f600cfe2315153ba8ab9ad9003bcaaf67d6c0af1a122b36b0de4b16077afde0913d2ad049ed548dd1d5e42ef43b0944062358bd0a3e09551c2c521399a0b2f038a0f4c9ad4d3d14e31eb4a71069b9c15fcf2917864ec6b65d1859f7e74be9c289f272c2be828aee5e89c1c27389becfa9539b0ed2a081c3a1eaddff7243620c5d2941b7f467f76552f67d577d4e15ba66cd142820c9ae0f34f0d9b4a26c06d3291287e8b812bca99dbe4ca64bb07f27fb16cb995031f17c89977bcc2b9fbeb1c41275a92e98fb2d19a41b91d6e4370f0283d850ffccaf643b910f6728212dffc8feac8a143a57b6c094db2958e6e546f9bceff1309f15d500"},
    {2, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 8, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0861eb7146208783d2d17ca0ffb6091d7dc11bf0812e0289a98e3d079136aacf9f6f275f573fa21b0612dbd774225a3972f4669143063398f7a5f27464dbb148b1116e435ddb64d914cf599a2d25695343a28ceb8128b1caae3694379cc1e8f986a3c33372744126496360f9e0451177babcb52b4e9c4c8ae23f05f8095e1a0102eb27ae4a2fb716282f2f0d64770c43b2b838a7ee8f0d2cd0b9976c0611347ab6d2cf2adb254a5e7e24f9252004da2cee4538db1f4dad2ebb672470d5fc2857a4f0a39f20817db26c2f1c1f242a73240e91c39cbf2ea3f9b51f5a491e4839df3f3c4f8c0e751f91de9c79ed20918f600cfe2315153ba8ab9ad9003bcaaf67d6c0af1a122b36b0de4b16077afde0913d2ad049ed548dd1d5e42ef43b0944062358bd0a3e09551c2c521399a0b2f038a0f4c9ad4d3d14e31eb4a71069b9c15fcf2917864ec6b65d1859f7e74be9c289f272c2be828aee5e89c1c27389becfa9539b0ed2a081c3a1eaddff7243620c5d2941b7f467f76552f67d577d4e15ba66cd142820c9ae0f34f0d9b4a26c06d3291287e8b812bca99dbe4ca64bb07f27fb16cb995031f17c89977bcc2b9fbeb1c41275a92e98fb2d19a41b91d6e4370f0283d850ffccaf643b910f6728212dffc8feac8a143a57b6c094db2958e6e546f9f4ba56cb9a25bff8"},
    {2, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 12, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0861eb7146208783d2d17ca0ffb6091d7dc11bf0812e0289a98e3d079136aacf9f6f275f573fa21b0612dbd774225a3972f4669143063398f7a5f27464dbb148b1116e435ddb64d914cf599a2d25695343a28ceb8128b1caae3694379cc1e8f986a3c33372744126496360f9e0451177babcb52b4e9c4c8ae23f05f8095e1a0102eb27ae4a2fb716282f2f0d64770c43b2b838a7ee8f0d2cd0b9976c0611347ab6d2cf2adb254a5e7e24f9252004da2cee4538db1f4dad2ebb672470d5fc2857a4f0a39f20817db26c2f1c1f242a73240e91c39cbf2ea3f9b51f5a491e4839df3f3c4f8c0e751f91de9c79ed20918f600cfe2315153ba8ab9ad9003bcaaf67d6c0af1a122b36b0de4b16077afde0913d2ad049ed548dd1d5e42ef43b0944062358bd0a3e09551c2c521399a0b2f038a0f4c9ad4d3d14e31eb4a71069b9c15fcf2917864ec6b65d1859f7e74be9c289f272c2be828aee5e89c1c27389becfa9539b0ed2a081c3a1eaddff7243620c5d2941b7f467f76552f67d577d4e15ba66cd142820c9ae0f34f0d9b4a26c06d3291287e8b812bca99dbe4ca64bb07f27fb16cb995031f17c89977bcc2b9fbeb1c41275a92e98fb2d19a41b91d6e4370f0283d850ffccaf643b910f6728212dffc8feac8a143a57b6c094db2958e6e546f9bceff1309f15d500f12a554c"},
    {2, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 12, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0861eb7146208783d2d17ca0ffb6091d7dc11bf0812e0289a98e3d079136aacf9f6f275f573fa21b0612dbd774225a3972f4669143063398f7a5f27464dbb148b1116e435ddb64d914cf599a2d25695343a28ceb8128b1caae3694379cc1e8f986a3c33372744126496360f9e0451177babcb52b4e9c4c8ae23f05f8095e1a0102eb27ae4a2fb716282f2f0d64770c43b2b838a7ee8f0d2cd0b9976c0611347ab6d2cf2adb254a5e7e24f9252004da2cee4538db1f4dad2ebb672470d5fc2857a4f0a39f20817db26c2f1c1f242a73240e91c39cbf2ea3f9b51f5a491e4839df3f3c4f8c0e751f91de9c79ed20918f600cfe2315153ba8ab9ad9003bcaaf67d6c0af1a122b36b0de4b16077afde0913d2ad049ed548dd1d5e42ef43b0944062358bd0a3e09551c2c521399a0b2f038a0f4c9ad4d3d14e31eb4a71069b9c15fcf2917864ec6b65d1859f7e74be9c289f272c2be828aee5e89c1c27389becfa9539b0ed2a081c3a1eaddff7243620c5d2941b7f467f76552f67d577d4e15ba66cd142820c9ae0f34f0d9b4a26c06d3291287e8b812bca99dbe4ca64bb07f27fb16cb995031f17c89977bcc2b9fbeb1c41275a92e98fb2d19a41b91d6e4370f0283d850ffccaf643b910f6728212dffc8feac8a143a57b6c094db2958e6e546f9f4ba56cb9a25bff8f6398b82"},
    {2, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 13, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0861eb7146208783d2d17ca0ffb6091d7dc11bf0812e0289a98e3d079136aacf9f6f275f573fa21b0612dbd774225a3972f4669143063398f7a5f27464dbb148b1116e435ddb64d914cf599a2d25695343a28ceb8128b1caae3694379cc1e8f986a3c33372744126496360f9e0451177babcb52b4e9c4c8ae23f05f8095e1a0102eb27ae4a2fb716282f2f0d64770c43b2b838a7ee8f0d2cd0b9976c0611347ab6d2cf2adb254a5e7e24f9252004da2cee4538db1f4dad2ebb672470d5fc2857a4f0a39f20817db26c2f1c1f242a73240e91c39cbf2ea3f9b51f5a491e4839df3f3c4f8c0e751f91de9c79ed20918f600cfe2315153ba8ab9ad9003bcaaf67d6c0af1a122b36b0de4b16077afde0913d2ad049ed548dd1d5e42ef43b0944062358bd0a3e09551c2c521399a0b2f038a0f4c9ad4d3d14e31eb4a71069b9c15fcf2917864ec6b65d1859f7e74be9c289f272c2be828aee5e89c1c27389becfa9539b0ed2a081c3a1eaddff7243620c5d2941b7f467f76552f67d577d4e15ba66cd142820c9ae0f34f0d9b4a26c06d3291287e8b812bca99dbe4ca64bb07f27fb16cb995031f17c89977bcc2b9fbeb1c41275a92e98fb2d19a41b91d6e4370f0283d850ffccaf643b910f6728212dffc8feac8a143a57b6c094db2958e6e546f9bceff1309f15d500f12a554cc2"},
    {2, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 13, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0861eb7146208783d2d17ca0ffb6091d7dc11bf0812e0289a98e3d079136aacf9f6f275f573fa21b0612dbd774225a3972f4669143063398f7a5f27464dbb148b1116e435ddb64d914cf599a2d25695343a28ceb8128b1caae3694379cc1e8f986a3c33372744126496360f9e0451177babcb52b4e9c4c8ae23f05f8095e1a0102eb27ae4a2fb716282f2f0d64770c43b2b838a7ee8f0d2cd0b9976c0611347ab6d2cf2adb254a5e7e24f9252004da2cee4538db1f4dad2ebb672470d5fc2857a4f0a39f20817db26c2f1c1f242a73240e91c39cbf2ea3f9b51f5a491e4839df3f3c4f8c0e751f91de9c79ed20918f600cfe2315153ba8ab9ad9003bcaaf67d6c0af1a122b36b0de4b16077afde0913d2ad049ed548dd1d5e42ef43b0944062358bd0a3e09551c2c521399a0b2f038a0f4c9ad4d3d14e31eb4a71069b9c15fcf2917864ec6b65d1859f7e74be9c289f272c2be828aee5e89c1c27389becfa9539b0ed2a081c3a1eaddff7243620c5d2941b7f467f76552f67d577d4e15ba66cd142820c9ae0f34f0d9b4a26c06d3291287e8b812bca99dbe4ca64bb07f27fb16cb995031f17c89977bcc2b9fbeb1c41275a92e98fb2d19a41b91d6e4370f0283d850ffccaf643b910f6728212dffc8feac8a143a57b6c094db2958e6e546f9f4ba56cb9a25bff8f6398b82e0"},
    {2, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 14, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0861eb7146208783d2d17ca0ffb6091d7dc11bf0812e0289a98e3d079136aacf9f6f275f573fa21b0612dbd774225a3972f4669143063398f7a5f27464dbb148b1116e435ddb64d914cf599a2d25695343a28ceb8128b1caae3694379cc1e8f986a3c33372744126496360f9e0451177babcb52b4e9c4c8ae23f05f8095e1a0102eb27ae4a2fb716282f2f0d64770c43b2b838a7ee8f0d2cd0b9976c0611347ab6d2cf2adb254a5e7e24f9252004da2cee4538db1f4dad2ebb672470d5fc2857a4f0a39f20817db26c2f1c1f242a73240e91c39cbf2ea3f9b51f5a491e4839df3f3c4f8c0e751f91de9c79ed20918f600cfe2315153ba8ab9ad9003bcaaf67d6c0af1a122b36b0de4b16077afde0913d2ad049ed548dd1d5e42ef43b0944062358bd0a3e09551c2c521399a0b2f038a0f4c9ad4d3d14e31eb4a71069b9c15fcf2917864ec6b65d1859f7e74be9c289f272c2be828aee5e89c1c27389becfa9539b0ed2a081c3a1eaddff7243620c5d2941b7f467f76552f67d577d4e15ba66cd142820c9ae0f34f0d9b4a26c06d3291287e8b812bca99dbe4ca64bb07f27fb16cb995031f17c89977bcc2b9fbeb1c41275a92e98fb2d19a41b91d6e4370f0283d850ffccaf643b910f6728212dffc8feac8a143a57b6c094db2958e6e546f9bceff1309f15d500f12a554cc21c"},
    {2, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 14, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0861eb7146208783d2d17ca0ffb6091d7dc11bf0812e0289a98e3d079136aacf9f6f275f573fa21b0612dbd774225a3972f4669143063398f7a5f27464dbb148b1116e435ddb64d914cf599a2d25695343a28ceb8128b1caae3694379cc1e8f986a3c33372744126496360f9e0451177babcb52b4e9c4c8ae23f05f8095e1a0102eb27ae4a2fb716282f2f0d64770c43b2b838a7ee8f0d2cd0b9976c0611347ab6d2cf2adb254a5e7e24f9252004da2cee4538db1f4dad2ebb672470d5fc2857a4f0a39f20817db26c2f1c1f242a73240e91c39cbf2ea3f9b51f5a491e4839df3f3c4f8c0e751f91de9c79ed20918f600cfe2315153ba8ab9ad9003bcaaf67d6c0af1a122b36b0de4b16077afde0913d2ad049ed548dd1d5e42ef43b0944062358bd0a3e09551c2c521399a0b2f038a0f4c9ad4d3d14e31eb4a71069b9c15fcf2917864ec6b65d1859f7e74be9c289f272c2be828aee5e89c1c27389becfa9539b0ed2a081c3a1eaddff7243620c5d2941b7f467f76552f67d577d4e15ba66cd142820c9ae0f34f0d9b4a26c06d3291287e8b812bca99dbe4ca64bb07f27fb16cb995031f17c89977bcc2b9fbeb1c41275a92e98fb2d19a41b91d6e4370f0283d850ffccaf643b910f6728212dffc8feac8a143a57b6c094db2958e6e546f9f4ba56cb9a25bff8f6398b82e02f"},
    {2, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 15, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0861eb7146208783d2d17ca0ffb6091d7dc11bf0812e0289a98e3d079136aacf9f6f275f573fa21b0612dbd774225a3972f4669143063398f7a5f27464dbb148b1116e435ddb64d914cf599a2d25695343a28ceb8128b1caae3694379cc1e8f986a3c33372744126496360f9e0451177babcb52b4e9c4c8ae23f05f8095e1a0102eb27ae4a2fb716282f2f0d64770c43b2b838a7ee8f0d2cd0b9976c0611347ab6d2cf2adb254a5e7e24f9252004da2cee4538db1f4dad2ebb672470d5fc2857a4f0a39f20817db26c2f1c1f242a73240e91c39cbf2ea3f9b51f5a491e4839df3f3c4f8c0e751f91de9c79ed20918f600cfe2315153ba8ab9ad9003bcaaf67d6c0af1a122b36b0de4b16077afde0913d2ad049ed548dd1d5e42ef43b0944062358bd0a3e09551c2c521399a0b2f038a0f4c9ad4d3d14e31eb4a71069b9c15fcf2917864ec6b65d1859f7e74be9c289f272c2be828aee5e89c1c27389becfa9539b0ed2a081c3a1eaddff7243620c5d2941b7f467f76552f67d577d4e15ba66cd142820c9ae0f34f0d9b4a26c06d3291287e8b812bca99dbe4ca64bb07f27fb16cb995031f17c89977bcc2b9fbeb1c41275a92e98fb2d19a41b91d6e4370f0283d850ffccaf643b910f6728212dffc8feac8a143a57b6c094db2958e6e546f9bceff1309f15d500f12a554cc21c31"},
    {2, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 15, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0861eb7146208783d2d17ca0ffb6091d7dc11bf0812e0289a98e3d079136aacf9f6f275f573fa21b0612dbd774225a3972f4669143063398f7a5f27464dbb148b1116e435ddb64d914cf599a2d25695343a28ceb8128b1caae3694379cc1e8f986a3c33372744126496360f9e0451177babcb52b4e9c4c8ae23f05f8095e1a0102eb27ae4a2fb716282f2f0d64770c43b2b838a7ee8f0d2cd0b9976c0611347ab6d2cf2adb254a5e7e24f9252004da2cee4538db1f4dad2ebb672470d5fc2857a4f0a39f20817db26c2f1c1f242a73240e91c39cbf2ea3f9b51f5a491e4839df3f3c4f8c0e751f91de9c79ed20918f600cfe2315153ba8ab9ad9003bcaaf67d6c0af1a122b36b0de4b16077afde0913d2ad049ed548dd1d5e42ef43b0944062358bd0a3e09551c2c521399a0b2f038a0f4c9ad4d3d14e31eb4a71069b9c15fcf2917864ec6b65d1859f7e74be9c289f272c2be828aee5e89c1c27389becfa9539b0ed2a081c3a1eaddff7243620c5d2941b7f467f76552f67d577d4e15ba66cd142820c9ae0f34f0d9b4a26c06d3291287e8b812bca99dbe4ca64bb07f27fb16cb995031f17c89977bcc2b9fbeb1c41275a92e98fb2d19a41b91d6e4370f0283d850ffccaf643b910f6728212dffc8feac8a143a57b6c094db2958e6e546f9f4ba56cb9a25bff8f6398b82e02fd9"},
    {2, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 16, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0861eb7146208783d2d17ca0ffb6091d7dc11bf0812e0289a98e3d079136aacf9f6f275f573fa21b0612dbd774225a3972f4669143063398f7a5f27464dbb148b1116e435ddb64d914cf599a2d25695343a28ceb8128b1caae3694379cc1e8f986a3c33372744126496360f9e0451177babcb52b4e9c4c8ae23f05f8095e1a0102eb27ae4a2fb716282f2f0d64770c43b2b838a7ee8f0d2cd0b9976c0611347ab6d2cf2adb254a5e7e24f9252004da2cee4538db1f4dad2ebb672470d5fc2857a4f0a39f20817db26c2f1c1f242a73240e91c39cbf2ea3f9b51f5a491e4839df3f3c4f8c0e751f91de9c79ed20918f600cfe2315153ba8ab9ad9003bcaaf67d6c0af1a122b36b0de4b16077afde0913d2ad049ed548dd1d5e42ef43b0944062358bd0a3e09551c2c521399a0b2f038a0f4c9ad4d3d14e31eb4a71069b9c15fcf2917864ec6b65d1859f7e74be9c289f272c2be828aee5e89c1c27389becfa9539b0ed2a081c3a1eaddff7243620c5d2941b7f467f76552f67d577d4e15ba66cd142820c9ae0f34f0d9b4a26c06d3291287e8b812bca99dbe4ca64bb07f27fb16cb995031f17c89977bcc2b9fbeb1c41275a92e98fb2d19a41b91d6e4370f0283d850ffccaf643b910f6728212dffc8feac8a143a57b6c094db2958e6e546f9bceff1309f15d500f12a554cc21c313c"},
    {2, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa92000202175385ef8adeac2c87335eb928dd4", 16, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0861eb7146208783d2d17ca0ffb6091d7dc11bf0812e0289a98e3d079136aacf9f6f275f573fa21b0612dbd774225a3972f4669143063398f7a5f27464dbb148b1116e435ddb64d914cf599a2d25695343a28ceb8128b1caae3694379cc1e8f986a3c33372744126496360f9e0451177babcb52b4e9c4c8ae23f05f8095e1a0102eb27ae4a2fb716282f2f0d64770c43b2b838a7ee8f0d2cd0b9976c0611347ab6d2cf2adb254a5e7e24f9252004da2cee4538db1f4dad2ebb672470d5fc2857a4f0a39f20817db26c2f1c1f242a73240e91c39cbf2ea3f9b51f5a491e4839df3f3c4f8c0e751f91de9c79ed20918f600cfe2315153ba8ab9ad9003bcaaf67d6c0af1a122b36b0de4b16077afde0913d2ad049ed548dd1d5e42ef43b0944062358bd0a3e09551c2c521399a0b2f038a0f4c9ad4d3d14e31eb4a71069b9c15fcf2917864ec6b65d1859f7e74be9c289f272c2be828aee5e89c1c27389becfa9539b0ed2a081c3a1eaddff7243620c5d2941b7f467f76552f67d577d4e15ba66cd142820c9ae0f34f0d9b4a26c06d3291287e8b812bca99dbe4ca64bb07f27fb16cb995031f17c89977bcc2b9fbeb1c41275a92e98fb2d19a41b91d6e4370f0283d850ffccaf643b910f6728212dffc8feac8a143a57b6c094db2958e6e546f9f4ba56cb9a25bff8f6398b82e02fd9ee"},
    {4, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa920", 8, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "4680d176c2fa66ef4376bc013ca5435ebd27b260c1236ae0148eb84eb24869ec1f1ebba2ba5356a2ee36944e717f668ab180c94817058216930d0192f403652bd2b0f3adac6466a74a69a8676d8460e2d81811de0cf8c0ec0c1aea48d470d0b6818fffb30dcdba67ffcf4bcf62e241e853c04370014cbea9cd68de4b90f8e52b5d40e972df70104fb70a78ddff9e7eb6e0c528c52aca9738030a6ad253d042697de254a059d06606ce718e8c95afd35767d05640b11367c5de4be405dd0c0bbbff54c8adfdae259b6588a44af382b3c5a2dec4c91bc8c3c156ae4859bd95e1a12f13fd292e0e80de25267941b8c5974e53dcff3741211d9c9e312919283f625201b201bb208f341b792d50c26b3c5769107e28c694ee55396a92b8ef18f6aa5849e44f63da4ab7d6d27d0b7c0869be21c650049dba5c3691de3fdc0dc9cd9676857d35d924372487e87c5ce4d656f69ee0cd62edbd949db134f9850eb6f017d5ba1933e8a39e56822fbe6a35eb9590e28bd1bbd46217c2db14264518caad1929885c143d28f4274fb4a655de0e24b2f37f1351c4820cb5c4fe49e9433f28bc1a0ac63a52200ac0876471c4db9a7ef1852b679f8a1d9bd54e739ce642bdfca700ed162516a33798733b52b726376e10f840714109150c7afeb71c652970ea86cd1d3fa016ffebf8"},
    {4, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa920", 8, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "4680d176c2fa66ef4376bc013ca5435ebd27b260c1236ae0148eb84eb24869ec1f1ebba2ba5356a2ee36944e717f668ab180c94817058216930d0192f403652bd2b0f3adac6466a74a69a8676d8460e2d81811de0cf8c0ec0c1aea48d470d0b6818fffb30dcdba67ffcf4bcf62e241e853c04370014cbea9cd68de4b90f8e52b5d40e972df70104fb70a78ddff9e7eb6e0c528c52aca9738030a6ad253d042697de254a059d06606ce718e8c95afd35767d05640b11367c5de4be405dd0c0bbbff54c8adfdae259b6588a44af382b3c5a2dec4c91bc8c3c156ae4859bd95e1a12f13fd292e0e80de25267941b8c5974e53dcff3741211d9c9e312919283f625201b201bb208f341b792d50c26b3c5769107e28c694ee55396a92b8ef18f6aa5849e44f63da4ab7d6d27d0b7c0869be21c650049dba5c3691de3fdc0dc9cd9676857d35d924372487e87c5ce4d656f69ee0cd62edbd949db134f9850eb6f017d5ba1933e8a39e56822fbe6a35eb9590e28bd1bbd46217c2db14264518caad1929885c143d28f4274fb4a655de0e24b2f37f1351c4820cb5c4fe49e9433f28bc1a0ac63a52200ac0876471c4db9a7ef1852b679f8a1d9bd54e739ce642bdfca700ed162516a33798733b52b726376e10f840714109150c7afeb71c652970ea8685917be096f12614"},
    {4, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa920", 12, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "165e7cb1789fc9cb1e9b81e48d2c30d22a019bce5ff79d45ea7adbcf585b7bfc015a5959c9c1478714f4621ee0675f785a1689f1a9254b76580d368cc4a02b18b3f2a8abb5173e2b9f27042af4c0daeae44d88679e7bb79cab48a8f100804c0dad11547c68f2ac0e9a74f1abdeaa7c95e12b97361c4217905f25a03d9a5f8982af979b7756768cd9b044cc928d25ccd56e4fc494e4f62d96aabf3a4bd4889478990e58dcc180c4a81aceaf93afbbcf866a47030d579a981e42d78fae1907df32fd6c8cb37e1bd12e9ac7e81636e411e1717dac7836cf35b2683dd055fd0032a37d048835ef977b381d282ebb4c743eb09126d37764bd177af48d40f0c50534484dfd23ca9d046be673f493a83f705bd3a7d6579814690ee936095f1d80175271f33832ce9d93fff24d4c4ac3fbfa5e12b57109a56fdd5fa302391fe561095dafa4e41ce8e6dc5aac6091aefd7ca3b694ff6301ffdbe02c0c2ce438101ee92a08f85f3b153aa3116a80bc7778040ed9ee8b408909fc6d86004f23798ae85d9b1957435c9f74becdc53b38a7f0b9ac3d515e17d0ca9f5874096db5fb234d0d45e8149f6d15e2d7d3138622fa6fa7eded639fb6929fcaacf03060ec9db0106e58a3fa45d9ab2f6a2b56eee39cfc8cb305901c8f612e24da4cd3b07d4cf966cdf180b55f5111770c4fd51ae2a1"},
    {4, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa920", 12, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "165e7cb1789fc9cb1e9b81e48d2c30d22a019bce5ff79d45ea7adbcf585b7bfc015a5959c9c1478714f4621ee0675f785a1689f1a9254b76580d368cc4a02b18b3f2a8abb5173e2b9f27042af4c0daeae44d88679e7bb79cab48a8f100804c0dad11547c68f2ac0e9a74f1abdeaa7c95e12b97361c4217905f25a03d9a5f8982af979b7756768cd9b044cc928d25ccd56e4fc494e4f62d96aabf3a4bd4889478990e58dcc180c4a81aceaf93afbbcf866a47030d579a981e42d78fae1907df32fd6c8cb37e1bd12e9ac7e81636e411e1717dac7836cf35b2683dd055fd0032a37d048835ef977b381d282ebb4c743eb09126d37764bd177af48d40f0c50534484dfd23ca9d046be673f493a83f705bd3a7d6579814690ee936095f1d80175271f33832ce9d93fff24d4c4ac3fbfa5e12b57109a56fdd5fa302391fe561095dafa4e41ce8e6dc5aac6091aefd7ca3b694ff6301ffdbe02c0c2ce438101ee92a08f85f3b153aa3116a80bc7778040ed9ee8b408909fc6d86004f23798ae85d9b1957435c9f74becdc53b38a7f0b9ac3d515e17d0ca9f5874096db5fb234d0d45e8149f6d15e2d7d3138622fa6fa7eded639fb6929fcaacf03060ec9db0106e58a3fa45d9ab2f6a2b56eee39cfc8cb305901c8f612e24da4cd3b07d4cf966cdf1c8391b119179c1a3c534f03b"},
    {4, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa920", 16, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0e33334c6fd3cf8c371d06875f342d239832a94c43b2f721d8bd70b6d62e7ac34bfd2041b214cd77624e0330e0892abfd696577144205882a24a1f4f0234602503222558c8c0e7dd033c3888d7f747107d3b11ad3f4d2c6088a80413d12a83587503a7393022ec541b284b358fa1fe3236ae706cd49fb8e2d4216318e8659275d80616940d2f3762e672a19ece3f2ee918c4e99b173c544dfb3300a867564790a436967563fa2bd3240dbb4d370d9153110411d772ff7542651db8c38672cc0f0ceae4f24065dfc996dd8b8d915f1bce206878ac54fad4df8a8157af6f1a8dc0344f526cd6cc398e1f049af3af9334204c5025a653292c0db11985ab83acf1bce2879754c0684a40d7e64e1f062a5d586a7c8702f326119dec9b1d0d316f8ba93f63d07546ee796db70fa66738499126c3a4bdada811dfc698b96569fbfcb935059c9b80349ce2b5caf6def0f2f6ba0d8ebf3395bb1766cddbc93a946d9706342bc378cda55eaee8edb411314c73bb2c480dea05e2eab5f83d089624bc9884dd14ba714d62e15767f730782e37c519b608d8d4ccee98e6d4ba28171417753f72a3b476403ccd5f0bbc4d7021170c751f8d844ee58ce6d2558270333d26e14e184d07e46a22d9270258517c7d6fa55875642d07a74ae0056c41e2931ef08d3fcdee14358fba08d170fe5906ab34a56f"},
    {4, "dec0d4fcbf3c4741c892dabd1cd4c04e", "3a92732aa6ea39bf3986e0c73fa920", 16, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "0e33334c6fd3cf8c371d06875f342d239832a94c43b2f721d8bd70b6d62e7ac34bfd2041b214cd77624e0330e0892abfd696577144205882a24a1f4f0234602503222558c8c0e7dd033c3888d7f747107d3b11ad3f4d2c6088a80413d12a83587503a7393022ec541b284b358fa1fe3236ae706cd49fb8e2d4216318e8659275d80616940d2f3762e672a19ece3f2ee918c4e99b173c544dfb3300a867564790a436967563fa2bd3240dbb4d370d9153110411d772ff7542651db8c38672cc0f0ceae4f24065dfc996dd8b8d915f1bce206878ac54fad4df8a8157af6f1a8dc0344f526cd6cc398e1f049af3af9334204c5025a653292c0db11985ab83acf1bce2879754c0684a40d7e64e1f062a5d586a7c8702f326119dec9b1d0d316f8ba93f63d07546ee796db70fa66738499126c3a4bdada811dfc698b96569fbfcb935059c9b80349ce2b5caf6def0f2f6ba0d8ebf3395bb1766cddbc93a946d9706342bc378cda55eaee8edb411314c73bb2c480dea05e2eab5f83d089624bc9884dd14ba714d62e15767f730782e37c519b608d8d4ccee98e6d4ba28171417753f72a3b476403ccd5f0bbc4d7021170c751f8d844ee58ce6d2558270333d26e14e184d07e46a22d9270258517c7d6fa55875642d07a74ae0056c41e2931ef08d3f856250750fb4c53d60d04b9cb18534ba"},
    {4, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa920", 8, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "188ee89ebee501f6a1dd111aa09b00eb67e1b2c6e1f205737d7f47e2cca0b80c9408daccfe820ebeab75f290589dc2175039d60c891002dea5214237393a5672bf91403d69fe41122b666fdd4b796ca18eb84a219895a58ca91689758dfc578079f89f27016a3b3080d0d8177a5ed8fc4b6e0af40604eaf4d91125aeac6656277a429c120bd9a2fa73086eb93302e3cc4d31dd2433d2f07cfbf604e60e380b7f94fb9de182f9752664c57dcb5c9797a952cc8a27b88a582342747c84bdcaae7ddfce460ab681856432429c6cc6e3658929f5669d5088a123a9158b680a8601960b068ea5a7b8f9bac98c3b7399c8fb8067ecbf6313606afdc3d1528d048b6803e12bdb44b119a2107463d01db4bc2791df8f3d0761ce5b401f8e0383f279fe7b1af335b10b48bef05d0e91bdab9631fa79a67a03a4790b4b1d325be028f6beda26d68958811670c86050d05b745f399ac77ff97be3b91cff64fd15e5047b1698c2dffe6d3d7c6cb0c8b5956cee43e8ecf7bc22199bfd7d61178843f9554bc0db539e7a59001ba3c963f299a1d838b8629bddc7c5646145a86ce52077af7785d213c787640b2010424b73b7b786ac7ca946fff501fecd6793ac00e9fb10ce7fb3a6d7b277b7096c83c94a421747f63c43723dd098b144549edbaeda4536ded1dd2a37097d430860"},
    {4, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa920", 8, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "188ee89ebee501f6a1dd111aa09b00eb67e1b2c6e1f205737d7f47e2cca0b80c9408daccfe820ebeab75f290589dc2175039d60c891002dea5214237393a5672bf91403d69fe41122b666fdd4b796ca18eb84a219895a58ca91689758dfc578079f89f27016a3b3080d0d8177a5ed8fc4b6e0af40604eaf4d91125aeac6656277a429c120bd9a2fa73086eb93302e3cc4d31dd2433d2f07cfbf604e60e380b7f94fb9de182f9752664c57dcb5c9797a952cc8a27b88a582342747c84bdcaae7ddfce460ab681856432429c6cc6e3658929f5669d5088a123a9158b680a8601960b068ea5a7b8f9bac98c3b7399c8fb8067ecbf6313606afdc3d1528d048b6803e12bdb44b119a2107463d01db4bc2791df8f3d0761ce5b401f8e0383f279fe7b1af335b10b48bef05d0e91bdab9631fa79a67a03a4790b4b1d325be028f6beda26d68958811670c86050d05b745f399ac77ff97be3b91cff64fd15e5047b1698c2dffe6d3d7c6cb0c8b5956cee43e8ecf7bc22199bfd7d61178843f9554bc0db539e7a59001ba3c963f299a1d838b8629bddc7c5646145a86ce52077af7785d213c787640b2010424b73b7b786ac7ca946fff501fecd6793ac00e9fb10ce7fb3a6d7b277b7096c83c94a421747f63c43723dd098b144549edbaeda4536ded14aefbda08fd14436"},
    {4, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa920", 12, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "18da5c8e77a1fa3cbe6c510c594b905f027ba3b56e446f23bbc17d12f265f260799ec5531792b8ec5cfec2b660bef94760ff5e7a714947cb342a7e9a1e0f3085e7c1608ea9dd1c71507cf09a7683e855b664615702cb556553319b5bd0fcb600d5c3a3bb8c36d8014f30b85a2d26ac36e83cfe8cebb6f7118c3e5875597fa39efd269f5ea237edd60036a906ea592fbe2868455503e9b1928396a894fefe2321138e8f5df4fcc932f4f05f3c15cd16cd5da9d54399dd0a90448f12c54a288b1724b60dfb7a434e72e357ddb631c1038efe9331a5037eb98e61f2a69df51d17de14799df035b5e468782d95d58d0cfd68d69c1b1529b4ad191bbf6f4c10f8a85e2c4ac7c525b3ef258de9a2f9b6193d74ca6e0180333167de426039cf8490d15e7f8ea86bfd143f98f2bb8e5c32a17e19aa0370cc7cbad8cfaeb69be29b6a6a7c27354a9a0dae13258578c681d182855c917c300e96912d24a80db1824e719fd5bddafd839f67fe18f632a892e69e46e0bef56aa94ff26ab7943a4b7de052f5d24302feb3add1c481b019d0d97bd442bd7c0021721d13b9e471686409c7c69551b3977ed3505eff8213e5564d1afe6042dc1ea572aca30cd1b7540e954b2e6c0498ebd2526fb0fb5ffcf48c6ef23b385e99649fd49290e0ce4de6d0a57498b706a22a5a7776797981c5ee6d"},
    {4, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa920", 12, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "18da5c8e77a1fa3cbe6c510c594b905f027ba3b56e446f23bbc17d12f265f260799ec5531792b8ec5cfec2b660bef94760ff5e7a714947cb342a7e9a1e0f3085e7c1608ea9dd1c71507cf09a7683e855b664615702cb556553319b5bd0fcb600d5c3a3bb8c36d8014f30b85a2d26ac36e83cfe8cebb6f7118c3e5875597fa39efd269f5ea237edd60036a906ea592fbe2868455503e9b1928396a894fefe2321138e8f5df4fcc932f4f05f3c15cd16cd5da9d54399dd0a90448f12c54a288b1724b60dfb7a434e72e357ddb631c1038efe9331a5037eb98e61f2a69df51d17de14799df035b5e468782d95d58d0cfd68d69c1b1529b4ad191bbf6f4c10f8a85e2c4ac7c525b3ef258de9a2f9b6193d74ca6e0180333167de426039cf8490d15e7f8ea86bfd143f98f2bb8e5c32a17e19aa0370cc7cbad8cfaeb69be29b6a6a7c27354a9a0dae13258578c681d182855c917c300e96912d24a80db1824e719fd5bddafd839f67fe18f632a892e69e46e0bef56aa94ff26ab7943a4b7de052f5d24302feb3add1c481b019d0d97bd442bd7c0021721d13b9e471686409c7c69551b3977ed3505eff8213e5564d1afe6042dc1ea572aca30cd1b7540e954b2e6c0498ebd2526fb0fb5ffcf48c6ef23b385e99649fd49290e0ce4de6d0a57498b79167a0f385e4352f4c97aa94"},
    {4, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa920", 16, "5468657265206172652037206675727468657220656469746f7269616c206e6f74657320696e2074686520646f63756d656e742e", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "4604fafe03ab3897dd54e41c5884cac385d575768a2eb1c4c21c8470636a62565309605c8a556c4f3837be13df6f02de9b5a1ebbedba07e34a1fe0cd037eefc5c324ddfd95a9d16eaebecafd5b93d3c8d9a2deadb079497437d120c1fb0ae4b4d60b9fe220486c54f49c23c00fc3ffb1d57022761315c51f609fb28d70e4de2479325851af9c71671b6507c81fdecc5e5b8335b9d78320b0a4dfdff2f4a0dc86401128fdbe5601491acc6b0876d72fa842e95b75626dde15e602593b82874ed9233ddc64b06c41ea25dcccd678eb720d10d1c85f17635aceef2f102706f6de89b6d0fe6dcd686677d0a682fa3bf781a1fdb13c506be5b1c46ead578c54161129dbe0763d897fde4bfaf87ba61c5cf6884bd1e75678c086aeb2fcf057faf14ec38492ecba850595fa5b84d66c07576486da9cff68dbd961872985b1094d23f9dc31dda35cbe68ee570323843374cb89e07d2f11adf3476e6bdc2b2525cffdffcb7ee58190b19d8601b73d175bd8ebda079c97ed36e77c09a7c1c5e48f57c1881b91e2b17b6a737c79a1528c90ffbc1504914677593b9f6eca64fad08cdd4d318cd7f163cdf325667e949d829bebcccd932481ef132b49ac156eef34947924c165ce64b9e1e1461bd8d3d1e4e928411b448faa5d7db7f8bddc4fdce1ea035d60a36db50a9235d475609287268818792c"},
    {4, "67693823fb1d58073f91ece9cc3af910e5532616a4d27b13eb7b74d8000bbf30", "3a92732aa6ea39bf3986e0c73fa920", 16, "", "546869732073706563696669636174696f6e206465736372696265732061204a6176615363726970742041504920666f7220706572666f726d696e672062617369632063727970746f67726170686963206f7065726174696f6e7320696e20776562206170706c69636174696f6e732c20737563682061732068617368696e672c207369676e61747572652067656e65726174696f6e20616e6420766572696669636174696f6e2c20616e6420656e6372797074696f6e20616e642064656372797074696f6e2e204164646974696f6e616c6c792c2069742064657363726962657320616e2041504920666f72206170706c69636174696f6e7320746f2067656e657261746520616e642f6f72206d616e61676520746865206b6579696e67206d6174657269616c206e656365737361727920746f20706572666f726d207468657365206f7065726174696f6e732e205573657320666f722074686973204150492072616e67652066726f6d2075736572206f7220736572766963652061757468656e7469636174696f6e2c20646f63756d656e74206f7220636f6465207369676e696e672c20616e642074686520636f6e666964656e7469616c69747920616e6420696e74656772697479206f6620636f6d6d756e69636174696f6e732e", "4604fafe03ab3897dd54e41c5884cac385d575768a2eb1c4c21c8470636a62565309605c8a556c4f3837be13df6f02de9b5a1ebbedba07e34a1fe0cd037eefc5c324ddfd95a9d16eaebecafd5b93d3c8d9a2deadb079497437d120c1fb0ae4b4d60b9fe220486c54f49c23c00fc3ffb1d57022761315c51f609fb28d70e4de2479325851af9c71671b6507c81fdecc5e5b8335b9d78320b0a4dfdff2f4a0dc86401128fdbe5601491acc6b0876d72fa842e95b75626dde15e602593b82874ed9233ddc64b06c41ea25dcccd678eb720d10d1c85f17635aceef2f102706f6de89b6d0fe6dcd686677d0a682fa3bf781a1fdb13c506be5b1c46ead578c54161129dbe0763d897fde4bfaf87ba61c5cf6884bd1e75678c086aeb2fcf057faf14ec38492ecba850595fa5b84d66c07576486da9cff68dbd961872985b1094d23f9dc31dda35cbe68ee570323843374cb89e07d2f11adf3476e6bdc2b2525cffdffcb7ee58190b19d8601b73d175bd8ebda079c97ed36e77c09a7c1c5e48f57c1881b91e2b17b6a737c79a1528c90ffbc1504914677593b9f6eca64fad08cdd4d318cd7f163cdf325667e949d829bebcccd932481ef132b49ac156eef34947924c165ce64b9e1e1461bd8d3d1e4e928411b448faa5d7db7f8bddc4fdce1ea035d6034a83fa360a79823adc0c3dfc8e64d20"},
};

static void aes_ciphers(void) {
    bool all = true;
    for (size_t i = 0; i < sizeof(aes_vectors) / sizeof(*aes_vectors); i++) {
        NtsView *key = hex(aes_vectors[i].key);
        NtsView *iv = hex(aes_vectors[i].iv);
        NtsView *aad = hex(aes_vectors[i].aad);
        bool config = nts_crypto_aes_config(aes_vectors[i].mode, nts_view_byte_length(key), nts_view_byte_length(iv),
                                            aes_vectors[i].length) == 0;
        nts_crypto_aes_job(aes_vectors[i].mode, true, key, hex(aes_vectors[i].plaintext), iv, aes_vectors[i].length, aad,
                           &job_callback);
        uv_run(uv_default_loop(), UV_RUN_DEFAULT);
        bool encrypted = job_ok && strcmp(job_hex, aes_vectors[i].ciphertext) == 0;
        nts_crypto_aes_job(aes_vectors[i].mode, false, key, hex(aes_vectors[i].ciphertext), iv, aes_vectors[i].length, aad,
                           &job_callback);
        uv_run(uv_default_loop(), UV_RUN_DEFAULT);
        bool decrypted = job_ok && strcmp(job_hex, aes_vectors[i].plaintext) == 0;
        if (!(config && encrypted && decrypted)) printf("     vector %zu: config %d encrypt %d decrypt %d\n", i, config, encrypted, decrypted);
        all = all && config && encrypted && decrypted;
    }
    expect_true("node's 44 AES fixtures encrypt and decrypt, CBC, CTR, GCM and OCB", all);
    /* The counter's own bits wrap within the block, where OpenSSL's would
     * carry: an 8-bit counter from 0xfe runs fe, ff, then 00. Node's answer. */
    NtsView *ctr_key = hex("000102030405060708090a0b0c0d0e0f");
    NtsView *ctr_counter = hex("00112233445566778899aabbccddeefe");
    unsigned char plaintext[40];
    memset(plaintext, 0x61, sizeof(plaintext));
    nts_crypto_aes_job(1, true, ctr_key, bytes(plaintext, sizeof(plaintext)), ctr_counter, 8, bytes("", 0), &job_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("a CTR counter that wraps within its bits, as node's",
                job_ok && strcmp(job_hex, "a24cfd795f3a724f5f229c156bc0486e08a581b90b1a6551b9acd6e111d5a43b1df8954a0f846251") == 0);
    nts_crypto_aes_job(1, true, ctr_key, bytes(plaintext, sizeof(plaintext)), ctr_counter, 1, bytes("", 0), &job_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("  and input needing more blocks than the counter has fails, with nothing queued",
                !job_ok && nts_crypto_take_errors()->header.length == 3);
    /* Web Crypto's RSA-OAEP job: SHA-256 for both the label hash and MGF1,
     * checked by the synchronous path node:crypto uses, which sets the same. */
    NtsView *none = bytes("", 0);
    double rsa_private = nts_crypto_key_parse_private(1, -1, file(KEYS "rsa_private.pem"), none, false);
    double rsa_public = nts_crypto_key_parse_public(1, -1, file(KEYS "rsa_public.pem"), none, false);
    double sha256 = nts_crypto_digest_id(text("sha256"));
    nts_crypto_rsa_oaep_job(true, rsa_public, sha256, utf8("label"), utf8("attack at dawn"), &job_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    NtsView *ciphertext = hex(job_hex);
    NtsView *plain = nts_crypto_public_key_cipher(1, rsa_private, ciphertext, 4, sha256, utf8("label"));
    expect_true("an RSA-OAEP job encrypts what OAEP-SHA-256 decrypts",
                job_ok && plain != NULL && nts_view_byte_length(plain) == 14 &&
                    memcmp(nts_view_bytes(plain), "attack at dawn", 14) == 0);
    nts_crypto_rsa_oaep_job(false, rsa_private, sha256, utf8("label"), ciphertext, &job_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("  and decrypts it", job_ok && strcmp(job_hex, "61747461636b206174206461776e") == 0);
    nts_crypto_rsa_oaep_job(false, rsa_private, sha256, utf8("other"), ciphertext, &job_callback);
    uv_run(uv_default_loop(), UV_RUN_DEFAULT);
    expect_true("  but not under another label", !job_ok);
    nts_crypto_take_errors();

    /* Node's `CheckEcKeyData`. test-webcrypto-export-import-ec's P-521 key
     * whose scalar is the curve's order + 11 is one this OpenSSL refuses
     * already as it parses -- node's parses it and fails this check -- and
     * either way Web Crypto answers node's DataError, "Invalid keyData". */
    double good_ec = nts_crypto_keygen_run(nts_crypto_keygen_ec(text("P-256"), false));
    expect_true("an EC key's check passes a generated key, private and public",
                good_ec > 0 && nts_crypto_key_check(good_ec, true) && nts_crypto_key_check(good_ec, false) &&
                    nts_crypto_take_errors()->header.length == 3);
    double bad_ec = nts_crypto_key_parse_private(
        0, 1,
        hex("3060020100301006072a8648ce3d020106052b81040023044930470201010442"
            "01fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"
            "fa51868783bf2f966b7fcc0148f709a5d03bb5c9b8899c47aebb6fb71e9138"
            "6414"),
        none, false);
    expect_true("  a P-521 scalar past the order is no key at all here", bad_ec <= 0);
    nts_crypto_take_errors();

    expect_true("AES's configuration refusals: a short GCM IV, a CTR length of 0, a 16-byte OCB IV, a 20-byte key",
                nts_crypto_aes_config(2, 16, 8, 16) == -2 && nts_crypto_aes_config(1, 16, 16, 0) == -3 &&
                    nts_crypto_aes_config(4, 16, 16, 16) == -2 && nts_crypto_aes_config(0, 20, 16, 0) == -1 &&
                    nts_crypto_aes_config(3, 32, 0, 0) == 0);
}


int main(void) {
    digests();
    derivations();
    ciphers();
    keys();
    signatures();
    rsa_encryption();
    key_generation();
    key_agreement();
    primes();
    argon2();
    key_encapsulation();
    spkac();
    certificates();
    aes_ciphers();
    printf("%d failure(s)\n", failures);
    return failures == 0 ? 0 : 1;
}
