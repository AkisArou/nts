/* `node:crypto`'s `Certificate`: SPKAC, the Netscape signed public key and
 * challenge a `<keygen>` element once produced -- node's `SPKAC` functions
 * (`src/crypto/crypto_spkac.cc`) over ncrypto's `VerifySpkac`,
 * `ExportPublicKey` and `ExportChallenge`, and OpenSSL's `NETSCAPE_SPKI`.
 *
 * Each leaves OpenSSL's queue as it found it, as ncrypto's do: a malformed
 * SPKAC is an answer (false, or nothing), not an error. */
#include <openssl/asn1.h>
#include <openssl/bio.h>
#include <openssl/err.h>
#include <openssl/evp.h>
#include <openssl/pem.h>
#include <openssl/x509.h>
#include <stdlib.h>
#include <string.h>
#include "crypto_internal.h"
#include "nts_crypto.h"
#include "shared.h"

/* The SPKAC decoded. OpenSSL's base64 decoding drops trailing whitespace
 * itself; ncrypto trims it only for BoringSSL, whose decoder does not. */
static NETSCAPE_SPKI *spkac_of(NtsView *input) {
    return NETSCAPE_SPKI_b64_decode((const char *)nts_view_bytes(input), (int)nts_view_byte_length(input));
}

/* `certVerifySpkac`: the signature checks against the key it carries. */
bool nts_crypto_spkac_verify(NtsView *input) {
    ERR_set_mark();
    NETSCAPE_SPKI *spki = spkac_of(input);
    EVP_PKEY *pkey = spki == NULL ? NULL : NETSCAPE_SPKI_get_pubkey(spki);
    bool ok = pkey != NULL && NETSCAPE_SPKI_verify(spki, pkey) > 0;
    EVP_PKEY_free(pkey);
    NETSCAPE_SPKI_free(spki);
    ERR_pop_to_mark();
    return ok;
}

/* `certExportPublicKey`: the key, as SPKI PEM; NULL for no SPKAC. */
NtsView *nts_crypto_spkac_public_key(NtsView *input) {
    ERR_set_mark();
    NETSCAPE_SPKI *spki = spkac_of(input);
    EVP_PKEY *pkey = spki == NULL ? NULL : NETSCAPE_SPKI_get_pubkey(spki);
    BIO *bio = pkey == NULL ? NULL : BIO_new(BIO_s_mem());
    NtsView *result = NULL;
    if (bio != NULL && PEM_write_bio_PUBKEY(bio, pkey) > 0) {
        char *data = NULL;
        long length = BIO_get_mem_data(bio, &data);
        result = nts_view_from_bytes(data, (double)length);
    }
    BIO_free(bio);
    EVP_PKEY_free(pkey);
    NETSCAPE_SPKI_free(spki);
    ERR_pop_to_mark();
    return result;
}

/* `certExportChallenge`: the challenge string, as UTF-8; NULL for none. */
NtsView *nts_crypto_spkac_challenge(NtsView *input) {
    ERR_set_mark();
    NETSCAPE_SPKI *spki = spkac_of(input);
    unsigned char *text = NULL;
    int length = spki == NULL ? -1 : ASN1_STRING_to_UTF8(&text, spki->spkac->challenge);
    NtsView *result = length >= 0 && text != NULL ? nts_view_from_bytes(text, (double)length) : NULL;
    OPENSSL_free(text);
    NETSCAPE_SPKI_free(spki);
    ERR_pop_to_mark();
    return result;
}
