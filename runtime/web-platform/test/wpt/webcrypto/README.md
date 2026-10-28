# WebCryptoAPI WPT

The figures below retain the accepted #110 baseline. The
[ML-KEM increment](modern-ml-kem.md) records its added algorithms, restored cases,
and isolated per-file evidence; its ordered-stack gate is reported in the PR.

The full unchanged WebCryptoAPI import registers **36,330 cases across 122
executable files** against this package's canonical `Crypto`, `SubtleCrypto`
and `CryptoKey`. The approved scope and exact exclusions yield **30,991 pass,
zero fail and 5,339 left out**. Three further executable originals are retained
with explicit file-level limitations and null case counts.

The current raw census, with all named case exclusions removed, reports
**30,991 pass, 5,291 fail and 48 optional-feature blocks** and exits 1. These raw
failures remain visible; the scoped result is not a claim that the entire WPT
directory passes or that newer tentative algorithms are implemented.

## Original source inventory and execution

All **185 files** from WPT revision
[`ec2fee39a4ca3c13afd55236795547eedd7f165d`](https://github.com/web-platform-tests/wpt/tree/ec2fee39a4ca3c13afd55236795547eedd7f165d/WebCryptoAPI)
are imported unedited, including the tentative Ed448/X448 files and
`tools/generate.py`, which Node's vendored inventory omits. The inventory has
125 executable fixtures, 56 JavaScript support files and four metadata,
documentation or generator files. The canonical `../versions.json` registers
every original's SHA-256 and Git blob ID, checked against the upstream Git
tree. BSD-3-Clause notices and the one shared WPT licence remain intact.

`common/subset-tests.js` uses the existing shared `common/` revision
`a8f306ee4399724f33399dfdcac7da296f3cc05a`, newer than the crypto pin. Existing
shared helper bytes are unchanged; there is no second `common/` or `resources/`
copy. Support files and metadata contribute no synthetic passing cases.

Every selected fixture receives a fresh package runtime and VM context. The
ordinary-Node test provider supplies native primitives, never Node's Web Crypto
surface. Genuine implementation-realm ECMAScript constructors preserve byte
input and output identities. Native `btoa` only prepares upstream JWK fixtures;
native structured cloning only copies plain ECDSA vector records, never package
CryptoKeys. Provider bootstrap retains global and secure-context policy.

## Reproduction

Use the repository-pinned Node 24.20.0, pnpm 10.15.0 and locked TypeScript 7.0.2:

```sh
pnpm install --offline --frozen-lockfile
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/wpt-webcrypto.test.ts
node --expose-gc runtime/web-platform/test/wpt/webcrypto/report.ts
sh tooling/conformance/web-platform/check.sh
```

The driver and report reader both enforce exact registration counts. The shared
adapter rejects stale named exclusions. `NTS_WPT_CRYPTO_FIXTURE` selects a path
prefix; a prefix matching no file fails instead of producing an empty pass.
Each report line is a JSON record with individual case results; unavailable
file-level environments retain null counts.

The authored `manifest.json` keeps fixture metadata and ordered
`blockedTestFiles` references. Named exclusions live in per-fixture JSON chunks
under `exclusions/`, each at most 50,000 UTF-8 bytes. The area's `manifest.ts`
loader expands them into the shared adapter's ordinary `blockedTests` records
for both consumers. It checks fixture ownership, path scope, duplicate file
references and duplicate test names before any fixture executes. Splitting
changes storage only: all 5,339 case names, categories, reasons and their order
are preserved, and the upstream originals and shared version table are unchanged.

The report-only raw mode clears `blockedTests` in memory. It does not edit the
manifest, change gate policy, suppress failures, change optional-feature status,
or fabricate the three unavailable file-level runs:

```sh
NTS_WPT_CRYPTO_RAW=1 node --expose-gc runtime/web-platform/test/wpt/webcrypto/report.ts > webcrypto-raw.jsonl
```

This command currently **exits 1**, with the raw totals stated above. For a small
control, set `NTS_WPT_CRYPTO_FIXTURE=WebCryptoAPI/historical.any.js`: the normal
report has three declared blocks and exits 0; raw mode exposes all three
insecure-context failures and exits 1. The WPT driver does not read the raw-mode
variable.

The original pre-fix source is at import commit `3804662897fbf3c439efce83b261e764fdf92a82`. Its report
reader already supports raw mode and the split manifest. To reproduce the
baseline, create a separate checkout and run its original implementation,
fixture bytes and manifest:

```sh
git worktree add --detach ../nts-webcrypto-baseline 3804662897fbf3c439efce83b261e764fdf92a82
cd ../nts-webcrypto-baseline
pnpm install --offline --frozen-lockfile
NTS_WPT_CRYPTO_RAW=1 node --expose-gc runtime/web-platform/test/wpt/webcrypto/report.ts > webcrypto-baseline-raw.jsonl
```

That command is expected to exit 1. This reproduction does not replace the
retained initial evidence.

## Package fixes and preserved evidence

The initial [baseline.json](baseline.json) records **27,393 pass, 8,889 fail and
48 optional-feature blocks**, plus three file-level limitations, before the two
package fixes. Each original fixture ran against package crypto in its own
process. Setup registrations count because upstream registers them as tests.

Two source defects are corrected in separate commits:

- `getRandomValues` now throws the canonical `QuotaExceededError` derived from
  the package's DOMException. Its nullable metadata, constructor conversion and
  validation follow [Web IDL §2.8.3](https://webidl.spec.whatwg.org/#quotaexceedederror)
  and [Web Cryptography §10.1.1](https://w3c.github.io/webcrypto/#Crypto-method-getRandomValues).
  The public error taxonomy includes it as a nontransport error. The focused
  regression was red before the change; boundary and error-order controls stayed
  green, and all 14 focused quota controls now pass.
- `Crypto`, `SubtleCrypto` and `CryptoKey` expose their canonical interface tags
  through class-body getters, following [Web IDL §3.7.3](https://webidl.spec.whatwg.org/#interface-prototype-object).
  No descriptor reflection or upstream assertion change implements the tags.

The subsequent [after-package-fixes.json](after-package-fixes.json) preserves
**30,991 pass, 36 fail and 5,303 left out**. The 36 remaining failures are EC
PKCS8 byte-round-trip expectations that earlier tag failures had masked. They
are retained as evidence and individually classified by their specification
conflict below. No third package algorithm fix was made to satisfy those
conflicting bytes. No cryptographic primitive, native capability contract or
documented test-provider limit changed.

The final [results.json](results.json) contains the full-gate per-file totals,
initial and intermediate counts, current raw counts and grouped raw errors,
category totals, input hashes and command/log identities. Both earlier evidence
files are preserved unchanged. Input hashes identify `manifest.json`, every
referenced exclusion chunk, and the expanded manifest encoded as UTF-8
`JSON.stringify` output without a trailing newline. The pre-split manifest hash
identifies the storage used by the recorded full gate; expansion was checked for
exact JSON equality before and after the split.

## Scope and exact limitations

The assigned algorithms are SHA-1/256/384/512, HMAC, AES-CTR/CBC/GCM/KW,
RSASSA-PKCS1-v1_5, RSA-PSS, RSA-OAEP, ECDSA/ECDH over P-256/P-384/P-521,
Ed25519/X25519/Ed448/X448, HKDF and PBKDF2. The complete upstream pin also contains
tentative SHA-3/cSHAKE/TurboSHAKE/KangarooTwelve, AES-OCB, ChaCha20-Poly1305,
KMAC, ML-KEM, ML-DSA, Argon2, encapsulation, `getPublicKey`, `supports` and new
raw-format aliases. Their excluded failures remain in raw reports and are
named in the manifest. Generic argument-conversion cases that pass remain
active; those passes do not establish support for an out-of-scope algorithm.

| Case limitation | Registrations left out |
| --- | ---: |
| Algorithms, formats and operations outside the assignment | 4,932 |
| Upstream/specification discrepancies described below | 302 |
| Accepted optional compressed EC points | 48 |
| Native CryptoKey structured cloning | 40 |
| Browser document, iframe and discarded-realm behavior | 13 |
| Insecure-context global exposure | 3 |
| Secure Worker construction and script loading | 1 |
| **Total named case exclusions** | **5,339** |

The 302 specification discrepancies have three exact groups:

- **264 transfer-during-call cases:** the algorithm-name getter transfers a
  buffer on both reads. [Web Crypto §18.4.4](https://w3c.github.io/webcrypto/#algorithm-normalization)
  and [Web IDL §3.2.17](https://webidl.spec.whatwg.org/#es-dictionary) require
  separate conversions, so the second transfer throws. The upstream editor
  confirms the disagreement in [w3c/webcrypto#563](https://github.com/w3c/webcrypto/issues/563).
- **Two ECDH mismatch cases:** [§24.4.2](https://w3c.github.io/webcrypto/#ecdh-operations-derive-bits)
  checks the peer's output bound before curve equality. An oversized request
  therefore requires `OperationError`, while the pinned tests expect
  `InvalidAccessError`.
- **36 EC PKCS8 round trips:** [§23.7.5](https://w3c.github.io/webcrypto/#ecdsa-operations-export-key)
  and [§24.4.4](https://w3c.github.io/webcrypto/#ecdh-operations-export-key)
  require `ECPrivateKey.parameters` and `publicKey` on export. The fixture expects
  byte identity with an input omitting inner parameters. Canonical export follows
  the draft; the test's original byte expectation remains unchanged.

Existing focused normalization, ECDH ordering and EC DER controls remain active.
The exact contradictory WPT cases are left out, never counted as passing
conformance. Compressed EC points and the documented Node HMAC, RSA and KDF
provider limits remain as previously accepted. No browser API or CryptoKey
clone is fabricated.

Three files have no valid case-count result in this adapter:

| Original file | File-level limitation |
| --- | --- |
| `idlharness.https.any.js` | Full browser IDL environment, generated WebIDLParser route, fetched IDL and prototype/descriptor exposure are unavailable. |
| `idlharness.tentative.https.any.js` | Same IDL environment limitation, including tentative interfaces. |
| `derive_bits_keys/derive_key_and_encrypt.https.any.js` | Upstream starts `importKeys().then(register...)` but returns an unrelated resolved promise. Registration arrives after the setup test completes. |

The initial execution observed the detached-registration defect. The shared
adapter follows upstream's pending-test completion rule; it adds no timer delay
to retain that detached work. Descriptor-only IDL cases remain outside the
cloud-agent scope.

## Shared adapter additions

The additive extensions are `assert_in_array`, truthful optional-feature status,
the full quota-error assertion, exposed assertion error constructors,
`explicit_timeout`/`timeout()`, and registration from pending asynchronous tests.
Their positive and negative controls are deterministic. No new test depends on
elapsed wall time, and the corpus is not rewritten to accommodate the adapter.

## Per-file results

Every executable original has one row. Initial columns are the raw pre-fix
baseline; final columns are the scoped full-gate result. The initial baseline
also contains 48 optional-feature blocks, recorded in JSON. A dash means the
file has no valid run, not zero passing or failing cases.

| File under `WebCryptoAPI/` | Initial pass | Initial fail | Final pass | Final fail | Left out | Status |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `algorithm-discards-context.https.window.js` | 0 | 13 | 0 | 0 | 13 | Executed |
| `crypto_key_cached_slots.https.any.js` | 2 | 0 | 2 | 0 | 0 | Executed |
| `derive_bits_keys/argon2.tentative.https.any.js` | 0 | 1 | 0 | 0 | 1 | Executed |
| `derive_bits_keys/cfrg_curves_bits_curve25519.https.any.js` | 19 | 0 | 19 | 0 | 0 | Executed |
| `derive_bits_keys/cfrg_curves_bits_curve448.tentative.https.any.js` | 18 | 0 | 18 | 0 | 0 | Executed |
| `derive_bits_keys/cfrg_curves_keys_curve25519.https.any.js` | 17 | 0 | 17 | 0 | 0 | Executed |
| `derive_bits_keys/cfrg_curves_keys_curve448.tentative.https.any.js` | 16 | 0 | 16 | 0 | 0 | Executed |
| `derive_bits_keys/derive_key_and_encrypt.https.any.js` | — | — | — | — | — | Not run: detached registration |
| `derive_bits_keys/derived_bits_length.https.any.js` | 29 | 0 | 29 | 0 | 0 | Executed |
| `derive_bits_keys/ecdh_bits.https.any.js` | 38 | 2 | 38 | 0 | 2 | Executed |
| `derive_bits_keys/ecdh_keys.https.any.js` | 31 | 0 | 31 | 0 | 0 | Executed |
| `derive_bits_keys/hkdf.https.any.js` | 3,661 | 0 | 3,661 | 0 | 0 | Executed |
| `derive_bits_keys/pbkdf2.https.any.js` | 8,632 | 0 | 8,632 | 0 | 0 | Executed |
| `digest/cshake.tentative.https.any.js` | 0 | 88 | 0 | 0 | 88 | Executed |
| `digest/digest.https.any.js` | 116 | 0 | 116 | 0 | 0 | Executed |
| `digest/kangarootwelve.tentative.https.any.js` | 0 | 148 | 0 | 0 | 148 | Executed |
| `digest/sha3.tentative.https.any.js` | 0 | 48 | 0 | 0 | 48 | Executed |
| `digest/turboshake.tentative.https.any.js` | 0 | 135 | 0 | 0 | 135 | Executed |
| `encap_decap/encap_decap_bits.tentative.https.any.js` | 0 | 9 | 0 | 0 | 9 | Executed |
| `encap_decap/encap_decap_keys.tentative.https.any.js` | 0 | 120 | 0 | 0 | 120 | Executed |
| `encrypt_decrypt/aes_cbc.https.any.js` | 55 | 6 | 55 | 0 | 6 | Executed |
| `encrypt_decrypt/aes_ctr.https.any.js` | 46 | 6 | 46 | 0 | 6 | Executed |
| `encrypt_decrypt/aes_gcm.https.any.js` | 493 | 84 | 493 | 0 | 84 | Executed |
| `encrypt_decrypt/aes_gcm_256_iv.https.any.js` | 493 | 84 | 493 | 0 | 84 | Executed |
| `encrypt_decrypt/aes_ocb.tentative.https.any.js` | 1 | 276 | 1 | 0 | 276 | Executed |
| `encrypt_decrypt/chacha20_poly1305.tentative.https.any.js` | 0 | 28 | 0 | 0 | 28 | Executed |
| `encrypt_decrypt/rsa_oaep.https.any.js` | 157 | 24 | 157 | 0 | 24 | Executed |
| `generateKey/failures_AES-CBC.https.any.js` | 774 | 0 | 774 | 0 | 0 | Executed |
| `generateKey/failures_AES-CTR.https.any.js` | 774 | 0 | 774 | 0 | 0 | Executed |
| `generateKey/failures_AES-GCM.https.any.js` | 774 | 0 | 774 | 0 | 0 | Executed |
| `generateKey/failures_AES-KW.https.any.js` | 516 | 0 | 516 | 0 | 0 | Executed |
| `generateKey/failures_AES-OCB.tentative.https.any.js` | 360 | 414 | 360 | 0 | 414 | Executed |
| `generateKey/failures_ECDH.https.any.js` | 476 | 0 | 476 | 0 | 0 | Executed |
| `generateKey/failures_ECDSA.https.any.js` | 454 | 0 | 454 | 0 | 0 | Executed |
| `generateKey/failures_Ed25519.https.any.js` | 412 | 0 | 412 | 0 | 0 | Executed |
| `generateKey/failures_Ed448.tentative.https.any.js` | 412 | 0 | 412 | 0 | 0 | Executed |
| `generateKey/failures_HMAC.https.any.js` | 616 | 0 | 616 | 0 | 0 | Executed |
| `generateKey/failures_ML-DSA.tentative.https.any.js` | 360 | 156 | 360 | 0 | 156 | Executed |
| `generateKey/failures_ML-KEM.tentative.https.any.js` | 360 | 684 | 360 | 0 | 684 | Executed |
| `generateKey/failures_RSA-OAEP.https.any.js` | 532 | 0 | 532 | 0 | 0 | Executed |
| `generateKey/failures_RSA-PSS.https.any.js` | 428 | 0 | 428 | 0 | 0 | Executed |
| `generateKey/failures_RSASSA-PKCS1-v1_5.https.any.js` | 428 | 0 | 428 | 0 | 0 | Executed |
| `generateKey/failures_X25519.https.any.js` | 424 | 0 | 424 | 0 | 0 | Executed |
| `generateKey/failures_X448.tentative.https.any.js` | 424 | 0 | 424 | 0 | 0 | Executed |
| `generateKey/failures_chacha20_poly1305.tentative.https.any.js` | 360 | 140 | 360 | 0 | 140 | Executed |
| `generateKey/failures_kmac.tentative.https.any.js` | 360 | 192 | 360 | 0 | 192 | Executed |
| `generateKey/successes_AES-CBC.https.any.js` | 0 | 288 | 288 | 0 | 0 | Executed |
| `generateKey/successes_AES-CTR.https.any.js` | 0 | 288 | 288 | 0 | 0 | Executed |
| `generateKey/successes_AES-GCM.https.any.js` | 0 | 288 | 288 | 0 | 0 | Executed |
| `generateKey/successes_AES-KW.https.any.js` | 0 | 72 | 72 | 0 | 0 | Executed |
| `generateKey/successes_AES-OCB.tentative.https.any.js` | 0 | 288 | 0 | 0 | 288 | Executed |
| `generateKey/successes_ECDH.https.any.js` | 0 | 72 | 72 | 0 | 0 | Executed |
| `generateKey/successes_ECDSA.https.any.js` | 0 | 54 | 54 | 0 | 0 | Executed |
| `generateKey/successes_Ed25519.https.any.js` | 0 | 36 | 36 | 0 | 0 | Executed |
| `generateKey/successes_Ed448.tentative.https.any.js` | 0 | 36 | 36 | 0 | 0 | Executed |
| `generateKey/successes_HMAC.https.any.js` | 0 | 192 | 192 | 0 | 0 | Executed |
| `generateKey/successes_ML-DSA.tentative.https.any.js` | 0 | 108 | 0 | 0 | 108 | Executed |
| `generateKey/successes_ML-KEM.tentative.https.any.js` | 0 | 468 | 0 | 0 | 468 | Executed |
| `generateKey/successes_RSA-OAEP.https.any.js` | 0 | 156 | 156 | 0 | 0 | Executed |
| `generateKey/successes_RSA-PSS.https.any.js` | 0 | 36 | 36 | 0 | 0 | Executed |
| `generateKey/successes_RSASSA-PKCS1-v1_5.https.any.js` | 0 | 36 | 36 | 0 | 0 | Executed |
| `generateKey/successes_X25519.https.any.js` | 0 | 32 | 32 | 0 | 0 | Executed |
| `generateKey/successes_X448.tentative.https.any.js` | 0 | 32 | 32 | 0 | 0 | Executed |
| `generateKey/successes_chacha20_poly1305.tentative.https.any.js` | 0 | 192 | 0 | 0 | 192 | Executed |
| `generateKey/successes_kmac.tentative.https.any.js` | 0 | 144 | 0 | 0 | 144 | Executed |
| `getPublicKey.tentative.https.any.js` | 0 | 37 | 0 | 0 | 37 | Executed |
| `getRandomValues.any.js` | 30 | 9 | 39 | 0 | 0 | Executed |
| `historical.any.js` | 0 | 3 | 0 | 0 | 3 | Executed |
| `idlharness.https.any.js` | — | — | — | — | — | Not run: IDL environment |
| `idlharness.tentative.https.any.js` | — | — | — | — | — | Not run: IDL environment |
| `import_export/AES-OCB_importKey.tentative.https.any.js` | 0 | 72 | 0 | 0 | 72 | Executed |
| `import_export/Argon2_importKey.tentative.https.any.js` | 0 | 45 | 0 | 0 | 45 | Executed |
| `import_export/ChaCha20-Poly1305_importKey.tentative.https.any.js` | 0 | 24 | 0 | 0 | 24 | Executed |
| `import_export/KMAC_importKey.tentative.https.any.js` | 0 | 144 | 0 | 0 | 144 | Executed |
| `import_export/ML-DSA_importKey.tentative.https.any.js` | 0 | 180 | 0 | 0 | 180 | Executed |
| `import_export/ML-KEM_importKey.tentative.https.any.js` | 0 | 324 | 0 | 0 | 324 | Executed |
| `import_export/crashtests/importKey-unsettled-promise.https.any.js` | 1 | 0 | 1 | 0 | 0 | Executed |
| `import_export/ec_importKey.https.any.js` | 24 | 192 | 180 | 0 | 84 | Executed |
| `import_export/ec_importKey_failures_ECDH.https.any.js` | 620 | 0 | 620 | 0 | 0 | Executed |
| `import_export/ec_importKey_failures_ECDSA.https.any.js` | 620 | 0 | 620 | 0 | 0 | Executed |
| `import_export/okp_importKey_Ed25519.https.any.js` | 20 | 52 | 72 | 0 | 0 | Executed |
| `import_export/okp_importKey_Ed448.tentative.https.any.js` | 20 | 52 | 72 | 0 | 0 | Executed |
| `import_export/okp_importKey_X25519.https.any.js` | 10 | 44 | 54 | 0 | 0 | Executed |
| `import_export/okp_importKey_X448.tentative.https.any.js` | 10 | 44 | 54 | 0 | 0 | Executed |
| `import_export/okp_importKey_failures_Ed25519.https.any.js` | 530 | 0 | 530 | 0 | 0 | Executed |
| `import_export/okp_importKey_failures_Ed448.tentative.https.any.js` | 530 | 0 | 530 | 0 | 0 | Executed |
| `import_export/okp_importKey_failures_X25519.https.any.js` | 454 | 0 | 454 | 0 | 0 | Executed |
| `import_export/okp_importKey_failures_X448.tentative.https.any.js` | 454 | 0 | 454 | 0 | 0 | Executed |
| `import_export/raw_format_aliases.tentative.https.any.js` | 0 | 20 | 0 | 0 | 20 | Executed |
| `import_export/rsa_importKey.https.any.js` | 144 | 912 | 1,056 | 0 | 0 | Executed |
| `import_export/symmetric_importKey.https.any.js` | 198 | 408 | 606 | 0 | 0 | Executed |
| `normalize-algorithm-name.https.any.js` | 4 | 0 | 4 | 0 | 0 | Executed |
| `randomUUID.https.any.js` | 3 | 0 | 3 | 0 | 0 | Executed |
| `secure_context/crypto-subtle-secure-context-available.https.sub.html` | 1 | 1 | 1 | 0 | 1 | Executed |
| `serialization/aes-cbc.https.any.js` | 0 | 3 | 0 | 0 | 3 | Executed |
| `serialization/aes-ctr.https.any.js` | 0 | 3 | 0 | 0 | 3 | Executed |
| `serialization/aes-gcm.https.any.js` | 0 | 3 | 0 | 0 | 3 | Executed |
| `serialization/aes-kw.https.any.js` | 0 | 3 | 0 | 0 | 3 | Executed |
| `serialization/aes-ocb.tentative.https.any.js` | 0 | 3 | 0 | 0 | 3 | Executed |
| `serialization/chacha20-poly1305.tentative.https.any.js` | 0 | 2 | 0 | 0 | 2 | Executed |
| `serialization/ecdh.https.any.js` | 0 | 3 | 0 | 0 | 3 | Executed |
| `serialization/ecdsa.https.any.js` | 0 | 3 | 0 | 0 | 3 | Executed |
| `serialization/ed25519.https.any.js` | 0 | 2 | 0 | 0 | 2 | Executed |
| `serialization/ed448.tentative.https.any.js` | 0 | 2 | 0 | 0 | 2 | Executed |
| `serialization/hmac.https.any.js` | 0 | 8 | 0 | 0 | 8 | Executed |
| `serialization/kmac.tentative.https.any.js` | 0 | 6 | 0 | 0 | 6 | Executed |
| `serialization/mldsa.tentative.https.any.js` | 0 | 6 | 0 | 0 | 6 | Executed |
| `serialization/mlkem.tentative.https.any.js` | 0 | 6 | 0 | 0 | 6 | Executed |
| `serialization/rsa-oaep.https.any.js` | 0 | 2 | 0 | 0 | 2 | Executed |
| `serialization/rsa-pss.https.any.js` | 0 | 2 | 0 | 0 | 2 | Executed |
| `serialization/rsassa-pkcs1-v1_5.https.any.js` | 0 | 2 | 0 | 0 | 2 | Executed |
| `serialization/x25519.https.any.js` | 0 | 2 | 0 | 0 | 2 | Executed |
| `serialization/x448.tentative.https.any.js` | 0 | 2 | 0 | 0 | 2 | Executed |
| `sign_verify/ecdsa.https.any.js` | 301 | 24 | 301 | 0 | 24 | Executed |
| `sign_verify/eddsa_curve25519.https.any.js` | 17 | 2 | 17 | 0 | 2 | Executed |
| `sign_verify/eddsa_curve448.tentative.https.any.js` | 17 | 2 | 17 | 0 | 2 | Executed |
| `sign_verify/eddsa_small_order_points.https.any.js` | 14 | 0 | 14 | 0 | 0 | Executed |
| `sign_verify/hmac.https.any.js` | 57 | 8 | 57 | 0 | 8 | Executed |
| `sign_verify/kmac.tentative.https.any.js` | 1 | 102 | 1 | 0 | 102 | Executed |
| `sign_verify/mldsa.tentative.https.any.js` | 1 | 57 | 1 | 0 | 57 | Executed |
| `sign_verify/rsa_pkcs.https.any.js` | 61 | 8 | 61 | 0 | 8 | Executed |
| `sign_verify/rsa_pss.https.any.js` | 129 | 16 | 129 | 0 | 16 | Executed |
| `supports-modern.tentative.https.any.js` | 0 | 94 | 0 | 0 | 94 | Executed |
| `supports.tentative.https.any.js` | 0 | 171 | 0 | 0 | 171 | Executed |
| `wrapKey_unwrapKey/wrapKey_unwrapKey.https.any.js` | 54 | 303 | 357 | 0 | 0 | Executed |
| **Total** | **27,393** | **8,889** | **30,991** | **0** | **5,339** | **122 executed; 3 not run** |

## Final validation

The final full `check.sh` run after the lossless inventory split exits **0**. It
verifies all **355 original files** currently registered in the shared table and
passes source typechecking and export reachability. The export audit reports
zero unexplained exports, with five allowed, 134 audited and **4,964 corpus
files scanned**. An earlier full run exposed one necessary test integration:
the existing public error taxonomy needed the newly exported QuotaExceededError.
After that entry and its DOMException-base control were added, the entire check
was rerun successfully.

| Run | Total | Passed | Failed | Skipped / left out |
| --- | ---: | ---: | ---: | ---: |
| WebCrypto WPT registrations | 36,330 | 30,991 | 0 | 5,339 |
| Focused quota and public error-taxonomy controls | 19 | 19 | 0 | 0 |
| Full package node:test phase | 40,112 | 34,705 | 0 | 5,407 |
| Existing upstream corpus | 2,817 | 2,771 | 0 | 46 |
| Current raw WebCrypto census, expected exit 1 | 36,330 | 30,991 | 5,291 | 48 |

The full package phase has three suites, zero cancellations and zero todos.
Its wider counts include fixture wrappers and other package tests; the WPT row
counts actual registrations only. The three not-run originals contribute no
WPT case count. The separate WPT TypeScript check also exits 0 without
diagnostics. Report controls verify both raw/scoped status differences and
failure on an empty prefix selection.

The compiled axis explicitly **skips because nts is unavailable**. All numbers
above are host evidence; maintainers still compile with nts and run the landing
gate. The Compression Streams WPT import remains its own PR stacked on #52,
and the permessage-deflate migration still waits for the realtime notice.

Final full-check log: `validation/webcrypto-wpt-final-check.log`.

Final full-check log SHA-256: `701b55cc1611f2309846df3d20135c21164c7a42e1ab469d5548bd96c724eab0`.

Current raw JSONL SHA-256: `a1ce7e84faa7acbfe99c19dfe3d3f424bad16fd1ab017b9289519947106a133a`.
