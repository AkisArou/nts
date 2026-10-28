# ML-KEM and encapsulation

The [Modern Algorithms proposal](https://wicg.github.io/webcrypto-modern-algos/)
§§3.1.2, 3.2.1–5, 4 and 6 define this increment. It implements ML-KEM-512,
ML-KEM-768 and ML-KEM-1024, the four encapsulation/decapsulation methods, and
ML-KEM public-key extraction. The profile is the one implemented by
[Node 24.20](https://nodejs.org/download/release/v24.20.0/docs/api/crypto.html):
64-byte private seeds, raw public keys, AKP JWK, SPKI and seed-preserving PKCS8.
Hybrid KEMs remain outside this increment. The original WPT files, their hashes,
the directory revision and shared support files are unchanged.

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
outcome on the isolated ML-DSA base, plus the raw affected-file results. Ordered
stack validation is recorded separately in the pull request.

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
discrepancy is added. The accepted 302 entries and the inherited ML-DSA transfer
entries remain unchanged. `SubtleCrypto.supports` belongs to its subsequent PR.

The complete isolated census has **33,136 pass / 0 fail / 3,194 blocked**, with
three file-level limitations and no harness failures across 125 original fixture
files. There are no registration-count changes; the 122 executed files still
register 36,330 cases. These totals include earlier legacy and ML-DSA tests; they
do not claim that subsequent or separate Modern Algorithms families are present
on this temporary base.

## Validation

```sh
pnpm install --offline --frozen-lockfile
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/crypto-ml-kem.test.ts
node --expose-gc --test runtime/web-platform/test/crypto-ml-kem.test.ts runtime/web-platform/test/crypto-ml-dsa.test.ts runtime/web-platform/test/crypto-secret-key.test.ts runtime/web-platform/test/crypto-kdf-key.test.ts
node --expose-gc runtime/web-platform/test/wpt/webcrypto/report.ts
```

The install reuses eight cached packages, with no new dependency or lockfile
change. Public, WPT and strict standalone new-test typechecks exit 0. The authored
ML-KEM file has **32 tests / 32 pass / 0 fail / 0 skip**; the combined shared-key
regression run has **179 tests / 179 pass / 0 fail / 0 skip**. Controls cover all
three parameter sets, native interoperability, malformed and altered ciphertext,
raw/SPKI/JWK validation timing, PKCS8 both consistency, ownership, observable
conversion order, native failure values, non-overridable internal calls and task
settlement without timers. The new file is registered in `check.sh`.

The parent integration runs the complete package gate after stacking all prior
families. nts compilation remains a maintainer gate, distinct from these Node
results.

## Ordered integration controls

After rebasing on the first four families, the ML-KEM control file has
**42 tests / 42 pass / 0 fail / 0 skip**. The ten additional controls cover
AES-OCB, ChaCha20-Poly1305, KMAC128/256, HMAC with SHA3-512, all three Argon2
secret-key targets, the inherited private-JWK native-failure ordering, and
ML-KEM JWK/raw-seed/PKCS8 wrapping through AES-OCB. The four preceding families'
focused suites add **129 pass / 0 fail / 0 skip**. Public, WPT and strict new-test
typechecks all exit 0 after resolving the shared-file rebase conflicts.

The actual WPT gate reruns the restored encapsulation files with **129 pass /
0 fail / 0 blocked**, and ML-KEM import/export with **324 pass / 0 fail /
0 blocked**. The complete isolated census above remains labeled with its original
base; the full ordered package census is the parent integration's gate.
