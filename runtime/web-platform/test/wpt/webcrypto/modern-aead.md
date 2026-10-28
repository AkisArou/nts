# AES-OCB and ChaCha20-Poly1305

The package implements [Modern Algorithms §§10–11](https://wicg.github.io/webcrypto-modern-algos/#aes-ocb)
over its existing synchronous native crypto capability. This family stacks after
SHA-3, cSHAKE and KMAC in the Modern Algorithms series, whose base is #110.

## API and native contract

`AES-OCB` and `ChaCha20-Poly1305` register encryption, decryption, generation,
import, export and the internal get-key-length operation. Wrapping and unwrapping
use their encryption/decryption registration, and `deriveKey` imports derived
material using `raw-secret`.

AES-OCB keys have 128, 192 or 256 bits. Its IV is at most 15 octets and its
authentication tag has 64, 96 or 128 bits, defaulting to 128. ChaCha20-Poly1305
has a 256-bit key, a 12-octet nonce and a 128-bit tag. ChaCha keys expose the
plain `KeyAlgorithm` dictionary, without an AES-style `length` member. Both
algorithms support `raw-secret` and JWK; their legacy `raw` format is rejected.
JWK identifiers are `A128OCB`, `A192OCB`, `A256OCB` and `C20P`.

The new `CryptoAeadParameters` member of `CryptoCipherParameters` carries the
algorithm, IV, additional data and bit tag length. The existing `encrypt` and
`decrypt` methods remain whole-input operations. They perform all encryption
and authentication natively. Native ciphertext and tag are separate so shared
code can concatenate or split the API's combined result. Authentication failure
returns a failure value and exposes no partial plaintext. No native method,
cryptographic primitive, npm dependency or source-tree Node import is added.

The [Node 24.20 test provider](https://nodejs.org/download/release/v24.20.0/docs/api/crypto.html#cryptocreatecipherivalgorithm-key-iv-options)
uses `createCipheriv` and `createDecipheriv` from `node:crypto`. Node/OpenSSL
rejects an empty AES-OCB IV, while §10.4 only rejects lengths above 15 octets.
This remains a test-provider limitation: the shared code forwards an empty IV
to the capability and maps its failure value to `OperationError`. Paired native
and recording-provider controls verify the distinction. All positive IV lengths
from one through 15 octets, each AES key width and all three OCB tag lengths are
checked against Node 24.20's Web Crypto output.

## WPT selection and results

The pin remains `ec2fee39a4ca3c13afd55236795547eedd7f165d`; all original bytes,
licence headers and the shared `versions.json` entries are unchanged. Exactly
1,398 former exclusions become runnable in this family. The following counts
are actual case registrations, excluding file wrappers.

| File under `WebCryptoAPI/` | Pass | Fail | Blocked |
| --- | ---: | ---: | ---: |
| `encrypt_decrypt/aes_ocb.tentative.https.any.js` | 241 | 0 | 36 |
| `encrypt_decrypt/chacha20_poly1305.tentative.https.any.js` | 28 | 0 | 0 |
| `generateKey/failures_AES-OCB.tentative.https.any.js` | 774 | 0 | 0 |
| `generateKey/failures_chacha20_poly1305.tentative.https.any.js` | 500 | 0 | 0 |
| `generateKey/successes_AES-OCB.tentative.https.any.js` | 288 | 0 | 0 |
| `generateKey/successes_chacha20_poly1305.tentative.https.any.js` | 192 | 0 | 0 |
| `import_export/AES-OCB_importKey.tentative.https.any.js` | 72 | 0 | 0 |
| `import_export/ChaCha20-Poly1305_importKey.tentative.https.any.js` | 24 | 0 | 0 |
| `serialization/aes-ocb.tentative.https.any.js` | 0 | 0 | 3 |
| `serialization/chacha20-poly1305.tentative.https.any.js` | 0 | 0 | 2 |
| **Total** | **2,119** | **0** | **41** |

The raw AES-OCB run reports **241 pass / 36 fail / 0 blocked**. Those 36 cases
transfer the same buffer from both `name` getter calls. [Web Crypto
§18.4.4](https://w3c.github.io/webcrypto/#algorithm-normalization) and [Web IDL
§3.2.17](https://webidl.spec.whatwg.org/#es-dictionary) require both conversions;
the second transfer therefore throws. These newly exposed cases have the same
disagreement as [w3c/webcrypto#563](https://github.com/w3c/webcrypto/issues/563).
They are separately classified and do not change the 302 previously documented
discrepancies. New package controls assert both conversions and their exception.

The five serialization cases require native CryptoKey structured cloning. They
remain blocked under that existing limitation, replacing their earlier algorithm
scope classification. No descriptor behavior or native cloning is fabricated.
The `supports` cases stay with the final Modern Algorithms PR.

Successful AEAD key setup also adds 115 registrations to the shared wrapping
fixture on the isolated #110 base: **472 pass / 0 fail / 0 blocked**. The final
stack records its combined registration expectation after its prerequisite
families are present. [Machine-readable family evidence](modern-aead-results.json)
retains the exact raw failures, per-file counts and evidence-log hashes.

## Validation

Node 24.20.0, pnpm 10.15.0 and locked TypeScript 7.0.2:

```sh
pnpm install --offline --frozen-lockfile
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/crypto-modern-aead.test.ts
```

Install reused the eight cached packages with no lockfile change. Both project
typechecks exit 0 without diagnostics; the new test file also passes strict
standalone typechecking. Its **39 tests pass**, with zero failures and skips.
They cover the RFC 7253 Appendix A and RFC 8439 §2.8.2 known answers, all native
IV/key/tag widths, metadata and JWK policy, usage/error precedence, buffer
ownership and offsets, normalization, wrapping, derivation, scheduled failures,
authentication tampering and native failure/result contracts.

```sh
node --expose-gc --test runtime/web-platform/test/crypto-modern-aead.test.ts \
  runtime/web-platform/test/crypto-aes.test.ts \
  runtime/web-platform/test/crypto-secret-key.test.ts \
  runtime/web-platform/test/crypto-kdf-derive.test.ts
```

The combined regression run reports **210 tests / 209 pass / 0 fail / 1 existing
intrinsic-reflection skip**. Every new test is registered in `check.sh`.

The ordinary scoped report runs with:

```sh
node --expose-gc runtime/web-platform/test/wpt/webcrypto/report.ts
```

The first complete census exposed the shared wrapping count change; its focused
follow-up verifies the updated expectation. The PR's final full package gate
records the combined stack results. Maintainers compile with nts and run the
native gate; ordinary Node evidence does not establish compiled support.
