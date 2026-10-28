# SubtleCrypto.supports

This increment implements the static method and both overloads in
[Modern Algorithms §§3.2.6–3.3](https://wicg.github.io/webcrypto-modern-algos/#SubtleCrypto-method-supports),
using the algorithms of the preceding five PRs. The query follows the package's
registration and parameter policy and the installed runtime's native capability.
TurboSHAKE, KangarooTwelve, hybrid KEMs and algorithms outside the Node 24.20
profile remain unavailable.

## Native capability and operation order

`CryptoProvider.supports` accepts a typed `CryptoSupportQuery`: one normalized
operation, a discriminated algorithm family and its scalar metadata. RSA
generation additionally borrows the public exponent's minimal bytes. No
CryptoKey, author dictionary, message, secret or buffer copy crosses this seam.
The capability reads availability and known native limits; it never generates
or imports a key, requests entropy, or runs a cryptographic operation to find
out whether that operation is available. Failures are values that become false.

Shared code handles dictionary conversion, the registered operation, parameter
checks, wrapping fallback, public-key eligibility and derived/shared key lengths.
An ordinary check makes at most one metadata query. A composed check makes at
most two queries, one per algorithm. It queries the target first and stops on
false before normalizing or querying the primary operation. KEM composition
first normalizes its primary algorithm to obtain the shared-key length, as
§3.2.6 requires. The repeated get-key-length normalization required by
`deriveKey` remains observable; an exception in the final normalization propagates.

The static method obtains the capability from the current installed runtime
through a private identity association populated during Crypto construction. The
lookup never invokes the public `crypto.subtle` getter or exposes a provider
member. It reports false when that runtime or its crypto
capability is absent. It uses the same canonical class in WPT; the adapter adds
no substitute method. No scheduler task is enqueued.

The test provider uses Node's native cipher, curve and hash inventories. For
native jobs without public inventory APIs, the existing test worker reads the
pinned binding's constructor/identifier availability without constructing or
running a job. It also reports the existing provider restrictions: for example,
HKDF `info` over 1,024 bytes, nonzero PBKDF2 outputs with iteration counts over
2³¹−1, cSHAKE/KMAC customization over 512 bytes, an empty OCB IV, and GCM IVs outside 1–128 bytes. Secret-key
generation and import do not acquire KMAC's signing-key length restriction;
there is no signing key in those queries. The GCM maximum is defined by
[`GCM_IV_MAX_SIZE` in the pinned native source](https://github.com/nodejs/node/blob/v24.20.0/deps/openssl/openssl/providers/implementations/include/prov/ciphercommon_gcm.h).

## Binding differences from Node 24.20

The algorithm scope is Node 24.20's, while the method's binding follows
[Web IDL §3.6](https://webidl.spec.whatwg.org/#dfn-overload-resolution-algorithm)
and [§3.7.7](https://webidl.spec.whatwg.org/#es-operations). The pinned
[Node implementation](https://github.com/nodejs/node/blob/v24.20.0/lib/internal/crypto/webcrypto.js)
differs in these observed cases, covered by authored controls:

| Call | Package result | Node 24.20 result |
| --- | --- | --- |
| Detached `supports("digest", "SHA-256")` | true | `TypeError` |
| `supports("digest", "SHA-256", -1)` | `TypeError` | true |
| `supports("invalid", "SHA-256", -1)` | `TypeError` | false |
| HKDF `deriveBits` with the third argument `"256"` | false | true |
| `supports("wrapKey", "AES-KW")` | true | false |
| OCB encryption with an empty IV | false with the Node test provider | true |

The overload is selected by the third argument's type before method steps run,
and a static Web IDL operation does not brand-check its receiver. The empty-IV
result follows §3.3's rule for known native failures: the shared OCB policy still
allows an empty IV, while this provider cannot encrypt with it. These observations
do not alter upstream tests or add named exclusions.

## Per-file evidence

[modern-supports-results.json](modern-supports-results.json) records all 125
ordered per-file outcomes, affected raw results, commands, evidence hashes and
the final six-family package gate.

| File under WebCryptoAPI | Pass | Fail | Blocked |
| --- | ---: | ---: | ---: |
| supports.tentative.https.any.js | 171 | 0 | 0 |
| supports-modern.tentative.https.any.js | 94 | 0 | 0 |

All **265 cases** move from named exclusions into the gate. Scoped and raw
affected-file runs agree. The originals, version-table entries, BSD headers,
registration counts and accepted 302 specification discrepancies are unchanged.

## Validation

```sh
pnpm install --offline --frozen-lockfile
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/crypto-supports.test.ts runtime/web-platform/test/crypto-sha3-kmac.test.ts runtime/web-platform/test/crypto-runtime.test.ts
NTS_WPT_CRYPTO_FIXTURE=WebCryptoAPI/supports node --expose-gc runtime/web-platform/test/wpt/webcrypto/report.ts
NTS_WPT_CRYPTO_RAW=1 NTS_WPT_CRYPTO_FIXTURE=WebCryptoAPI/supports node --expose-gc runtime/web-platform/test/wpt/webcrypto/report.ts
```

The install reuses eight cached packages without a dependency or lockfile change.
Both project typechecks and the strict standalone new-test typecheck exit 0.
The combined test command reports **53 tests, 53 pass, 0 fail, 0 skip**, including
28 supports controls. The ML-DSA context control covers all three parameter sets and both signature
operations: 256-byte contexts fail before any native query, while 255-byte
contexts reach an accepting capability, as §§8.4.1–2 require. The recording
capability refuses every cryptographic
operation, and its random source refuses entropy requests. Positive queries
still pass, with zero primitive calls, entropy calls or pending scheduler tasks.
A class-body getter control verifies that internal capability lookup does not
read a public `subtle` property. A separate native-vector control verifies the
worker's metadata/operation reply protocol. Native GCM controls establish the
128/129-byte IV boundary for encryption and decryption with all three AES key
widths; a recording capability confirms both lengths still reach native policy.
Typed scalar queries cover the native 2³¹−1-byte AAD limit for AES-GCM, AES-OCB
and ChaCha20-Poly1305 without allocating large buffers. The common limit comes
from [`CipherBase::SetAAD` and its `CheckSizeInt32` validation](https://github.com/nodejs/node/blob/v24.20.0/src/crypto/crypto_cipher.cc).
The new test file is registered in `check.sh`.

## Final six-family gate and exclusion audit

```sh
node --expose-gc runtime/web-platform/test/wpt/webcrypto/report.ts
sh tooling/conformance/web-platform/check.sh
```

Both commands exit 0. The complete scoped census has **35,656 pass / 0 fail /
792 excluded**, with **36,448 registrations across 122 executed files** and the
same three file-level limitations. All 34 in-scope Modern Algorithms fixture
entries are active, subject only to their documented transfer and cloning cases.

```text
WPT directory pins: 355 original files verified
tests 40429
pass 39569
fail 0
skipped 860
{"upstreamTests":2817,"applicableTests":2771,"passed":2771,"failed":0,"notApplicable":46}
check.sh: SKIPPING the compiled axis -- no compiler at .../target/release/nts.
  Host evidence alone does not show that any of this compiles.
```

A strict check of every crypto test and the native worker also passes under the
repository's `tsconfig.base.json` settings. The JSON report records its complete
verification configuration. Across the six new family test files, all **199
authored controls** execute in this final gate.

The final exclusion audit compares names, categories and reasons with accepted
#110. All **302 accepted discrepancy records remain exact**, and all **355 pinned
originals plus `versions.json` are unchanged**.

| Remaining named exclusions | Cases |
| --- | ---: |
| Accepted specification discrepancies | 302 |
| Additional repeated-name-getter transfer discrepancies | 79 |
| Native CryptoKey cloning limitations | 63 |
| Optional compressed EC points | 48 |
| Browser or global environment requirements | 17 |
| Deferred TurboSHAKE and KangarooTwelve algorithms | 283 |
| **Total** | **792** |

The 79 new transfer cases comprise SHA-3 9, cSHAKE 16, KMAC 12, AES-OCB 36
and ML-DSA 6. The clone total includes 40 existing cases and 23 newly reachable
cases. TurboSHAKE accounts for 135 deferred cases and KangarooTwelve for 148;
no in-scope algorithm retains an algorithm-scope exclusion. This pin has no
hybrid KEM fixture, so it supplies no hybrid coverage. Both IDL harness files
and the existing asynchronous-registration limitation remain file-level exclusions.

The full package log SHA-256 is `174ef95198831a574d940ffa05eebc300da74d190ea112dd75b8bbfc1b197aca`.
The final executable source was tested at `4c7af05f44d5062cc051f8a41eea690d32551bd7`,
tree `9a06d4fd11067a0b2ae2790a54a29ac153adb05e`. Only evidence documentation was added
after this gate. Maintainers supply the native half, compile with nts and run
the landing gate.
