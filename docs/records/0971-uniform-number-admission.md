# A NaN-only uniform input admits no ordered number

Issue #971 found wrong admission at an erased numeric entry. A computed enum
member, `enum E { Value = 0 / 0 }`, gives a parameter typed `E.Value` a NaN
literal type. Its known fact has `lo = +Infinity`, `hi = -Infinity` and
`maybe_nan = true`. The entry's numeric arm skipped both infinite endpoints,
so it admitted whole numbers too. `typeof NaN` and a NaN default instead have
the full number type and do not establish this reachability.

The fix rejects the numeric arm once when `lo > hi`. For nonempty intervals,
only the outward-facing endpoints (`lo = -Infinity`, `hi = +Infinity`) omit a
comparison. This also enforces singleton infinities. The independent NaN arm,
whole-number test and negative-zero test keep their existing behavior.

The observed defect is wrong admission, not an observed wrong answer. The
permanent programs fixture uses admitted calls only. The calls outside the
declared parameter contract are private probes whose expected result after
the fix is a named uniform mismatch.

## Compilers and controls

The main compiler was pinned at
`2017bf23a3de7f0d28da263d6403b519735517cd`; the candidate was pinned at
`89945f0961d1a602b77bdd365a45fc6bb7cb3619`. Both pins have clean provenance.
Their binary SHA-256 digests are respectively
`587b9d788f8b76db15e2f6ec850d05d05198b7260a234be72ea35b43e911a133`
and `85db3240117d819953ed795ca14abe8646bc5e4e74908a0f3dad93e3e48d4ae7`.

`tests/programs/a-uniform-input-known-only-as-nan` contains the computed NaN
enum and a literal enum control, plus the `typeof`/default controls and valid
singleton-infinity calls. Production oracle preparation and differential
checking compared all eight calls with node on each backend:

| Backend | Main | Candidate |
| --- | --- | --- |
| C | 8/8 agree | 8/8 agree |
| LLVM | 8/8 agree | 8/8 agree |
| JVM | 8/8 agree | 8/8 agree |

There were no refusals, declines, unavailable cases or timeouts. This fixture
is a reachability and compatibility control; passing on both pins means it
does not by itself test the fix.

The private C probes each pass zero through an erased signature to one of
three declared facts:

| Declared member | Main | Candidate |
| --- | --- | --- |
| NaN only | admitted | named uniform mismatch |
| Positive infinity only | admitted | named uniform mismatch |
| Negative infinity only | admitted | named uniform mismatch |

Each candidate diagnostic names the callee and parameter `x`, saying that the
argument is not admitted. These are deliberate contract violations, not
node-agreement results.

## Guard counterfactual

Four unit tests execute the emitted guard CFG over representative finite
values, both zero signs, both infinities and NaN. They cover empty intervals,
singleton infinities, finite bounds, NaN permission, wholeness and negative
zero. The unbounded control also asserts that `[-Infinity, +Infinity]` emits
no ordered interval comparison.

After committing the fix, only its interval-guard block was replaced with
main's old skip, keeping the new tests. Two tests failed: the NaN-only guard
admitted negative infinity, and the negative-infinity singleton admitted
minus one. The finite and unbounded controls passed. Restoring the saved
fixed file and rebuilding passed all four tests. The saved source digest is
`9c55836faa5b2e16f70928c4b4119fa47eaf0a66465735cfaa0780d2edaecef7`.

## Instruction counts

`nts-bench --count uniform-callback` ran before and after with plain release
workspace builds. The before arm restored only the old interval-guard block;
both arms retained the rest of the committed candidate. Prepared HIR and the
row's generated C and LLVM source were byte-identical. The row invokes
erased numeric entries, whose full-number facts need no interval comparison.

| Column | Before | After | Header noise band |
| --- | ---: | ---: | ---: |
| nts C | 14,392 | 14,392 | 1 basis point |
| nts LLVM | 14,900 | 14,900 | 1 basis point |
| nts JVM | unmeasured | unmeasured | 968 basis points |

