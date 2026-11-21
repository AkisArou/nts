# Stored callbacks and rejected message objects

The reaction-site guard from e60a93b9b2 is correct: a handler's throw rejects
its result. It exposed a reporting gap. The C unhandled-rejection reporter
called `nts_uncaught(reason, NULL)` and the JVM called `uncaught(reason, null)`;
the ordinary synchronous throw had supplied the message directly. The value
was preserved, but the reporters had no projection for its fixed string field.

The fix retains both catch-role changes and takes only the message-projection
slice of 3e8c1cab3. `Layout::message_field()` owns membership. Native descriptors
publish its byte offset, and JVM allocation classes publish `NtsThrownMessage`.
The common reporter reads the actual object's field at reporting time. No
message is copied into promises, and no getter or coercion is invoked.
`compiler/semantic-schema` is unchanged; its current version is 56.

## Reproduction

The existing outcome `promise-all-over-each-kind-of-result` reports through a
throw from its last reaction. Node reports:

```text
nts: uncaught Observed: numbers=421;strings=ab;erased=3,s,true;booleans=tft;
```

The clean e60a93b9b2 pin reports only `nts: uncaught Observed`. Both exit 1.
The full check's sealed outcome run first found this at line 17 of
`~/.cache/nts-full-check/runs/core-e60a93b9b2ff-20261120T175826Z/outcomes.log`
(SHA-256 `cc229644b92cb1bf38bb6c05826ed9fc6b2cf184631a2ba9df85cecd1d6e2c2f`).

Live reproduction uses the clean e60a93b9b2 and 9520f013ab80 pins. Raw evidence
is under `~/.cache/nts-scratch/478/reland-20261121/`. The official
`prepareOracle`/`observeOutcomeNode` observation is `actual-node.json`
(SHA-256 `dee961c2d70df82a245cc517b243faa8c54cd2b16a156ff0aec7b17835633e35`).
`old-c.stderr`, `old-llvm.stderr` and `old-jvm.stderr` each have SHA-256
`7915d55b0f20edf2076934e64e112f659d3042faff0d7dc19b89060a9c041740`.
Their adjacent `.diff` files contain the complete one-line difference.

The original sealed full-check run supplies e60's oracle evidence. Its compiler
cannot use the current producer for the exported-function control: the
authenticated `command-entry/instrument.ts` identity changed. This is an
instrument refusal, not a failed program comparison. The standalone outcomes
entry's separate preparation failure is tracked by #850.

## Focused proof

The implementation pin is `44b0e451627f5f1bb521d8d773706886198dbb3f`. A
counterfactual keeps its catch roles and removes only message publication:
`44b0e451627f+fc7bdd8b6f9b`. Its owner-recorded patch is
`without-projection-standard.patch`, SHA-256
`fc7bdd8b6f9bde6293a99886caff1fdb48146b72ae13ae9396e587e9ab1221b5`.
It reverses 16 publication/runtime files, including the tracked jar, without
changing semantic schema or the shared HIR membership predicate.

| Comparison | C | LLVM | JVM | C-RC |
|---|---|---|---|---|
| promise-all outcome, implementation | full node line | full node line | full node line | full node line |
| same outcome, publication removed | message lost | message lost | message lost | message lost |
| promise-all exported control | 116/116 agree | 116/116 agree | 116/116 agree | 116/116 agree |
| #862 override outcome | 5/5 agree | 5/5 agree | 5/5 agree | 5/5 agree |
| each new callback fixture and control | 29/29 agree | 29/29 agree | 29/29 agree | 29/29 agree |

The new fixtures have no repository oracle records yet. Their initial checks
were correctly pending and compared nothing. Fresh comparisons used the
production project materialiser to copy their exact source bytes and compiler
options into issue scratch, then `runCheck` with the sealed current producer.
No count record was written. Main disagrees on 13 of 29 stored-callback cases
and 6 of 29 named-promise cases, while both quiet controls agree on all 29.
All fresh candidate comparisons have zero refusals and declines.

The eight pre-existing callback outcomes also agree, including their declared
LLVM/JVM variants. A real reference-counting build repeats the original e60
loss and main's complete message; native RC linking explicitly defines
`NTS_PROVIDER_RC` as well as preparing with `--rc`.

