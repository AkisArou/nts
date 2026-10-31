# Unicode stage 1 native evidence

The final source replaces native case mapping with immutable tables generated from
the Unicode 17 model. It fixes Final_Sigma on C and LLVM, preserves lone surrogates,
and retains an unchanged input with no allocation. A changed result has one exact
final allocation. JVM case mapping is a subsequent slice.

`binding.json` binds the measured scalar and fused sources to the consolidated
source. Every production and tooling blob matches the qualified fused source;
only history and results placement changed. The measured histories are retained
in `measurement-history.bundle`. Six immutable benchmark runs remain in the
shared `results/benchmarks/runs/` store. The newest complete run in `full.md`
remains the previous complete sitting; its own-best columns are regenerated from
the new compatible partial runs.

The subsequent Main-directed offline-generator selection rule is recorded in
`review-and-replay.json` and `generator-selection/`. It changes tooling policy
and its controls only; all 23 other reviewed binding entries remain exact.
Compiler2 cleared native source bounds/ownership/notices, and tsrs cleared the
additive policy separately. All 61 selector controls pass; the old rule fails
the same intended assertion and the new rule passes. The change and census
remain in the same landing, with results commits last.

## Measurements

`both-brackets.md` gives every row of both A0/B/A1 brackets, five launches per
cell, spreads, node, Bun JIT, Bun AOT, ScriptC and final within-run verdicts.
The complete nine-column cells, checksums, compiler/comparator identities and
per-row machine observations are in the six run records. Both brackets used CPU
4 under `with-lock.sh --wait`; sibling 5 samples, load, available memory and gate
overlap are retained in `bracket-bindings.json`. The scalar first-change pass is
historical evidence: its ASCII regression was replaced by the fused SIMD pass.

The fused implementation improves C and LLVM on all five rows against the
bracketed baseline. ASCII and unchanged ASCII win against all four official
comparators. Latin-1, Greek and CJK still lose to node, Bun JIT and Bun AOT and
remain explicit in the table. `case-convert-latin1` includes U+0153 and therefore
uses UTF-16. `case-convert-cjk` starts with ASCII `A`: lowercasing changes the
string, while uppercasing can retain it. Neither row is an entirely unchanged
case-mapping workload.

## D1 and the ASCII cost

`counters/counter-table.md` gives the matched fixed-count pass on CPU 4, three
rotating launches per cell. Greek is 30.868 us/work with the model tables against
83.751 us/work with ICU4X 2.3.0 integrated into the same C program. Integration
includes UTF-16 to UTF-8 and back because ICU4X's full case-mapping public API in
this version accepts UTF-8; the scalar character API does not implement full
expansions and context. The deciding integrated LLVM comparison is 31.847 versus
83.767 us/work. ICU4X is a reference input, not a product dependency.

The separate engine-native context is model UTF-16 30.774 versus prepared ICU
UTF-8 60.467 us/work. That probe prebuilds input outside the measured calls and
checks equivalent UTF-16 lengths/first-code-point output; its observer counts
UTF-16 length from ICU's UTF-8 result. It separates adapter cost from mapping
cost and is not the deciding D1 comparison.

The old scalar unchanged-C path uses 76,973 instructions/work against main's
59,370. Fusing classification brings it to 30,317. Annotated original hot loops
and flat `cpu_core/cycles/u` reports are in `counters/`; raw perf records and the
original four profiled executables are in `raw-observations.tar.zst`. The scalar
first-change loop takes 41.01% of its hot helper's sampled cycles in byte loads,
range arithmetic, comparison and iteration, in addition to the earlier ASCII
scan. The fused pass removes that duplicate walk. Greek LLVM has about the same
instruction count as C (814,737 versus 814,871); its small cycle gap awaits the
planned layout-interval experiment and is not attributed to a mechanism here.

## Correctness and qualification

The compiled census compares node over every code point and Sigma context
frames. An intentional incorrect digest fails and the restored source passes.
The independent direct-C boundary probe passes 4,768,768 width, length, vector,
alias and direction cases. Final_Sigma's 87 calls disagree on 58 calls on each
old native mode; all five candidate modes agree. Both old and new JVM modes
already agree. The official unchanged memory case keeps the input and has zero
excess allocations or leaked objects.

Rust: 719 passed, zero failed, two existing ignored probes. Full tooling: 725
passed, zero failed, two existing TODOs (identifier Unicode 15.1 and JDK 15 data
versus node's Unicode 17). Workspace Clippy, Rust/C formatting and strict
TypeScript pass. All five recorded C test262 sets complete with zero regressions;
two Final_Sigma cases are fixed. Raw observations and exact commands are kept.
The first dry-run was rejected before checks because a manual test-thread
variable leaked into its launcher; the clean rerun passes all nine tree checks.
It actually selects 48 steps, including wide readers: the shared input rule
merges tooling and runtime paths. No policy was weakened to narrow it.

PR #143's authored bodies were checked on baseline and stage 1 on C, LLVM and
JVM: all 207 cases refuse at the module-scope-loop gap, with no runtime execution.
The latest header-only author follow-up preserves those results, and two fresh
byte-exact family runs per backend agree. Those refused family records cannot
witness native mapping. Stage 1's independent native census and boundary probes
are its exhaustive correctness evidence. The separate gated loop subject and
function-wrapped control were submitted independently for the compiler fix.

## Rebuild

From this directory, extract `rebuild-inputs.tar.zst`, then run
`python3 rebuild.py --icu4x`. The archive contains generated C and LLVM,
drivers, runtime sources/headers, model tables, notices, reference Rust sources
and its Cargo.lock. The script compiles from sources without scratch objects and
checks every output checksum. The retained successful rebuild is a correctness
smoke, not a timing. For measurements, use CPU 4 under the benchmark lock.

Archive members and their hashes are in `rebuild-inputs-manifest.json`.
`files.sha256.json` hashes every file in this evidence directory except itself.
Existing cache receipts, original executables and earlier failed setup attempts
remain retained; this record does not overwrite any observation.
