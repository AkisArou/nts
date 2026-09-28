/* `node:crypto`'s primes: `generatePrime` and `checkPrime`, node's
 * `RandomPrimeJob` and `CheckPrimeJob` (`src/crypto/crypto_random.cc`) over
 * ncrypto's `BignumPointer::generate` and `isPrime`.
 *
 * `checkPrime` takes a `checks` option, and with OpenSSL 3 node ignores it:
 * ncrypto's provider build calls `BN_check_prime`, which chooses its own
 * number of rounds, and so does this. */
#include <openssl/bn.h>
#include <openssl/err.h>
#include <openssl/rand.h>
#include <stdlib.h>
#include <string.h>
#include "crypto_internal.h"
#include "nts_crypto.h"
#include "shared.h"

/* Mirrored as `PrimeOptions` in `src/random.ts`. */
enum { kPrimeOptionsOk = 0, kPrimeInvalidAdd = -1, kPrimeInvalidRem = -2 };

static BIGNUM *bignum_or_null(NtsView *view, bool given) {
    return given ? BN_bin2bn(nts_view_bytes(view), (int)nts_view_byte_length(view), NULL) : NULL;
}

/* `RandomPrimeTraits::AdditionalConfig`'s refusals, which would otherwise be
 * a static answer or an endless search inside OpenSSL. */
double nts_crypto_prime_options(double bits, NtsView *add, bool has_add, NtsView *rem, bool has_rem) {
    BIGNUM *a = bignum_or_null(add, has_add);
    BIGNUM *r = bignum_or_null(rem, has_rem);
    double status = kPrimeOptionsOk;
    if (a != NULL && BN_num_bits(a) > (int)bits) status = kPrimeInvalidAdd;
    else if (a != NULL && r != NULL && BN_cmp(a, r) <= 0) status = kPrimeInvalidRem;
    BN_free(a);
    BN_free(r);
    return status;
}

/* A generation's inputs and its prime. */
typedef struct {
    int bits;
    bool safe;
    BIGNUM *add;
    BIGNUM *rem;
    BIGNUM *prime;
} PrimeJob;

static void prime_job_dispose(void *state) {
    PrimeJob *job = state;
    BN_free(job->add);
    BN_free(job->rem);
    BN_clear_free(job->prime);
    free(job);
}

static PrimeJob *prime_job_new(double bits, bool safe, NtsView *add, bool has_add, NtsView *rem,
                               bool has_rem) {
    PrimeJob *job = calloc(1, sizeof(PrimeJob));
    if (job == NULL) return NULL;
    job->bits = (int)bits;
    job->safe = safe;
    job->add = bignum_or_null(add, has_add);
    job->rem = bignum_or_null(rem, has_rem);
    job->prime = BN_secure_new();
    if (job->prime == NULL || (has_add && job->add == NULL) || (has_rem && job->rem == NULL)) {
        prime_job_dispose(job);
        return NULL;
    }
    return job;
}

/* ncrypto's `BignumPointer::generate`, which makes sure the CSPRNG is seeded
 * first: `BN_generate_prime_ex` draws from it. */
static bool prime_job_run(void *state) {
    PrimeJob *job = state;
    (void)RAND_status();
    return BN_generate_prime_ex(job->prime, job->bits, job->safe, job->add, job->rem, NULL) != 0;
}

/* `RandomPrimeTraits::EncodeOutput`: the prime's own length in bytes. */
static NtsView *prime_bytes(const BIGNUM *prime) {
    int size = BN_num_bytes(prime);
    unsigned char *bytes = malloc(size == 0 ? 1 : (size_t)size);
    if (bytes == NULL) return NULL;
    BN_bn2bin(prime, bytes);
    NtsView *view = nts_view_from_bytes(bytes, (double)size);
    free(bytes);
    return view;
}

/* `generatePrimeSync`: the prime, or NULL with the cause on the error record. */
NtsView *nts_crypto_prime_generate(double bits, bool safe, NtsView *add, bool has_add, NtsView *rem,
                                   bool has_rem) {
    ERR_clear_error();
    PrimeJob *job = prime_job_new(bits, safe, add, has_add, rem, has_rem);
    NtsView *result = job != NULL && prime_job_run(job) ? prime_bytes(job->prime) : NULL;
    if (result == NULL) nts_crypto_record_failure();
    if (job != NULL) prime_job_dispose(job);
    return result;
}