Raw focused observations are `focused/rows.json`, SHA-256
`dc4ff27a1a3e50dc08974aac50bee925035632fe612bc96a58334ab76e212001`.
Fresh fixture comparisons are `fresh-probes-rows.json`, SHA-256
`132ee4e6b25501e7f8798f449e59ed4ed5e19e830924b665625342b02435d7b3`.
The prepared outcome projects and node observations are identified by
`focused-manifest.json`, SHA-256
`59572a77620c77709edeed47b204e915d5f3596578a1d25bbeec0eccfd9b0cdd`.
All paths in this section are relative to the kept scratch directory above.

## Linked size and descriptor agreement

The same promise-all source is linked from both pins with Clang and the
bundled native dependencies. Removing only message publication isolates its
cost from the catch-role changes. The linked ELF file sizes stay unchanged
because of padding; the allocated section sizes from `size` change as follows.

| Arm | Text bytes added | Data bytes added | BSS bytes added | Linked file bytes |
|---|---:|---:|---:|---:|
| C | 48 | 232 | 0 | 691384 |
| LLVM | 48 | 96 | 0 | 688048 |
| C-RC | 48 | 232 | 0 | 696472 |

The tracked runtime jar grows from 165065 to 165411 bytes. It is rebuilt by
`runtime/jvm/build.sh` with the JDK declared by `runtime/jvm/jdk.txt`.
The representative JVM program retains 19 emitted classes, whose total bytes
grow from 26759 to 26865. Only `Observed.class` changes: `javap -p -c` shows
the added `NtsThrownMessage` interface and its direct field-reading method;
the existing constructor's constant-pool index changes accordingly. The two
disassemblies are `without-observed-javap.txt` and
`candidate-observed-javap.txt` in the same scratch directory.
Their SHA-256 digests are respectively
`d1df45f3405e5456ff5e4e2363c9d865be853d74de10ffb462ae1dc1796adde3`
and `46d2cee768df559fa2f6521b8fe5f34784f039444b66650c7eb65dc893787351`.
The per-class and runtime-jar byte counts and hashes are
`jvm-artifact-sizes.json`, SHA-256
`badc78bb672bf6618c48aa05ec570a26d221fd8731f69f81d61268f58a234a41`.

The extended C/LLVM `typed_release` integration checks descriptor size, the
existing release/trace offsets and the new message-offset slot. It executes
the actual projection through an outer landing on both emitters and both
memory providers. JVM integration executes synchronous and rejected objects,
distinct classes sharing a layout, a message after a differently typed field,
mutation before reporting, primitive throws and authored/inherited facade
names. Missing and non-string fields publish no projection protocol.

No C helper is added or retyped. The four helper tables retain their current
rows; their agreement tests, raising-effect coverage and descriptor integration
checks pass in the complete `inner.ts --no-agree` run. Its raw log is
`inner3.log`, SHA-256
`615effc6c64282ffbc0d1c86da10ed347c59fac8856807e24d3d417195fe028e`.

## Corpus HIR and emitted differences

The `hir-compare` admission key covers every runtime root and valid
`tests/programs` root. `tests/programs/invalid` is the deliberate type-error
input for the frontend correctness gate, not a compilable control. The
comparison uses the same main, implementation and publication-disabled pins
as the focused proof. Completed batches are retained when admission is resumed;
at most four projects run together.

| Corpus | Projects | HIR changed from main | HIR changed by publication | C output changed | LLVM output changed | Other native changes |
|---|---:|---:|---:|---:|---:|---:|
| Runtime | 29 | 21 | 0 | 28 | 29 | 0 |
| Programs | 1106 | 6 | 0 | 874 | 1106 | 0 |

