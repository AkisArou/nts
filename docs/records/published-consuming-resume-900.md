# Published consuming entries: rebased proof and memory minima

This proof supersedes the pre-rebase measurement comparisons in [the original #900 record](published-consuming-entries-900.md). The compiler implementation is unchanged after the clean rebase; #901’s liveness-bounded borrow windows and #911’s product-root selection are retained.

## Sources and committed history

The baseline is main `1108f8f8de157144f1a03d979a63df0dd5d1e145`. Its official compiler pin is `~/.cache/nts-pins/e6e47b4a9b11/nts`, SHA-256 `bccc5abb63fd6e2b88eef039814f4ce89f1a3f3e37847f868b59ecc8c6d9ed6b`. The fresh whole-workspace baseline release build has the exact same source digest, `9683535ff6117485574bae39e67342e5e236ec02e76f7d4cc501d47b846960ef`. Source snapshots were made only in the task tree, after committing and separately reading `git log -1`; every changed file was backed up and copied back, and the restoration diff is empty. No checkout or stash restored a file.

The measured candidate is `0a15f833dc190d6e3e456857776696be07c4ac5b`. The original 44 commits were consolidated without changing the resulting tree into four commits: the shared analysis/guard, materialization and backend adaptation, executable controls, and evidence. Both implementation commits independently passed `cargo check --workspace --profile nts-dev`. The full fresh inner passed formatting, workspace Clippy, a fresh compiler build, and all touched crates plus C/LLVM/JVM tests (`inner.ts --no-agree`; tests: 770 seconds). There is no task diff in `compiler/semantic-schema`, so no schema bump is owed.

## Fresh Towers instruction counts

Both runs use `nts-bench --root <tree> --count awfy-towers`, C/LLVM selection, and the production calibrated/empty-subtracted instrument on CPU 0, outside measurement CPUs 4–5. The printed native noise band is 1 basis point (0.01%).

| Backend | Current main instructions/op | Candidate instructions/op | Reduction |
|---|---:|---:|---:|
| C | 941627 | 751839 | 20.1553% |
| LLVM | 908802 | 735424 | 19.0776% |

The first baseline attempt was rejected because its Node oracle cell was invalid; no count from that attempt is accepted. An isolated unchanged oracle diagnostic then verified the expected checksum, and the unchanged baseline retry passed. The failure and diagnostic are retained, not classified as a compiler defect or silently discarded.

The real regression fixture was also emitted by the current main pin and the candidate. Main’s direct caller releases its input after `publish`, and `publish` retains that input at its store. The candidate’s direct caller has neither input retain nor release, and the moved implementation has no input retain. Its still-used caller supplies exactly one input retain and one later release; the published adapter supplies one retain and no transferred-input release. These assertions hold over the emitted bodies used by the executed differential controls, so the avoided-count assertions would fail on current main.

The durable closed-Towers test passed unchanged: three null retains, 8224 attempted releases (8209 null and 15 effective), 15 allocations and zero leaks. The 8205 null old-field releases remain #916; they are distinct from the eliminated argument pair.

## Boundary and semantic controls

On C, LLVM and JVM, all 40 transfer/control observations and four specialization observations agree with Node on both compilers. The C/LLVM exported host drivers pass normal, C no-inline, poison, ASan and forced-collection runs. The Node-addon clients exercise local and nested throws before/after a consuming store, private forwarding helpers, source identity, caller reuse and numeric specialization under poison and explicit cycle collection.

| Compiler/product | C | LLVM |
|---|---|---|
| Current main, open addon | fails strict incoming-array check: 80 bytes vs 0 | same |
| Current main, named `--napi --entry` addon | same failure | same |
| Candidate, open addon | passes all strict checks | passes |
| Candidate, named `--napi --entry` addon | passes all strict checks | passes |

The candidate’s final keeper residue is 32 bytes in each addon arm, the separately documented #912 mutable-global receiver leak. Every incoming-array assertion remains exact; no allowance hides the baseline’s 80-byte argument leak.

## Published-entry cost

The native host calls the published `store(xs, false, false)` 100000 times, verifies answer 700000 and zero live bytes, and is counted five times per build under `with-lock.sh --wait --key perf-count` on CPU 4 with sibling 5 quiet. These custom counts have no benchmark noise band of their own.

| Backend/mode | Main median instructions | Candidate median | Delta/call | Candidate/main |
|---|---:|---:|---:|---:|
| c/normal | 8675064 | 8575064 | -1.00000 | 0.98847271 |
| c/calls-visible | 8675132 | 9375133 | 7.00001 | 1.08069053 |
| llvm/normal | 8675065 | 8575064 | -1.00001 | 0.98847259 |
| llvm/calls-visible | 8675134 | 8575133 | -1.00001 | 0.98847269 |

The optimized `store` disassembly on both backends has no call to a consuming implementation: the adapter is inlined, with no extra call. This concrete path is one instruction per call smaller, not an assertion about every published caller. C’s `-fno-inline-functions` control exposes one extra call, about seven instructions. That flag applies to C translation units and does not force LLVM IR not to inline; the LLVM `calls-visible` row is retained as the measured flag variant, not claimed as a no-inline control.

## Fresh locked Towers sitting

Unit `nts-900-sitting-resume` used `with-lock.sh --wait --key bench-session`, with no outer reservation or column filter. The sitting is `2026-11-22T12:25:00.620Z` to `2026-11-22T12:25:57.174Z`; raw artifacts are under `~/.cache/nts-scratch/900/sittings/resume-20261122/`. Its single requested row is unspoiled, all ten cells are verified, and checksums agree. The run is a partial-suite record (one row of its full inventory), not a full-suite completion.

| Column | Microseconds/op | Repeat max/min |
|---|---:|---:|
| nts C | 30.25734 | 1.488531 |
| nts LLVM | 29.91013 | 1.013277 |
| nts JVM | 29.56279 | 1.016327 |
| C++ | 13.90593 | 1.253322 |
| Java | 21.78071 | 1.016566 |
| node | 36.60995 | 1.004743 |
| Bun JIT | 23.50847 | 1.017421 |
| Bun AOT | 34.85698 | 1.014191 |
| ScriptC | 95.03223 | 1.012067 |
| nts f64 | 30.08118 | 1.012919 |

Every tool-written verdict ratio is retained:

| Column | /node | /Bun JIT | /Bun AOT | /ScriptC |
|---|---|---|---|---|
| nts C | 0.826479 SHORT | 1.287083 LOSS | 0.868043 WON | 0.318390 WON |
| nts LLVM | 0.816995 SHORT | 1.272313 LOSS | 0.858082 WON | 0.314737 WON |
| nts JVM | 0.807507 SHORT | 1.257538 LOSS | 0.848117 WON | 0.311082 WON |

The native rows still lose to Bun JIT and are short of the Node ratio bar. C and C++ have wide repeat ranges in this sitting; no precise before/after wall-time percentage is inferred. All ratios compare columns within this one sitting.

## Fifteen test262 records

All five recorded populations pass on each backend, with zero recorded regressions. Every command explicitly selects its backend and that backend’s own record, including staging.

| Backend | Language | Builtins | Annex B | Staging | Harness |
|---|---|---|---|---|
| C | pass | pass | pass | pass | pass |
| LLVM | pass | pass | pass | pass | pass |
| JVM | pass | pass | pass | pass | pass |

## Memory minima under closed executable roots

Under the earlier memory instrument, `async-method` executed 37 operations against its floor of 35 (seven allocations, no leak), while current main executed 35. That instrument emitted an open library although its C harness runs a standalone program and owns the runtime drain, so the resumability guard correctly withheld consumption through the unsealed resume call. #960 corrected the instrument to request closed executable roots through `product_roots`. The guard, floors and tooling are unchanged in #900, and there is no async exception.

The branch was then rebased cleanly onto main `2d933c741d6043de6d989f6ae343b96a733aecc1` (#960), with no conflict and no implementation edit. Its fresh release compiler has SHA-256 `47898b7d65426fd19d7a40fd36b39991095ba970247cc504f9634007f0e61b18`. Against it:

| Check | Result |
|---|---|
| `tooling/memory/run.sh`, every case | green: nothing leaked, no answer changed, every case at both floors; `async-method` 35 operations at floor 35, 7 allocations |
| Node-semantics fixtures, open and named `--napi --entry` boundary clients, published-entry rows | pass |
| Five test262 records on each of C, LLVM and JVM | 15 of 15 pass, zero regressed |

## Local landing proof

`check.ts 6ceb9d2d45465294c385d56cb12b84d7749308d6 --here` passed in 873 seconds: the build and every selected step are green. Rust/native tests report 3161 passed, zero failures, eight intentionally ignored tests, 57 binaries and 19 doctest crates; seven native probe files have zero failures or unavailable results. The tooling suite and input census also passed.

The first launcher stopped at environment setup before any test because the systemd manager had no `JAVA_HOME` or `ANDROID_HOME`. The successful named unit supplied the existing login-shell SDK paths explicitly. The canonical environment retained its normal policy; no gate parallelism, floor or verdict variable was overridden. The final evidence edit only records this result and removes procedural handoff wording from the record; compiler, runtime, tooling and fixture bytes are identical to the checked commit.

## Kept artifacts

Paths below are relative to `~/.cache/nts-scratch/900/`. The JSON audits retain commands, statuses, timings, source/binary hashes and the per-run log hashes.

| Artifact | SHA-256 |
|---|---|
| `resume/history.json` | `65e6b8064718eabf04616393f3f01f5591371e31e7bbbf94bcb32853290c73e9` |
| `resume/baseline-build-audit.json` | `ab3d7ef5ab42a514065c406d9b58d1980b70972357aa13a53c7bcd3af28074d6` |
| `inner-resume2.log` | `dc1224dbcfe3d5e7ab62e596dfc7ebaadfa850c8df39d13edb84176f1c45d03e` |
| `resume/main2/count.stdout` | `920fc0568ab5be9b84d85d00e46d1ad0232ccca29086d63e9dd628d7ac6d1bed` |
| `resume/candidate2/count.stdout` | `afa8a59d111b8689166b4ff54ccffe401260316e08e7d924ff5ce082bbe77d7d` |
| `resume/direct-fixture-counterfactual.json` | `79f95f3f44bf9d8772c7720596e244bd25126130ffadc1ca73b0ff79af75fdf3` |
| `resume/resume-main-focused.json` | `919ffcdec35e426825b7457bef3393c1368edbc206215ef189a5fb4704645114` |
| `resume/resume-candidate-focused.json` | `78f6120691b1a57c94aa0d91c722b710a693d85e02b1cbcbb23f378d9440880f` |
| `resume/external-counts.json` | `4aa3b701fb69c8fc987a5c4984cde6781d11023d4dd7fb5719be8f9951a769db` |
| `resume/test262/summary.json` | `8c3c9f5c61755ad019d4ea2d6adebef96db6a9256fc9990420ca2998684ab5e0` |
| `resume/memory-resume.log` | `6c668cf4a3c1259e9da348da8359a27a229e4ca5b65d4fb7a802afd47d26abc7` |
| `resume/async-main.json` | `93553a6c43efda40ef33f82e649d24c6aed611269263b96ad0fa3c0f912f07f3` |
| `sittings/resume-20261122/run.json` | `9ba0f574fece7e603118d66a5672769c2e9a4b483d1101917e05d92f5b3fe9e0` |
| `sittings/resume-20261122/conditions.json` | `14db846400be1d8854db3acc37a4567e843d5851d26f9e93e19f0ba87f02083b` |
| `sittings/resume-20261122/stdout` | `217ce87c28c93f73f669881a6da8f3c6c366c729f4ac596b4bfcc919725e950a` |
| `resume/oracle-diagnosis.json` | `9fdef22c8cefd36cb0ff7351dbc326d5b5a58501b7ae78ca22f0c5c31d226ee2` |
| `resume/count-main-resume.log` | `6bf886d7541bc9012113ec412b40141dfd7a063858565e96a1ef799488085564` |
| `resume/local-check/summary.json` | `b410464db590abb5154c1c64446e4d4347127e21b4904d6aafbce01fab5d312e` |
| `resume/local-check/summary.tsv` | `cd4be15e2fe441923b4e1b23c20c5dc6139f513eb62c13d8dd3f3979b3e494a5` |
| `resume/local-check/tests.log` | `78a0ac97f4b9451beedc11d50e545b10e7fe9fbaba31fea857dfc71329ab7216` |
| `resume/local-check/tooling.log` | `e11009f40259eaa7e8dc0cee4cba58317efc4be32e7c1b6cfcdde5dbd393fa33` |
| `resume/check-here2.log` | `ae043dda596a661855c05e325b6d8a96fbe5bd3e3b7a3f621fe73bc0bfb674cf` |
| `rebase960/release.log` | `c5e37dc2989941583ca7011eece92d559ebaa36b6d828810436d1735b4fd31cb` |
| `rebase960/memory.log` | `414521fad6d41f95f91bab6d0bb1e43396279f10c1ffd86630c0b1c1ecab97b1` |
| `rebase960/rebase960-candidate-focused.json` | `8b9ff24f69bd03a0d4a2407f51d05ce8daa467774803ef4fa39d32be91030eaf` |
| `rebase960/test262/summary.json` | `0a7cf3650a8802312682344cfb86864433fc23e0efd42d4a15ebecf6bbdf1cb3` |
| `rebase960/proof-status.json` | `145a316146b15127d39c917d3cf0c1bd56a65e5c7f49c61cb0189b45ba3006a3` |