static void prime_job_deliver(void *state, bool ok, NtsHeader *done) {
    PrimeJob *job = state;
    int size = ok ? BN_num_bytes(job->prime) : 0;
    unsigned char *bytes = malloc(size == 0 ? 1 : (size_t)size);
    if (ok && bytes != NULL) BN_bn2bin(job->prime, bytes);
    nts_crypto_deliver_bytes(done, ok && bytes != NULL, bytes, (size_t)size);
    free(bytes);
}

static const NtsCryptoWork prime_work = {prime_job_run, prime_job_deliver, prime_job_dispose};

/* `generatePrime`, delivered to `done(ok, bytes)`. */
void nts_crypto_prime_generate_job(double bits, bool safe, NtsView *add, bool has_add, NtsView *rem,
                                   bool has_rem, NtsHeader *done) {
    PrimeJob *job = prime_job_new(bits, safe, add, has_add, rem, has_rem);
    if (job != NULL) nts_crypto_queue_work(&prime_work, job, done);
}

/* A candidate and its answer. */
typedef struct {
    BIGNUM *candidate;
    unsigned char answer;
} CheckJob;

static void check_job_dispose(void *state) {
    CheckJob *job = state;
    BN_free(job->candidate);
    free(job);
}

/* `CheckPrimeTraits::DeriveBits` over ncrypto's `isPrime`: a negative answer
 * is a failure. */
static bool check_job_run(void *state) {
    CheckJob *job = state;
    BN_CTX *ctx = BN_CTX_new();
    int answer = ctx == NULL ? -1 : BN_check_prime(job->candidate, ctx, NULL);
    BN_CTX_free(ctx);
    job->answer = answer > 0;
    return answer >= 0;
}

static void check_job_deliver(void *state, bool ok, NtsHeader *done) {
    CheckJob *job = state;
    nts_crypto_deliver_bytes(done, ok, &job->answer, 1);
}

static const NtsCryptoWork check_work = {check_job_run, check_job_deliver, check_job_dispose};

/* `checks` is validated and carried as node carries it, and unused: see the
 * top of the file. */
static CheckJob *check_job_new(NtsView *candidate, double checks) {
    (void)checks;
    CheckJob *job = calloc(1, sizeof(CheckJob));
    if (job == NULL) return NULL;
    job->candidate = BN_bin2bn(nts_view_bytes(candidate), (int)nts_view_byte_length(candidate), NULL);
    if (job->candidate == NULL) {
        check_job_dispose(job);
        return NULL;
    }
    return job;
}

/* `CheckPrimeTraits::AdditionalConfig`: whether the candidate is a number
 * OpenSSL can hold at all -- a failure, with its reason on the error record, is
 * thrown before any job runs, as node throws it. */
bool nts_crypto_prime_candidate_ok(NtsView *candidate) {
    ERR_clear_error();
    BIGNUM *value = BN_bin2bn(nts_view_bytes(candidate), (int)nts_view_byte_length(candidate), NULL);
    if (value == NULL) nts_crypto_record_failure();
    BN_free(value);
    return value != NULL;
}

/* `checkPrimeSync`: 1 prime, 0 composite, -1 a failure on the error record. */
double nts_crypto_prime_check(NtsView *candidate, double checks) {
    ERR_clear_error();
    CheckJob *job = check_job_new(candidate, checks);
    double result = job != NULL && check_job_run(job) ? job->answer : -1;
    if (result < 0) nts_crypto_record_failure();
    if (job != NULL) check_job_dispose(job);
    return result;
}

/* `checkPrime`, delivered to `done(ok, bytes)` with a one-byte answer. */
void nts_crypto_prime_check_job(NtsView *candidate, double checks, NtsHeader *done) {
    CheckJob *job = check_job_new(candidate, checks);
    if (job != NULL) nts_crypto_queue_work(&check_work, job, done);
}