All 1135 projects emit both native outputs in the comparison. Removing only
the appended descriptor initializer (`0u` or the fixed field's `offsetof`) makes
every C output byte-identical to the publication-disabled output. The LLVM
normalization removes only the descriptor type's trailing `i32` and its
initializer. There are no other native differences. The HIR changes against
main retain the catch-role change; publication itself changes none.

Before the capture-storage correction below, the JVM inventory covers 40424
generated classes and adds 4625 reserved message-projection methods. It otherwise
preserves the class and method inventory. The representative disassembly above
shows the corresponding interface and direct field read.

Raw results are under `hir-emission/` in the same kept scratch directory:

| File | SHA-256 |
|---|---|
| `rows.json` | `e7a622b12b5f0d0f380b3618d9063b7fdacf2f7e095528894efe2a2822049a69` |
| `corpus-summary.json` | `c3056d87c0982ed19987af3bf246fb991c3cb48c4f821ee4060692c7c3d8ece0` |
| `jvm-inventory.json` | `5d44d82ed8b6db287dc79ad53c652cf30a52add8fe0a5374e3f0683c501c7968` |
| `jvm-inventory-summary.json` | `a28db1631555b3e3e937b58390a2f2c1cb59ee19077b944c0cbbd5dc70803b67` |

`hir-final.log` records the completed run with zero problems (SHA-256
`67d45082e03a0f0ab8f1263ccc7a24665c389be61346166990bc90f70dfb273f`).
Adjacent per-project archives retain the HIR and native diffs and emitter
stdout/stderr.

## Paired compile counts

The production `compile-time.mjs` owner measures all 34 modules in both arms,
using the same single-checker, single-Rayon work profile as the tables. The
before pin is 9520f013ab80 and the implementation pin is 44b0e451627f.
At the comparison's start, main is a69a459ed9: its compiler and runtime inputs
are unchanged from the before pin, and its current tables include the newly
recorded rows. The implementation's compiler and runtime inputs are unchanged
after rebasing. All four runs measure every module, with no stale or unmeasured
inputs.

| Arm | Candidate/main, all modules | Candidate/main, tripped rows | Rows tripped on main and candidate |
|---|---|---|---:|
| NoGC | 0.990614–1.007907 | 0.999220–1.003837 | 17 |
| RC | 0.990278–1.008458 | 0.998848–1.005430 | 17 |

The five scaling controls remain within their recorded bands in both arms;
their candidate/main ratios range from 1.000260 to 1.001561. No new scaling
failure appears. The same 17 modules exceed the 1.10 recorded-budget ratio
before and after, in each arm. The measured re-land adds at most 0.55% on
those rows; their inherited differences from the recorded budgets are
1.11–1.36x. The change deletes exactly those rows from
`results/compile-times.tsv` and `results/compile-times-rc.tsv`, retaining all
other rows and calibration history. Full-check recording writes the pending
baselines after landing.

The complete decision tables retain both the recorded-budget and paired ratios:
CPU columns are diagnostic seconds; the decision uses instruction counts.

- [NoGC table](0872-paired-nogc-compile-counts-for-stored-callbacks.tsv), SHA-256
  `1c5cb94a048ac4b918f9dfac53fd72d30649d27772a127c2593fd2a7be4917c6`.
- [RC table](0873-paired-rc-compile-counts-for-stored-callbacks.tsv), SHA-256
  `b0612a85d04d75b2f8ba33af86f98af547bef85018943b6f54ec5d59b1009f98`.

Raw counts, copied original tables and per-module perf output remain in the
same scratch directory. `compile-time-decision.json` identifies the exact row
set (SHA-256 `ac2f812a6139da4a8c2e32ccea02f6cc9fbb4703f12da4c7d9d951a7724196b1`).
The four owner logs are:

| File | SHA-256 |
|---|---|
| `compile-time-before-nogc.log` | `e5f730d5451f6d94c63ed694f24298f53d864ad84c5283416972e24d517866e6` |
| `compile-time-after-nogc.log` | `31a1122a47f1bbb0b455f9e69175cfc0c85ffb9fc969ad17dd5bd259127994db` |
| `compile-time-before-rc.log` | `67ef42e69f90928486a68a93e087080d630cb702f4cf1ce56d24cbf1a03a0587` |
| `compile-time-after-rc.log` | `e05a14296e6c8a556c6d36b287bce083f57a9342ebc871a016d33008a2ffcca7` |

## Recorded test262 proof

The five recorded populations run against the clean implementation pin through
`conformance262.ts --under <directory> --recorded <table>`, admitted with the
`test262-records` key. The fresh unit completes oracle dependency capture and
all five populations; no private oracle tooling or setup workaround is used.

| Population | Cases | Regressed | Changed | Missing | Unstable |
|---|---:|---:|---:|---:|---:|
| Language | 8401 | 0 | 0 | 0 | 0 |
| Built-ins | 1085 | 0 | 0 | 0 | 0 |
| Annex B | 12 | 0 | 0 | 0 | 0 |
| Staging | 59 | 0 | 0 | 0 | 0 |
| Harness | 17 | 0 | 0 | 0 | 0 |

All 9574 cases reconcile with their current records. There are also zero fixed,
new-pass, new-fail or differently accepted rows. The raw log is
`test262-retry.log`, SHA-256
`d05f10ebb8a6bd8f24ced335ea446c9771144e96d994ccbb9490a684d28c5b69`.

## Capture-storage correction

Review of e066239710 found that the projection also accepted a closure's
lexical capture named `message`. Those fields are storage, not properties of
the function. A closure capturing `message: string` therefore printed its
capture when thrown or rejected, while renaming the capture to `text` did not.

`Layout::message_field()` now requires a nonempty layout whose type IDs all
belong to source types or provided error instances. The existing synthetic-ID
partition excludes closure environments, constructor tokens, cells, suspended
frames and handle boxes. The property-name/string-type check follows that
membership check. The three backends still share this authority. No schema
field, runtime helper, runtime source or jar changes in this correction;
`compiler/semantic-schema` remains untouched at version 56.

The clean implementation pin is `5807163e704808ed188f097eee5687e9a541fd02`,
binary SHA-256
`e57d494d526806afdad3e5aaeedf128498193e0dc1a584ee5d8e2506b1584cf8`.
The earlier 44b0e451627f pin has the same compiler/runtime source as the reviewed
e066239710 and supplies the pre-correction control.

New raw evidence is under `~/.cache/nts-scratch/478/review-20261121/`.
Six inputs differ only in capture spelling (`message`/`text`) and delivery
(synchronous throw, `Promise.reject`, reaction throw). All 48 observations
across both pins and C, LLVM, JVM and real C-RC match the expected behavior:
the earlier pin prints `captured-secret` only for the `message` spelling;
the corrected pin prints neither capture. The sealed Node observations have
no message property for either spelling. Its `Function` class spelling differs
from nts's existing `Closure0` spelling; this correction preserves that spelling
and removes the invented property.

The committed JVM test checks all six inputs and that no closure implements
the projection protocol. Native integration executes all six inputs with both
emitters and both providers, and checks closure descriptor offsets and landing
details directly. Core tests include provided errors and every storage band.
Full `inner.ts --no-agree` passes: 1909 tests, zero failures, one ignored,
including 154 JVM integration tests and 211 C integration tests.

The original focused suite also passes all 38 checks: the promise outcome
retains its complete Node line, the exported control agrees on 116 cases per
lane, and #862 remains fixed. All 16 candidate fixture/control comparisons
agree on 29 cases with no declines or refusals. Four optional rechecks of the
old 9520f013ab80 main pin are not measured because its baked
`oracle-filesystem.ts` identity predates the current producer. The earlier
sealed main/control observations above remain the before evidence; no private
oracle tooling is substituted.

| Evidence | SHA-256 |
|---|---|
| `capture-probes/rows.json` | `9aac67f45f11a397aeac0b8bb3727683c224a813a274e575214a531faf883ebb` |
| `capture-manifest.json` | `4382d316e2aefacc248d13c4ef7ecfd51f3608aefbd8d908d0d57e821bbd456b` |
| `focused/rows.json` | `21291fca5de7b1127d41739fb2a7c3cf551aeaf1f3ccb02a7bad52c622f33eac` |
| `fresh-probes-rows.json` | `7cb4b20519f0d5cfd12ed17cb46ad9c785b0fa24c2351cdc65174c51de5aadb4` |
| `inner2.log` | `9a30d3870c47b090d0ae35fdaac35ded84b101b3b09acbc94d7383cca5a44bfb` |

The corrected `hir-compare` run covers all 1135 original roots. Every prepared
HIR hash matches the reviewed implementation. Normalizing only the appended
native descriptor field still produces the original publication-disabled C
and LLVM hashes. C output is unchanged from the reviewed implementation;
LLVM changes only five projects' descriptor metadata.

The JVM inventory retains all 40424 classes and now has 4620 projection
methods, with no other class or method inventory changes. The five removals
are all closures: `console`'s `Closure497`, `fs`'s `Closure1767`, `readline`'s
`Closure795`, `util`'s `Closure441` and `zlib`'s `Closure1986`. No program-root
projection changes. Per-project emitter stdout/stderr archives and hashes
remain under `corpus/`; the comparison uses the retained pre-review baseline
hashes and inventories rather than rebuilding an old oracle.

The representative linked-size comparison repeats the earlier result exactly:
C/C-RC add 48 text and 232 data bytes; LLVM adds 48 text and 96 data bytes;
ELF file sizes and BSS do not change. The JVM still has 19 classes totaling
26865 bytes versus 26759 without publication; only `Observed.class` differs.
The runtime jar remains 165411 bytes versus 165065 without publication.

| Corrected corpus evidence | SHA-256 |
|---|---|
| `corpus/rows.json` | `6c7db64f11377f7b35df981304c82ead891e969d34f545eb83d8072579b69d1a` |
| `corpus/summary.json` | `afa2e14ee6ff6bf184bed38f94eb7c26f0cb6392f52f74eaa2baf04c961c2328` |
| `corpus/removed-projections.json` | `004175274262c9900de507a241eef999a12e193b83c2afb59c6e04c051a35e11` |
| `corpus.py` | `990ca27feda0883c4819cfb158f3b8ced59c7b44f19eca047cde46262ff39511` |
| `jvm-artifact-sizes.json` | `0e9c4e7092b6ba8006961bc9a3dd965d5ef40d4e255a0d7ee6b445f518e4a15a` |

Fresh paired instruction counts repeat both pins and both arms through the
production compile-time owner, measuring all 34 modules each time. The before
pin remains 9520f013ab80; the corrected pin is 5807163e7048. All four passes
finish without stale or unmeasured inputs. This comparison uses fresh main
counts, not CPU times or the earlier session's counts.

| Arm | Corrected/main, all modules | Maximum corrected/main on tripped rows | Rows tripped on both |
|---|---|---:|---:|
| NoGC | 0.990555–1.007893 | 1.003413 | 17 |
| RC | 0.990306–1.009133 | 1.003794 | 17 |

The deleted row sets are exactly the earlier sets in records 0872 and 0873;
there is no additional deletion. All five scaling controls remain in band in
both arms, with corrected/main ratios from 1.000290 to 1.001582. No new scaling
failure appears. The corrected re-land adds less than 0.92% against main
overall and less than 0.38% on the tripped rows. The original paired tables retain the
row-deletion decision; the full refreshed measurements below include each
module's fresh main and corrected counts and its original budget.

| Refreshed count evidence | SHA-256 |
|---|---|
| `compile-fixed-nogc.json` | `9dada5282a0d0473cd2f4006685e5b65cdd19898db1e9f9c12b641d164182297` |
| `compile-fixed-rc.json` | `60ffed4fce22667768cf5dcd56c15cecbdd94231872bf5b1eb3c77ad368da1df` |
| `compile-fixed-summary.json` | `e6985b289977dfa2d890a50b40015fbadb9facea779922a98b349acff5bf876a` |
| `compile-time-fixed-nogc.log` | `c4b450df701f5d0bfe637f6157cfdf6cb627874670d1d02ddf3f37e1e40e9431` |
| `compile-time-fixed-rc.log` | `6b5ce776ba185d23d6248cbc2119eaa9da01738aec380cd8a901a88d3d0ac24f` |
| `compile-time-main-nogc.log` | `0d62b8cae1b71c52c986696ac99691622b01fc8efb23fc0430ea0d7074e29fbe` |
| `compile-time-main-rc.log` | `e4bcf07cd6db4ef975a98eb418dfdcb224a3ec11b225070c8f04d77b4fc0f127` |

The five recorded test262 populations repeat against the corrected clean pin
through the same production route and `test262-records` admission key.
Language 8401, built-ins 1085, Annex B 12, staging 59 and harness 17 all
reconcile: zero regressed, changed, missing, fixed, new-pass, new-fail,
differently accepted or unstable cases. Oracle dependency preparation finishes
normally; the earlier silent lock wait does not recur. The fresh log is
`test262.log`, SHA-256
`c25a9f4a7a253ff94d7e09014ee994721ed6923efdbc5d1202c3446aa0aea2e0`.
