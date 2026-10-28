# SHA-3, cSHAKE and KMAC

The first Modern Algorithms increment follows
[Modern Algorithms in the Web Cryptography API](https://wicg.github.io/webcrypto-modern-algos/)
§§2.1, 3.1.1, 12, 13 and 16, over the same native primitive capability as the
accepted Web Crypto stack. SHA3-256, SHA3-384 and SHA3-512 are fixed-size native
digests. cSHAKE128 and cSHAKE256 expose the required bit length and optional
function-name/customization bytes. KMAC128 and KMAC256 support generation,
raw-secret/JWK import/export, sign, verify, deriveKey targets and wrapping.

The original imported fixtures and their shared version table are unchanged.
The complete scoped census has **31,684 pass, zero fail and 4,646 excluded**,
with 36,330 registrations across 122 executed files and the same three
file-level limitations. This activates 693 formerly excluded cases. The accepted
302 specification-disagreement cases remain unchanged. Enabling these families
exposes 37 more cases of the already documented repeated-name-getter transfer
disagreement: 9 in SHA-3, 16 in cSHAKE and 12 in KMAC. Each new exclusion names
its exact case and cites Web Crypto §18.4.4, Web IDL §3.2.17 and
[w3c/webcrypto#563](https://github.com/w3c/webcrypto/issues/563).

| File under `WebCryptoAPI/` | Pass | Fail | Excluded |
| --- | ---: | ---: | ---: |
| `digest/sha3.tentative.https.any.js` | 39 | 0 | 9 |
| `digest/cshake.tentative.https.any.js` | 72 | 0 | 16 |
| `generateKey/failures_kmac.tentative.https.any.js` | 552 | 0 | 0 |
| `generateKey/successes_kmac.tentative.https.any.js` | 144 | 0 | 0 |
| `import_export/KMAC_importKey.tentative.https.any.js` | 144 | 0 | 0 |
| `import_export/raw_format_aliases.tentative.https.any.js` | 12 | 0 | 8 |
| `sign_verify/kmac.tentative.https.any.js` | 91 | 0 | 12 |
| `serialization/kmac.tentative.https.any.js` | 0 | 0 | 6 |

The eight raw-public alias cases belong to the later asymmetric-key increment.
The six KMAC serialization cases require native CryptoKey structured cloning;
they retain explicit capability exclusions after successful key generation.
KMAC setup registers its ordinary test names once key import succeeds, replacing
the earlier import-failure placeholder names without changing its 103-case count.

## Native contract and Node test provider

`CryptoDigestName` adds the three SHA-3 names. `CryptoCshakeParameters` and
`CryptoProvider.digestXof` carry a complete input plus cSHAKE N, S and output
length to native code. `CryptoKmacParameters` carries the key's logical bit
length, customization and output bit length through sign/verify. Verification
returns `boolean | CryptoFailure`, distinguishing an invalid signature from an
operation failure; all existing shared verification operations map the latter
to `OperationError` without changing invalid-signature results.

The test provider uses `node:crypto.createHash` for SHA-3 and SHAKE-equivalent
cSHAKE. Node 24.20 exposes customized cSHAKE and KMAC through internal native
`CShakeJob`/`KmacJob`, rather than public synchronous functions. One persistent,
unreferenced test worker exposes those native jobs with `--expose-internals` and
runs them in synchronous mode. A MessagePort transfers whole requests/results;
an Atomics notification completes the caller's synchronous capability call.
The 60-second watchdog only prevents an unavailable worker from hanging the
standalone census. No test outcome depends on elapsed time. No Node Web Crypto
method or TypeScript cryptographic primitive is used.

Native job argument layouts come from pinned Node sources:

- [`lib/internal/crypto/hash.js`](https://github.com/nodejs/node/blob/v24.20.0/lib/internal/crypto/hash.js)
- [`lib/internal/crypto/mac.js`](https://github.com/nodejs/node/blob/v24.20.0/lib/internal/crypto/mac.js)
- [`src/crypto/crypto_hash.cc`](https://github.com/nodejs/node/blob/v24.20.0/src/crypto/crypto_hash.cc)
- [`src/crypto/crypto_kmac.cc`](https://github.com/nodejs/node/blob/v24.20.0/src/crypto/crypto_kmac.cc)

The public profile follows Node 24.20's supported families. Explicit-length
SHA-3 HMAC keys work; omitted generation/derived-key length is unsupported,
as in Node's public profile. SHA-3 RSA/HMAC JWK export has no registered JOSE
algorithm mapping and preserves the base specification's `NotSupportedError`.
XOF digests are rejected as nested RSA/HMAC/ECDSA/KDF hashes.

KMAC output uses the byte-oriented profile explicitly permitted by §16.6:
non-multiples of eight reject with `NotSupportedError`. KMAC's output length is
part of its native domain separation, so rounding that parameter would compute
another MAC. The pinned native job keeps high bits for partial output, which
does not implement §2.1's low-bit Keccak encoding. A direct native control with
key bytes 0x40 through 0x5f, message `[0]`, and one output bit returns `[128]`;
the specification permits only `[0]` or `[1]`. cSHAKE output can safely request
whole native octets and apply its low-bit encoding to the final octet because
its requested output length does not alter the XOF prefix.

Zero-bit KMAC output and empty keys are permitted. Verification uses native
KMAC followed by `node:crypto.timingSafeEqual`, including empty signatures:
the pinned `KmacJob` verify path otherwise hardcodes false for empty output.
KMAC key storage keeps the requested low bits and clears unused high bits;
key generation uses RandomSource, and no hash/MAC framing enters TypeScript.

Native test-provider ceilings remain provider failures, not shared API limits:
cSHAKE/KMAC customization above 512 bytes, KMAC secret storage above 512 bytes,
and KMAC output above 2,097,151 bytes fail. Customized cSHAKE cannot ask the
pinned uint32 native job for rounded output above 4,294,967,288 bits. The shared
layer forwards allowed typed inputs and maps failures to `OperationError`.
Tests cover the provider limits without making them specification requirements.

## Validation

With Node 24.20.0, pnpm 10.15.0 and locked TypeScript 7.0.2:

```sh
pnpm install --offline --frozen-lockfile
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/crypto-sha3-kmac.test.ts
node --expose-gc --test runtime/web-platform/test/crypto*.test.ts
node --expose-gc runtime/web-platform/test/wpt/webcrypto/report.ts
```

The focused specification controls pass 17/17. All crypto tests report
1,212 total / 1,197 pass / zero fail / 15 previously recorded skips. Both
project type checks and a strict check of all crypto tests plus the native
worker pass. The scoped census exits zero with the totals above. Before their
specification classification, the newly enabled digest and KMAC signing runs
expose exactly the 37 transfer discrepancies stated above.

## Complete package gate

`sh tooling/conformance/web-platform/check.sh` exits 0 on the integrated family:
40,129 tests / 35,415 pass / 0 fail / 4,714 skips; the existing upstream axis
reports 2,817 tests / 2,771 pass / 0 fail / 46 not applicable. All 355 imported
originals verify. The compiled axis is explicitly skipped because nts is not
available. Maintainers still compile and run the landing gate.

`modern-sha3-kmac-results.json` records all 125 original file outcomes and the
complete package result, including the §16.7.2 correction that preserves native
KMAC verification failures as values. The full-check log SHA-256 is `c3c0f3f7ce11e528f621ff29c01d08fe9202e17695bf4a5bf33259d5addef7cd`.
