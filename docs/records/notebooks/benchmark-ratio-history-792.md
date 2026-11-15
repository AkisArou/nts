# Benchmark history compares within-run ratios

The [#792 verdict](https://github.com/AkisArou/nts/issues/792) compares each backend/comparator ratio with its best strictly earlier compatible verified ratio. Each comparison carries its current ratio, best ratio and compiler/run, all four cell spreads, their product and the allowance max(1.05, product). A backend alerts only with at least one established pair and every established comparator beyond its allowance. Missing history does not vote. Individual comparator outliers remain visible without creating a nightly alert. The shared model serves Markdown and benchmark JSON v2; conformance JSON stays v1. Standing bar verdicts and immutable raw run schema are unchanged.

The retained-night replay uses exact old owners from 1e2c397948ba386c0b3e250e4aa85ed37ebb3318 and corrected source a90cecbe4840be856d780ca04b5ea0ed29c56def, in separate fresh processes over the same immutable records. Each night receives only history available by its completion. The old grouped November 15 page equals main's committed page byte-for-byte; the corrected grouped page equals the production writer's page. All 41 raw JSON files remain byte-exact. These are replays of existing measurements, not new timings.

| Night | Old alert occurrences | Old distinct cases | Ratio alert occurrences | Ratio distinct cases |
| --- | --- | --- | --- | --- |
| 2026-11-14 | 16 | 15 | 7 | 7 |
| 2026-11-15 | 83 | 78 | 21 | 18 |

Groups repeat some cases, so occurrence and distinct-case counts differ. Of tonight's original 83 occurrences, 16 still alert; of its 78 original distinct cases, 14 remain. Four additional ratio alerts are immutable-update, map-and-set, str-template and tree-teardown. The complete corrected population is 18 distinct cases, covering 25 backend alarms. Same-row supplied timing controls isolate the verdict policy using the same real row and source identities, with spreads set to one; they are component controls, not performance measurements.

| Supplied change | Old backend alarm | Ratio backend alarm |
| --- | --- | --- |
| uniform | true | false |
| node-only | false | false |
| nts-only | true | true |

The remaining historical ratio alerts below retain each flagged backend. The change is the smallest current/best ratio across its established comparators, the lower bound among those comparisons. The comparator and best compiler pin in that same minimum comparison are shown as a starting point for investigation; the other comparators can have independent best pins. This does not establish a regression between the two latest compiler pins. Full ratios, allowances, all four factors and every prior run/pin remain in the raw TSV.

| Case | Backend | Smallest change | Comparator at minimum | Best compiler at minimum | Compiler/runtime/build changes from best to measured |
| --- | --- | --- | --- | --- | --- |
| awfy-bounce | nts C | 1.17730× | Bun AOT | 6a981d6c7bfdc3267220585ee938b8c126a2630b | 228 files changed, 2907 insertions(+), 2241 deletions(-) |
| awfy-permute | nts C | 1.15861× | ScriptC | 6a981d6c7bfdc3267220585ee938b8c126a2630b | 228 files changed, 2907 insertions(+), 2241 deletions(-) |
| bytes | nts C<br>nts LLVM<br>nts JVM | 1.16925×<br>1.13350×<br>1.12321× | node<br>node<br>node | cad7d13dfbe64a89b7ee1befa8a71e82b7a21076<br>cad7d13dfbe64a89b7ee1befa8a71e82b7a21076<br>cad7d13dfbe64a89b7ee1befa8a71e82b7a21076 | 802 files changed, 160007 insertions(+), 104419 deletions(-)<br>802 files changed, 160007 insertions(+), 104419 deletions(-)<br>802 files changed, 160007 insertions(+), 104419 deletions(-) |
| clbg-k-nucleotide | nts C<br>nts LLVM | 1.17408×<br>1.18701× | ScriptC<br>ScriptC | 653fb5235a070f442c49f9c518e4ad667edd55bd<br>653fb5235a070f442c49f9c518e4ad667edd55bd | 8 files changed, 922 insertions(+), 1174 deletions(-)<br>8 files changed, 922 insertions(+), 1174 deletions(-) |
| erasure-stored-unknown | nts C | 1.06864× | Bun AOT | 6a981d6c7bfdc3267220585ee938b8c126a2630b | 228 files changed, 2907 insertions(+), 2241 deletions(-) |
| erasure-unknown | nts JVM | 1.10035× | node | 653fb5235a070f442c49f9c518e4ad667edd55bd | 8 files changed, 922 insertions(+), 1174 deletions(-) |
| face-fields | nts LLVM | 1.07006× | Bun JIT | 99915c45f18719dde781822e742e1fb0df6d39a3 | 330 files changed, 89300 insertions(+), 86891 deletions(-) |
| immutable-update | nts LLVM | 1.07097× | ScriptC | 653fb5235a070f442c49f9c518e4ad667edd55bd | 8 files changed, 922 insertions(+), 1174 deletions(-) |
| json-stringify-doc | nts C | 1.91919× | ScriptC | cad7d13dfbe64a89b7ee1befa8a71e82b7a21076 | 802 files changed, 160007 insertions(+), 104419 deletions(-) |
| logical-assignment | nts LLVM<br>nts JVM | 1.09221×<br>1.10689× | node<br>Bun AOT | 900e5e6cf8610d9ca6c1b05a201a6054af10fd51<br>e4f8d9a9bb70558b8bd7a681d7a66cc2751a3fa5 | 763 files changed, 151004 insertions(+), 103073 deletions(-)<br>none |
| map-and-set | nts LLVM | 1.11003× | ScriptC | cad7d13dfbe64a89b7ee1befa8a71e82b7a21076 | 802 files changed, 160007 insertions(+), 104419 deletions(-) |
| map-word-counts | nts C<br>nts LLVM<br>nts JVM | 1.20188×<br>1.15306×<br>1.12064× | ScriptC<br>ScriptC<br>ScriptC | 99915c45f18719dde781822e742e1fb0df6d39a3<br>99915c45f18719dde781822e742e1fb0df6d39a3<br>99915c45f18719dde781822e742e1fb0df6d39a3 | 330 files changed, 89300 insertions(+), 86891 deletions(-)<br>330 files changed, 89300 insertions(+), 86891 deletions(-)<br>330 files changed, 89300 insertions(+), 86891 deletions(-) |
| node-utf8 | nts C<br>nts LLVM | 1.06488×<br>1.16540× | ScriptC<br>ScriptC | e4f8d9a9bb70558b8bd7a681d7a66cc2751a3fa5<br>99915c45f18719dde781822e742e1fb0df6d39a3 | none<br>330 files changed, 89300 insertions(+), 86891 deletions(-) |
| optional-chain | nts JVM | 1.05637× | ScriptC | 900e5e6cf8610d9ca6c1b05a201a6054af10fd51 | 763 files changed, 151004 insertions(+), 103073 deletions(-) |
| parse-int-decimal | nts LLVM | 1.33888× | node | 99915c45f18719dde781822e742e1fb0df6d39a3 | 330 files changed, 89300 insertions(+), 86891 deletions(-) |
| parse-int-runtime | nts C | 1.44423× | node | 6a981d6c7bfdc3267220585ee938b8c126a2630b | 228 files changed, 2907 insertions(+), 2241 deletions(-) |
| str-template | nts C | 1.05331× | ScriptC | 653fb5235a070f442c49f9c518e4ad667edd55bd | 8 files changed, 922 insertions(+), 1174 deletions(-) |
| tree-teardown | nts JVM | 1.23277× | ScriptC | 653fb5235a070f442c49f9c518e4ad667edd55bd | 8 files changed, 922 insertions(+), 1174 deletions(-) |

The change column uses `git diff --shortstat <best> 312ea438435f938ccd0d63fb6e218d495afa47a1 -- compiler runtime build`; an empty diff is shown as "none". A changed file count is not evidence that code generation changed: small differences can be tests, generated-member tooling or unrelated runtime code. Thus ratio alarms can be differential engine load noise even when every comparator votes. Small scoped differences (at most 20 files) are:

- 653fb5235a070f442c49f9c518e4ad667edd55bd: `compiler/codegen/jvm/generate-members.ts`, `compiler/codegen/jvm/member-grammar.ts`, `compiler/codegen/jvm/member-scanner.test.ts`, `compiler/codegen/jvm/tests/generated_member_names.rs`, `compiler/core/src/hir/lower.rs`, `compiler/core/src/hir/lower/tests.rs`, `runtime/jvm/web-platform/android/src/main/java/org/nts/web/NetworkPrimitives.java`, `runtime/jvm/web-platform/android/src/test/java/org/nts/web/NetworkPrimitivesTest.java`.

Full scoped file lists remain in /home/akisarou/.cache/nts-scratch/792/compiler-diffs-v1.json, SHA-256 5077cba9c44757f496469da4161843471ec4b44175198331fec8f44ec2704d62.

| Validation | Result |
| --- | --- |
| Final ratio, shared-summary and nightly-consumer controls | 42/42; no skips, cancellations or TODO |
| Immutable record check, timing lint, host audit, strict tooling | Pass |
| Supported landing route | 16 summary steps PASS; canonical, no experiments; cleanup and diagnostics complete |
| Required inner route | Status 0; formatting, Clippy, fresh compiler and crate/backend tests passed |

Prior fixture and launcher failures are retained separately and support no acceptance claim. The verdict removes a uniform-load absolute-time alarm; ratios can still change under load that affects engines differently, and this replay does not attribute a compiler cause to any remaining alert.

Raw evidence: /home/akisarou/.cache/nts-scratch/792/raw-evidence-v1.json, SHA-256 23af8481785f3aad05d3a1b04ea72543d73983ada60e5f600695a1b1fa8fa57d. The finite manifest binds the selected control/replay/proof artifacts and immutable Git source receipts. Detailed comparator table: /home/akisarou/.cache/nts-scratch/792/replay-v4/tonight-alerts.tsv, SHA-256 dcbfc1b518ab101abd8fcc8547175dc1e9ceec76397036d4d0c80e266eb3e821. Proof source: a90cecbe4840be856d780ca04b5ea0ed29c56def.