Both JVM count attempts failed the count driver's one-operation net-count
calibration. They provide no JVM performance result. The semantic JVM
fixture result above is independent of that instrumentation failure.

## Compatibility checks

The production prepared-HIR/refusal comparison ran each project through its
own `hir-compare` admission case. All 29 runtime projects compared against
the same two pins, with no function-state changes, refusal-count changes or
moves to a loss. This comparison measures compilation reach, not answer
equivalence or byte-for-byte equality of all generated programs.

That tool's default at this commit selects only the 29 runtime projects. The
full comparison uses an explicit manifest of all 2,266 `tsconfig.json`
projects under `tests/programs` (1,119), `tests/refusals` (563),
`tests/outcomes` (505) and `runtime` (79). The manifest is
`~/.cache/nts-scratch/971/hir-full-projects.json`, SHA-256
`f50bb3289c20c615072fc563dbc71505ddcc5b9ae23f4d4c454b40e7d6062709`.
The full run compared 2,020 projects with zero function-state moves and zero
losses. Another 246 projects had no prepared listing on either pin:

| Root | Symmetric no-listing projects |
| --- | ---: |
| tests/programs | 1 |
| tests/refusals | 0 |
| tests/outcomes | 229 |
| runtime | 16 |

These 246 are not reported as fully measured comparisons. Their symmetric
absence cannot hide a function appearing or disappearing between the pins;
the tool does not classify the reasons for that absence. The exact project
list is retained in `hir-full-unmeasured.json` alongside the full report.

A ten-project sample reran both commands against both pins under per-project
admission. Its no-listing causes were normal diagnostics, not crashes,
timeouts or failed admission:

| Sample reason | Projects | Examples |
| --- | ---: | --- |
| Outcome harness symbols `observe`/`done` absent from a bare project | 5 | `parse-int-with-radix-ten`, `typeof-a-call-drops-the-call` |
| Runtime imports unresolved before preparation | 3 | `runtime/gtk`, React host-components fixture, React package |
| Intentional type errors | 1 | `tests/programs/invalid` |
| Config requires an explicit product | 1 | `runtime/chromium/embedder/program` |

These sample counts are not extrapolated to all 246 projects. Every sampled
HIR invocation returned a normal exit 1 with its diagnostic on both pins.
The classification and raw outputs are covered by
`~/.cache/nts-scratch/971/hir-classification-SHA256SUMS`, SHA-256
`ea5fdf9dd059f4b7648516bca636cc2c06ca68ee2b9482e8bd58e5727d7df6ee`.

The product-selection case was rerun explicitly: `probe` with C preparation
and `probe-llvm` with LLVM preparation both produced successful listings on
both pins. Production `states`/`moves` classified zero moves and zero losses
for each product. As in the production comparison, the refusal side uses
the project-wide `nts refusals` command; that command rejects `--product`.
The successful project-wide refusal outputs from the preceding sample were
used with the product-specific HIR listings. These are additional product
comparisons, not additions to the 2,020 default-project comparisons.
Their exact inputs, outputs and analysis are covered by
`~/.cache/nts-scratch/971/hir-qualified-products-SHA256SUMS`, SHA-256
`0f9e84ca1ac2e2223720772c82ac9bcdc48ad7afa2398119efd8085b317efef2`.

All five C test262 records were measured against the candidate pin, using
`conformance262.ts --under <directory> --recorded <record>` under the
`test262-records` admission key. Each run's instrument self-checks passed,
its outcomes reconciled and its record comparison returned zero:

| Record | Cases | Regressed | Changed | Missing |
| --- | ---: | ---: | ---: | ---: |
| language | 8,401 | 0 | 0 | 0 |
| built-ins | 1,085 | 0 | 0 | 0 |
| annexB | 12 | 0 | 0 | 0 |
| staging | 59 | 0 | 0 | 0 |
| harness | 17 | 0 | 0 | 0 |

