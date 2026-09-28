/* `crypto.c`, `cipher.c`, `keys.c`, `sig.c`, `rsa.c`, `keygen.c`, `dh.c`, `prime.c`, `argon2.c`, `kem.c` and
 * `spkac.c`, called directly.
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
static char job_hex[256];

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
    printf("%d failure(s)\n", failures);
    return failures == 0 ? 0 : 1;
}
