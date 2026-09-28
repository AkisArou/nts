/* `crypto.c`, `cipher.c` and `keys.c`, called directly.
 *
 * The TypeScript over these natives runs on node against node's own crypto,
 * so nothing but this runs the C: the compiled lane refuses every public
 * crypto function today, for compiler reasons recorded with the module. Each
 * check is a published known answer -- FIPS 180 and 202 digests, RFC 4231
 * HMAC, RFC 6070 PBKDF2, RFC 5869 HKDF, RFC 7914 scrypt, SP 800-38A AES --
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

    expect_true("garbage is not a key", nts_crypto_key_parse_private(1, -1, utf8("garbage"), none, false) == 0);
    expect_true("  and OpenSSL says so", errors_mention("DECODER routines::unsupported"));
}

int main(void) {
    digests();
    derivations();
    ciphers();
    keys();
    printf("%d failure(s)\n", failures);
    return failures == 0 ? 0 : 1;
}