There were also no fixed, new-pass or new-fail rows. These are comparisons
with the existing records, not claims that every selected case passes.
Logs, measured rows and invocation inputs are covered by
`~/.cache/nts-scratch/971/test262-proof-SHA256SUMS`, SHA-256
`f41a5f9be3d18a036ea57ee1d12344e5a2932d172e180213a0cbdfcbcd64cfef`.

`inner.ts --no-agree` passed with Node 26.13.0: formatting, strict workspace
Clippy, a fresh compiler build and the selected compiler/backend tests.
Across 27 test binaries, 1,988 tests passed, none failed and one was ignored.
All four guard tests passed in that run as well.

## Raw evidence

All paths below are relative to `~/.cache/nts-scratch/971/`. Raw machine
output remains there. The initial short reachability unit expired while
waiting for admission, before any program ran; `admission-note.txt` records
that distinction. It was rerun with a longer unit bound.

| Evidence | SHA-256 |
| --- | --- |
| `reachability.hir` | `eba131cf154a11a389d7fa231f4a56cc16483ca54c4386f0f54b5af9d973ba27` |
| `reachability.types` | `dd6a0caf228fc5dd7cdbe9435c7a863611abfdf7397dfac5ea7b5d7c2d7923b8` |
| `old-guard.diff` | `580ea6b3b1f2dec8b6ee0c3c6b984cc69252fb168846f16b17319c77530dbf11` |
| `old-guard-tests.log` | `939a2134c1729edef55f8069faf621fc73b43c060bacedd8c2ea9fea0c262dfe` |
| `fixed-guard-tests.log` | `17f6f24300650f5af910c594110a922e6a44fedad8edc9b7b13ac03c1426a7fc` |
| `before-controls-summary.json` | `a122ffa9dbf094c53baa8cce1345609f4c150168de58fadfeb812adb5457b88d` |
| `after-controls-summary.json` | `a122ffa9dbf094c53baa8cce1345609f4c150168de58fadfeb812adb5457b88d` |
| `negative-before.log` | `53b14efc416d4d482018db0cdf52694f7d9cf5db7f54307d34e4f96d5024fa42` |
| `negative-after.log` | `bf4f364d047dcf6d4999467c4525dbdd035295b4e5bfc83a6457d17fecd459e2` |
| `negative-probes-SHA256SUMS` | `c3119077351025c5d9c66a519a91d9b441d8decd9f8cc5a1bc8433a76938dea5` |
| `before-count.log` | `6172b7f2a16b2313527c7106cf091c0d1229322e19b7445892f47dd26d85cc37` |
| `after-count.log` | `0b6099ff91871a97fbda3bbd236e9a2dbc888d361c03aa810d688514a378b877` |
| `before-count-data/SHA256SUMS` | `3a65400ea2ec07641b29b6db732a73754cf580dde2396482982c6168eb7f9e12` |
| `after-count-data/SHA256SUMS` | `7da7aa51eb88f510100b12e345408943f4fe53d7ca8656852f2eae278fcf4de0` |
| `hir-compare.log` | `82166e224b1ade13af595a2281ad577bea8255be7cde14fdc28a8ad950428683` |
| `hir-full.log` | `3b455c3feea9283e074bf88feb769bd0e675a9e9615a7ed6e66d81d8dcdca4b5` |
| `inner-final.log` | `3be7fa84fdaffc8d871fe6a67f2bc81e12539ecada69c68ecbadd64550026281` |

The count-data manifests cover the generated source and raw count data.
`negative-before/` and `negative-after/` retain each probe's source, emitted
C, node output and named runtime diagnostic, covered by the negative-probes
manifest. `controls/` is the exact fixture
copy used by production differential checking, without writing an official
fixture oracle record.
