# WebCryptoAPI WPT

This area runs the original WebCryptoAPI directory against this package's
canonical `Crypto`, `SubtleCrypto` and `CryptoKey` through `NodeCryptoProvider`.
The test host supplies native primitives; it never supplies Node's Web Crypto
surface. Every fixture receives a fresh package runtime and VM context.

## Original source inventory

All **185 files** from WPT revision
`ec2fee39a4ca3c13afd55236795547eedd7f165d` are imported unedited, including all
tentative Ed448 and X448 files and `tools/generate.py` (which Node's vendored
inventory omits). There are 125 executable fixture files, 56 JavaScript support
files and four metadata/documentation/generator files. Each original's SHA-256
and Git blob is registered in the canonical `../versions.json` and was checked
against the upstream Git tree. Existing BSD-3-Clause notices and the shared
WPT licence remain intact.

`common/subset-tests.js` is added to the existing shared `common/` revision
`a8f306ee4399724f33399dfdcac7da296f3cc05a`, which is newer than the crypto pin.
Existing shared helper bytes are unchanged. No second `common/` or `resources/`
copy is created. The IDL fixtures' generated WebIDLParser route and browser IDL
environment are unavailable, so those original fixtures are retained and
explicitly reported as not run; no substitute IDL harness is supplied.

## Commands and results

```sh
node --expose-gc --test runtime/web-platform/test/wpt-webcrypto.test.ts
node --expose-gc runtime/web-platform/test/wpt/webcrypto/report.ts
```

The first command uses the shared adapter's exact registration checks, stale
exclusion checks and per-file diagnostics. The second emits one JSON record per
fixture with individual results; missing environments have null test counts.
`NTS_WPT_CRYPTO_FIXTURE` selects a path prefix for a focused reproduction.

`baseline.json` records the initial unfiltered run before package fixes and
named exclusions: **27,393 pass, 8,889 fail and 48 optional-feature blocks**
across 122 executed files. Three further originals have explicit file-level
limitations. Setup registrations count as tests, as upstream registers them;
support files and metadata never count as passing tests.

## Scope and exact limitations

The assigned surface is SHA-1/256/384/512, HMAC, AES-CTR/CBC/GCM/KW,
RSASSA-PKCS1-v1_5, RSA-PSS, RSA-OAEP, ECDSA/ECDH over P-256/P-384/P-521,
Ed25519/X25519/Ed448/X448, HKDF and PBKDF2. The full upstream directory also
contains tentative SHA-3/cSHAKE/TurboSHAKE/KangarooTwelve, AES-OCB,
ChaCha20-Poly1305, KMAC, ML-KEM, ML-DSA, Argon2, encapsulation, `getPublicKey`,
`supports` and new raw-format aliases. Their original failures are retained in
the baseline and named explicitly as outside the assignment in the manifest.
Generic argument-conversion cases that already pass remain active; those passes
do not establish implementation of an out-of-scope algorithm.

The manifest names every blocked registration and its reason. Other limitations
are native CryptoKey structured cloning, browser documents/iframes/workers,
insecure-context global exposure, and the accepted optional compressed EC
point imports. No browser API or CryptoKey cloning behavior is fabricated.
The documented HMAC, RSA and KDF test-provider limits are unchanged.

Two groups of upstream expectations disagree with the governing draft:

- Two ECDH mismatch cases request more bits than their public peer supplies.
  [Web Cryptography §24.4.2](https://w3c.github.io/webcrypto/#ecdh-operations-derive-bits)
  checks that bound before curve equality, requiring `OperationError` where the
  pinned cases expect `InvalidAccessError`. The existing paired local controls
  exercise both the bound and mismatch paths.
- 264 transfer-during-call cases transfer a buffer every time an algorithm name
  getter is read. [§18.4.4](https://w3c.github.io/webcrypto/#algorithm-normalization)
  and [Web IDL §3.2.17](https://webidl.spec.whatwg.org/#es-dictionary) require
  separate conversions, so the second transfer throws. The upstream editor
  confirms the discrepancy in [w3c/webcrypto#563](https://github.com/w3c/webcrypto/issues/563).
  Existing normalization controls preserve both getter reads and exception order.

These exact original failures are recorded, then blocked in the package gate;
they are never counted as passing WPT conformance. Neither implementation nor
fixture is changed to follow the conflicting expectation.

`derive_key_and_encrypt.https.any.js` is also retained but not run in the gate:
its `define_tests` starts `importKeys().then(register...)` and returns a separate
resolved promise. The initial run observed late registration after the setup
test completed. The adapter follows upstream's pending-test completion rule and
does not invent a timer delay to retain that detached work. The two IDL fixtures
make up the remaining file-level limitations.

## Shared adapter extensions

The additive changes are `assert_in_array`, truthful optional-feature status,
the full quota-error assertion, exposed assertion error constructors,
`explicit_timeout`/`timeout()`, and registration from pending asynchronous tests.
Each has positive and negative deterministic controls in `wpt-harness.test.ts`.
No new test depends on elapsed wall time. Genuine ECMAScript constructors are
injected for buffer identity; native `btoa` only prepares original JWK fixtures,
and native structured cloning only copies plain ECDSA vector records.
