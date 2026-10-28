# Argon2

The package implements `Argon2d`, `Argon2i` and `Argon2id` from
[Modern Algorithms §§17.2–17.4](https://wicg.github.io/webcrypto-modern-algos/#argon2),
using the existing native derivation capability. This family stacks on
`chatgpt/webcrypto-modern-aead`, after SHA-3, cSHAKE, KMAC and AEAD. The supported
profile is RFC 9106 version 19 (`0x13`), as implemented by Node 24.20.

## API and native contract

The algorithms register import, derivation and the internal get-key-length
operation. API keys use `raw-secret`, are nonextractable secret keys, and expose
name-only algorithm metadata with `deriveKey` and/or `deriveBits` usages. Empty
passwords are supported. Legacy `raw`, JWK, asymmetric key formats, key generation
and key export are outside the Argon2 registration.

`CryptoArgon2Parameters` extends `CryptoDerivationParameters`. One existing
`CryptoProvider.derive` call receives the algorithm, native password-key handle,
nonce, parallelism, memory in KiB, passes, version, optional secret value and
associated data, and output byte length. All memory processing and hashing,
including Blake2b, stay native. Memory is passed without rounding: the native
[RFC 9106 operation](https://www.rfc-editor.org/rfc/rfc9106.html#section-3.2)
retains that parameter while determining its block count. Outputs have independent,
exact-size storage. Native validation and allocation failures cross the capability
as `CryptoFailure` values and become `OperationError` in shared code.

Shared code converts the dictionary in Web IDL order and performs the
[§17.4.1 operation checks](https://wicg.github.io/webcrypto-modern-algos/#argon2-operations-derive-bits):
an explicit byte-aligned output of at least 32 bits, version `0x13`, parallelism
from 1 through 2²⁴−1, memory of at least eight times parallelism, and positive
passes. Nonce constraints remain in the native RFC operation. Inputs are borrowed
for immediate synchronous use and copied before later derived-key target getters
can run, following [Web Crypto §18.4.4](https://w3c.github.io/webcrypto/#algorithm-normalization).

`deriveKey` uses the package's internal derivation and import functions. Argon2
can also be a derived-key target: its null key-length result accepts a complete
agreement secret, such as X25519 output. An Argon2 base requires an explicit
output length, so it cannot derive a target whose key-length operation returns
null. These paths follow [Web Crypto §14.3.7](https://w3c.github.io/webcrypto/#SubtleCrypto-method-deriveKey)
and Modern Algorithms §17.4.3.

The test provider calls
[`node:crypto.argon2Sync`](https://nodejs.org/download/release/v24.20.0/docs/api/crypto.html#cryptoargon2syncalgorithm-parameters)
once per derivation. Its implementation is pinned to
[Node 24.20.0](https://github.com/nodejs/node/blob/v24.20.0/lib/internal/crypto/argon2.js)
and remains in the test tree. No dependency, native capability method or
TypeScript cryptographic primitive is added. No additional Argon2 provider-limit
exclusions are required by the imported cases. Earlier Argon2 versions and the
later `SubtleCrypto.supports` surface are outside this increment.

## WPT selection and results

The WPT revision remains `ec2fee39a4ca3c13afd55236795547eedd7f165d`. Original
files, licence headers, support files and `versions.json` hashes are unchanged.
The two tentative Argon2 files run with this package's `crypto`:

| File under `WebCryptoAPI/` | Pass | Fail | Blocked |
| --- | ---: | ---: | ---: |
| `derive_bits_keys/argon2.tentative.https.any.js` | 4 | 0 | 0 |
| `import_export/Argon2_importKey.tentative.https.any.js` | 45 | 0 | 0 |
| **Total** | **49** | **0** | **0** |

Removing 46 earlier named exclusions activates 49 cases: successful derivation
setup registers the three additional
[RFC 9106 §§5.1–5.3 vectors](https://www.rfc-editor.org/rfc/rfc9106.html#section-5).
This family adds no specification-disagreement exclusions. The accepted 302
discrepancies and the preceding families' documented exclusions remain unchanged.

The complete ordered census reports **33,246 pass / 0 fail / 3,202 blocked**,
with **36,448 registered cases**, 122 executed files, three files not run and no
harness failures. [The machine-readable report](modern-argon2-results.json)
contains all 125 per-file outcomes. The three file-level limitations retain their
reasons: two require the browser IDL harness and reflection; one registers tests
after its setup promise resolves. They are not recorded as passing cases.

## Validation

Evidence was collected at tested head
`be3122dd930700955e34dbe44d838cba6d6b4dc9`, with tree
`87428bb8e823d044fbcb29d580e5e41a9f26d6fb`. Its tested prerequisite tree is
`2a6a08c0c9b6291b4181ecf0095d1f5cf0cfcaef`. Recording the parent tree preserves
the tested prerequisite contents if the parent branch later gains report commits
or is rebased. The historical baseline reports are unchanged.

Node 24.20.0, pnpm 10.15.0 and locked TypeScript 7.0.2 were used:

```sh
pnpm install --offline --frozen-lockfile
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc runtime/web-platform/test/wpt/webcrypto/report.ts
sh tooling/conformance/web-platform/check.sh
```

The full package check also runs
`pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false`.
Both project typechecks exit 0 without diagnostics. Installation reports
"Already up to date" and leaves the lockfile unchanged. Every command exits 0.

| Check | Result |
| --- | --- |
| Full package Node test axis | 40,328 tests; 37,058 pass; 0 fail; 3,270 skipped |
| Additional upstream adapter axis | 2,771 pass; 0 fail; 46 not applicable, from 2,817 cases |
| Complete scoped WebCrypto census | 33,246 pass; 0 fail; 3,202 blocked |
| Argon2 specification controls within the package gate | 42 pass; 0 fail; 0 skipped |
| Shared WPT version verification | 355 original files verified |
| Compiled axis | Skipped because nts is unavailable |

The 42 authored controls cover the three RFC known answers, binary and empty
inputs, nonce/native failures, unrounded memory, optional inputs, view ranges and
ownership, dictionary conversion and snapshots, key policy, error precedence,
queued results, derivation targets, wrapping and internal method dispatch. The
new test file is registered in `check.sh`. Maintainers still compile with nts;
host results do not establish compiled support.

The logs used for this report have the following SHA-256 hashes:

| Log | SHA-256 |
| --- | --- |
| `modern-argon2-ordered-install.log` | `a1f393b47b50f86972f2ed34c2567aca219e3f5ab5ab005821e260af66824c2a` |
| `modern-argon2-ordered-wpt-tsc.log` | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| `modern-argon2-ordered-scoped.jsonl` | `786b3528ccf0ee05ca4ffac5d1d3c7c6740482b17a181de4be0dce62be54558b` |
| `modern-argon2-ordered-full-check.log` | `803276962f51344d0cd00d533f3b90948b53b63afaca1a7d578dfc1b0f7eba9a` |

The WPT typecheck log is empty because the command emitted no diagnostics; its
successful exit was recorded with the completed run.
