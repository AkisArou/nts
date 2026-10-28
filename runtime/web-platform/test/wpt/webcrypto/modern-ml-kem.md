# ML-KEM and encapsulation

The [Modern Algorithms proposal](https://wicg.github.io/webcrypto-modern-algos/)
§§3.1.2, 3.2.1–5, 4 and 6 define this increment. It implements ML-KEM-512,
ML-KEM-768 and ML-KEM-1024, the four encapsulation/decapsulation methods, and
ML-KEM public-key extraction. The profile is the one implemented by
[Node 24.20](https://nodejs.org/download/release/v24.20.0/docs/api/crypto.html):
64-byte private seeds, raw public keys, AKP JWK, SPKI and seed-preserving PKCS8.
Hybrid KEMs remain outside this increment. The original WPT files, their hashes,
the directory revision and shared support files are unchanged.

This is the fifth Modern Algorithms increment, stacked on
`chatgpt/webcrypto-ml-dsa`, after SHA-3/cSHAKE/KMAC, AEAD and Argon2.

## Shared policy and native operations

The existing module-lattice key contract now includes the three ML-KEM parameter
sets. `CryptoKemParameters` selects the set; `CryptoEncapsulation` owns the complete
ciphertext and 32-byte shared secret. `CryptoProvider.encapsulate` and `decapsulate`
perform all FIPS 203 checks and cryptographic operations natively. Their failures
cross as values. Decapsulation includes native implicit rejection: a correctly
sized altered ciphertext produces its rejection secret, whereas a failed input
check produces `OperationError`. No ML-KEM arithmetic, hashing, seed expansion or
randomness is implemented in TypeScript.

Shared code implements Web IDL conversion and normalization, key kind and usage
checks, exact encoded widths and DER envelopes, absent OID parameters, JWK policy,
public/private slot installation and promise settlement. `getPublicKey` performs
one native public-handle derivation and permits only encapsulation usages for
ML-KEM. Private extractability does not restrict that public derivation.

The native seed export contract follows
[§6.4.6](https://wicg.github.io/webcrypto-modern-algos/#ml-kem-operations-export-key)
and [RFC 9935 §6](https://www.rfc-editor.org/rfc/rfc9935.html#section-6):
`raw-seed` returns the 32-byte `d` followed by the 32-byte `z`, and PKCS8 export
uses the seed-only `[0] IMPLICIT OCTET STRING` representation. A `both` import
checks the expanded private key against native seed expansion. Expanded-only
PKCS8 imports return `NotSupportedError` after exact DER validation. A separate
comment commit makes these requirements explicit for native implementers.

`encapsulateKey` and `decapsulateKey` import the complete shared secret through the
internal `raw-secret` importer. The method does not truncate it to a requested
length or call an overridable public method. For example, an AES import still
creates a 256-bit key when its input dictionary contains `length: 128`, because
AES import does not inspect that field. An explicit 128-bit HMAC import rejects
the 32-byte material according to HMAC's import policy. KDF imports retain their
nonextractability requirement. The ordinary result dictionaries expose their
ciphertext and shared key as independent values.

The test provider uses `node:crypto`'s public native key and KEM primitives. Node's
SPKI parser checks ML-KEM public coefficients while decoding a key. The proposal
places the encapsulation-key check at encapsulation, so imported public handles
retain owned encoded bytes until that native operation. Raw-public, SPKI and JWK
imports therefore preserve the required error timing without reproducing any
mathematical validation in TypeScript. Public exports copy their bytes; seed/both
PKCS8 validation uses native expansion and `timingSafeEqual`. Generated and derived
keys keep ordinary native handles.

## Per-file evidence

[modern-ml-kem-results.json](modern-ml-kem-results.json) records every per-file
outcome on the ordered five-family stack. It also retains all 125 historical
isolated outcomes and the exact raw affected-file failures.

The complete ordered census reports **35,391 pass / 0 fail / 1,057 blocked**,
with **36,448 registrations across 122 executed files**, three unchanged
file-level limitations and no harness failures. ML-KEM restores 1,611 passing
cases relative to the preceding ML-DSA stack, without changing registration
counts. The affected files have these final outcomes:

| File under WebCryptoAPI | Pass | Fail | Blocked |
| --- | ---: | ---: | ---: |
| encap_decap/encap_decap_bits.tentative.https.any.js | 9 | 0 | 0 |
| encap_decap/encap_decap_keys.tentative.https.any.js | 120 | 0 | 0 |
| generateKey/failures_ML-KEM.tentative.https.any.js | 1,044 | 0 | 0 |
| generateKey/successes_ML-KEM.tentative.https.any.js | 468 | 0 | 0 |
| import_export/ML-KEM_importKey.tentative.https.any.js | 324 | 0 | 0 |
| getPublicKey.tentative.https.any.js | 37 | 0 | 0 |
| serialization/mlkem.tentative.https.any.js | 0 | 0 | 6 |

This restores **1,611 named exclusions**. The six remaining serialization cases
reach `structuredClone`, which the adapter cannot supply for native `CryptoKey`
objects; the raw run records those six failures and the scoped gate classifies
them under the existing native-cloning limitation. No new specification
discrepancy is added. The accepted 302 entries and all inherited Modern Algorithms
transfer entries remain unchanged. `SubtleCrypto.supports` belongs to its
subsequent PR. TurboSHAKE, KangarooTwelve and hybrid KEMs remain outside scope.
The two browser IDL files and the existing asynchronous-registration limitation
in `derive_key_and_encrypt` remain the three files not run.

## Validation

```sh
pnpm install --offline --frozen-lockfile
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/crypto-ml-kem.test.ts
node --expose-gc runtime/web-platform/test/wpt/webcrypto/report.ts
sh tooling/conformance/web-platform/check.sh
```

All commands exit 0 under Node 24.20.0, pnpm 10.15.0 and the locked TypeScript
7.0.2. Install reports already up to date, with no new dependency or lockfile
change. Public and WPT typechecks have no diagnostics; strict standalone new-test
typechecking also passed during integration.

The authored ML-KEM file has **42 tests / 42 pass / 0 fail / 0 skip**. Controls
cover all three parameter sets, native interoperability, malformed and altered
ciphertext, raw/SPKI/JWK validation timing, PKCS8 `both` consistency, ownership,
observable conversion order, native failure values, non-overridable internal
calls and task settlement without timers. Ten ordered integration controls cover
AES-OCB, ChaCha20-Poly1305, KMAC128/256, HMAC with SHA3-512, all three Argon2
secret-key targets, inherited private-JWK native-failure ordering, and ML-KEM
JWK/raw-seed/PKCS8 wrapping through AES-OCB. The four preceding families' focused
suites separately add **129 pass / 0 fail / 0 skip**. The new test file is
registered in `check.sh`.

The complete ordered package gate exits 0:

```text
WPT directory pins: 355 original files verified
tests 40401
pass 39276
fail 0
skipped 1125
{"upstreamTests":2817,"applicableTests":2771,"passed":2771,"failed":0,"notApplicable":46}
check.sh: SKIPPING the compiled axis -- no compiler at .../target/release/nts.
  Host evidence alone does not show that any of this compiles.
```

The package log SHA-256 is
`e55024ecf3bfb4e2b105f8602ff8b42ab2185ab165186ff257deef2e962b39e4`.
The ordered per-file census SHA-256 is
`ea504206880fb93b3b3ffae157abc69b4c4299b77079634552c1e0010e8409ca`.
The JSON report records the commands, remaining log hashes and every outcome.

Both runs tested commit `0ae2272efec6ec1cd805113215aa21c94bf25733`, tree
`ecdf98eed7969a5cd4edcf46a95485e9f5029056`. Only evidence documentation, the
native export-contract comment and inheritance of predecessor reports changed
afterward. Executable source, tests, fixtures and selection policy are identical.
The report also identifies the tested parent by tree, so later predecessor report
commits do not obscure its contents. Maintainers supply the native half, compile
with nts and run the landing gate.

## Historical isolated evidence

Before the ordered rebase, the isolated ML-DSA base reported **33,136 pass /
0 fail / 3,194 blocked**, with 36,330 registrations across 122 executed files,
the same three file-level limitations and no harness failures. The earlier
authored file had **32 pass / 0 fail / 0 skip**. Its shared-key regression run was:

```sh
node --expose-gc --test runtime/web-platform/test/crypto-ml-kem.test.ts runtime/web-platform/test/crypto-ml-dsa.test.ts runtime/web-platform/test/crypto-secret-key.test.ts runtime/web-platform/test/crypto-kdf-key.test.ts
```

That historical command reported **179 tests / 179 pass / 0 fail / 0 skip**.
The original isolated totals, file outcomes and census hash remain under
`isolatedEvidence` in the JSON report. The raw affected-file evidence is retained
unchanged, including the six exact `structuredClone is not defined` failures.
These historical results do not represent the final ordered package totals above.
