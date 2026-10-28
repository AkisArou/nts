# ML-DSA and getPublicKey

The [Modern Algorithms proposal](https://wicg.github.io/webcrypto-modern-algos/)
§§3.1.1, 3.2.5, 5 and 8 define this increment. It implements ML-DSA-44,
ML-DSA-65 and ML-DSA-87 within Node 24.20's seed-preserving profile, and
`getPublicKey` for the implemented asymmetric algorithms. ML-KEM follows in
its own stacked increment. The original WPT files and directory pin are unchanged.

The native contract adds module-lattice key metadata, generation, raw public and
seed imports, seed exports, pure ML-DSA signature parameters and public-handle
derivation. Native key generation retains the seed. A PKCS8 `both` import validates
that its expanded private key is the native expansion of its seed. Shared code
checks exact DER envelopes, absent algorithm parameters, OIDs, encoded lengths,
JWK `AKP`/`alg`/`pub`/`priv` policy, permissions and extractability. Public extraction
never exports private material, and does not consult overridable public methods.

The Node test provider uses `node:crypto` key generation, signing, verification
and key construction. Its PKCS8 export adaptation emits the specified seed-only
encoding instead of Node's default `both` encoding. All key expansion,
signature work and private-material comparisons are native. Failure values stay
distinct from invalid-signature `false` results.

Raw public and seed formats are algorithm-specific. `raw-public` is also the
specified alias for existing asymmetric raw formats. `raw-private` is recognized
by Web IDL but unsupported for these algorithms. Expanded-only ML-DSA PKCS8
imports return `NotSupportedError`; malformed DER returns `DataError` first.

## Focused evidence

`modern-ml-dsa-results.json` records all 125 per-file outcomes for the isolated
increment on #110 and the six newly reachable transfer discrepancies. It is
supplemented by ordered-stack validation in the pull request.

| File under WebCryptoAPI | Pass | Fail | Blocked |
| --- | ---: | ---: | ---: |
| generateKey/failures_ML-DSA.tentative.https.any.js | 516 | 0 | 0 |
| generateKey/successes_ML-DSA.tentative.https.any.js | 108 | 0 | 0 |
| import_export/ML-DSA_importKey.tentative.https.any.js | 180 | 0 | 0 |
| sign_verify/mldsa.tentative.https.any.js | 52 | 0 | 6 |
| serialization/mldsa.tentative.https.any.js | 0 | 0 | 6 |
| getPublicKey.tentative.https.any.js | 31 | 0 | 6 |

The getPublicKey blocks are the six ML-KEM cases belonging to the next increment.
Serialization needs native CryptoKey cloning. The six signature discrepancies
transfer the same buffer from both required `name` conversions, matching the
existing Web Crypto §18.4.4/Web IDL §3.2.17 disagreement discussed in
[w3c/webcrypto#563](https://github.com/w3c/webcrypto/issues/563).
They are additional to the accepted 302 entries, which remain untouched.
Raw signature evidence is 52 pass / 6 fail; the originals are not changed.

```sh
pnpm install --offline --frozen-lockfile
pnpm exec tsc --project tooling/conformance/web-platform/tsconfig.json --pretty false
pnpm exec tsc --project runtime/web-platform/test/wpt/tsconfig.json --pretty false
node --expose-gc --test runtime/web-platform/test/crypto-ml-dsa.test.ts
node --expose-gc runtime/web-platform/test/wpt/webcrypto/report.ts
```

Focused specification controls: 28 tests / 28 pass / 0 fail / 0 skip.
Public, WPT and strict standalone new-test typechecks exit 0. The scoped census
plus the rerun after classifying the six exact transfer cases yields 31,525 pass /
0 fail / 4,805 blocked, with three file-level limitations and no harness failures.
The package-wide check and nts compilation are distinct from this evidence.
