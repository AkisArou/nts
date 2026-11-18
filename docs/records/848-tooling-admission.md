# Tooling file admission measurements

Issue #848 measured the fixed tooling step and two per-file implementations in the same pool tree. All runs were contended by the full check and benchmark service; none is an idle-machine comparison. The compiler body was unchanged.

| Source | Collected files | Step wall (s) | Scope CPU (s) | Ledger peak (GiB) | Raw cgroup peak (GiB) |
|---|---:|---:|---:|---:|---:|
| `39f4978a723067b4f99b6639aa8967551a4827bc` | 330 | 440.819 | 5791.544 | 15.534 | 17.366 |
| `943f6728dda53dca966156a39c0cc3ac0ff33b27` | 332 | 455.990 | 5540.523 | 15.488 | 17.590 |
| `f48fc1a45c002d0f9328b13da1ed401b8bad7476` | 333 | 518.277 | 4925.338 | 8.131 | 12.139 |

The fixed collector allowed 29 files at once and averaged 18.0; the per-file run reached 24 shared case tokens and averaged 15.1 executing files. The external sampler saw one additional nested source-test process in the fixed run. Its sampled maximum is therefore 30, rather than the collector’s configured 29.

The late `record-pending-selector.test.ts` entry started at 157.5 seconds and ran for 198.5 seconds before, versus 180.0 and 187.8 seconds in the per-file run. This distinguished a longer dispatch tail from increased work inside that file. The measured per-file CPU total also fell. These observations motivated reusing the common longest-first ordering owner; they do not establish an idle-machine speedup.

## Sampled file RSS

The external sampler read process RSS and rooted process descendants every 250 ms, outside CPUs 4–5. The largest observed file trees in the fixed run were:

| File | Sampled tree RSS peak (GiB) |
|---|---:|
| `tooling/gate/owed.test.mjs` | 2.919 |
| `tooling/gate/precise-changes.test.ts` | 2.568 |
| `tooling/gate/oracle-record-owed.test.ts` | 2.541 |
| `tooling/landing/selection.test.ts` | 2.532 |
| `tooling/config/workspace-project.test.ts` | 2.496 |
| `tooling/jvm/member-name.test.ts` | 2.487 |
| `tooling/gate/accepted-revision-data.test.ts` | 2.449 |

RSS can count shared pages more than once and process trees omit independent service ancestry. The gate’s cgroup charge is the authoritative aggregate admission measure; the RSS table identifies costly file workloads.

## Verdict limits

The fixed run had six failures: three missing planner setup failures, one launcher-experiment contract failure, and two Cargo artifact-layout failures. The later canonical run supplied the planner and removed the experiment marker. It retained the two Cargo failures and found two task fixture follow-ups (token-wrapper staging and the blocked-service timing review).

The per-file pool also replaced seven completed test-file reports after deliberately bounded child OOM controls with a container-budget observation. Those reports occur at lines 6688–6695 of its raw log. This is a separate shared-pool classification issue: hierarchical descendant OOM counters do not establish that the enclosing file’s own cap fired. The run is diagnostic evidence, not a successful landing proof.

No idle-machine wall-time bar or controlled ordinary-agent-job comparison is established by these observations.

## Raw evidence

- Fixed gate summary: `/home/akisarou/.cache/nts-scratch/848/before-contended/summary.json`; SHA-256 `72564b73a12c5e1f3c1d82cca3e4e837a75ce76edaf9e6495931bb85253e8e0a`.
- Fixed file RSS samples: `/home/akisarou/.cache/nts-scratch/848/before-contended/samples.jsonl`; SHA-256 `bc3b375f77e456467339918d13dde628d5816999788e55c2d9ffaf7ab1063974`.
- Fixed file peak reduction: `/home/akisarou/.cache/nts-scratch/848/before-contended/file-peaks.json`; SHA-256 `cdf55485e884cbdd7840b3f6127858fe705572d1db60e436ea4bbdbfb7678a83`.
- Fixed collector output: `/home/akisarou/.cache/nts-scratch/848/before-contended/tooling-tests.raw.log`; SHA-256 `d4f74be989b1bd12d6d115d2db6a4d2c868ef9223ee39d07a104acc7268c98b8`.
- Per-file gate summary: `/home/akisarou/.cache/nts-scratch/848/after-943f672-contended/environment/summary.json`; SHA-256 `cf27b35058f35ff4c638b3eb25d85aa879b5e88457ec21aef746747eff828615`.
- Per-file RSS samples: `/home/akisarou/.cache/nts-scratch/848/after-943f672-contended/samples.jsonl`; SHA-256 `5405cd372379453b8c9ec979413dc2045cdfd09bdb63ebb77af8dd1007b00a8b`.
- Per-file collector output: `/home/akisarou/.cache/nts-scratch/848/after-943f672-contended/environment/tooling-tests.raw.log`; SHA-256 `6260631c031cf26a69f9c1ddb1d17344a8b6783766bdc6716113b3b9448ae657`.
- Initial sampler source: `/home/akisarou/.cache/nts-scratch/848/before-contended/sampler.py`; SHA-256 `f45d09a7e4ee753d284324c0c64f8cc466eee910c4666ad6d98083ed3e8a5f4f`.

## Run conditions captured at both endpoints

The `f48fc1a45c002d0f9328b13da1ed401b8bad7476` run includes `admit.ts --status`, load, active services and process inventory at sampler start and end. The full-check benchmark reserved 7.9 GiB at both endpoints; the core full check held 1 GiB at the start and 2 GiB at the end while waiting to grow. One-minute load was 1.32 at the start and 6.35 at the end. No foreign unit was stopped.

Its file collector took 425.0 seconds, averaging 10.3 executing entries and reaching 21 simultaneous entries. The whole step also includes the separately leased selector self-test. The largest sampled file trees were `owed.test.mjs` (2.558 GiB), `workspace-project.test.ts` (2.509 GiB), `member-name.test.ts` (2.467 GiB), `precise-changes.test.ts` (2.435 GiB), `landing/selection.test.ts` (2.309 GiB) and `accepted-revision-data.test.ts` (2.300 GiB).

The 250 ms sampler saw 262 of 333 collected source entries; 71 short-lived entries had no sample. The coverage file names them, and no zero-RSS observation is inferred. The gate's per-file cgroup meters independently retain admission peaks. The historical diagnostic runs lack ledger snapshots at both endpoints; their recorded load and memory readings cannot reconstruct that missing inventory.

The two baseline Cargo failures and seven descendant-OOM classification errors remained. This run also found a V8 heap-limit failure in `oracle-record-owed.test.ts`, with the final GC near 920 MiB; its 1.451 GiB sampled tree peak is truncated by that failure. This run therefore establishes neither a passing proof nor the idle wall-time bar.

- Start conditions: `/home/akisarou/.cache/nts-scratch/848/after-f48fc1a-contended/conditions-start.json`; SHA-256 `285ca3f9fb43af6a6cc177cf819f5adc05b113456763bd0ca6eef3a2a1692db2`.

- End conditions: `/home/akisarou/.cache/nts-scratch/848/after-f48fc1a-contended/conditions-end.json`; SHA-256 `308b54b61831cbbb045d6f3d0db75d55908ca2c512ed49c0414d2f765ebddb5d`.

- RSS samples: `/home/akisarou/.cache/nts-scratch/848/after-f48fc1a-contended/samples.jsonl`; SHA-256 `5d82d642849f71ff5e8cfe155b8b011e65545f8d166bfe60c3497e3c79903b67`.

- File RSS peaks: `/home/akisarou/.cache/nts-scratch/848/after-f48fc1a-contended/file-peaks.json`; SHA-256 `6fe1e7cefd939846efaab406d00a4f423154e3b9d7148fcfe260226ac5300603`.

- Sampling coverage: `/home/akisarou/.cache/nts-scratch/848/after-f48fc1a-contended/sample-coverage.json`; SHA-256 `d8abc568b3af1f703b7f08b7dce2377ebb3436c60e93eb2ccc9e65074c46dbf8`.

- Gate summary: `/home/akisarou/.cache/nts-scratch/848/after-f48fc1a-contended/environment/summary.json`; SHA-256 `a65bff39e8cd09b078959a96e3a59381466552536ec6f4e7a7d0bd6ced6c8492`.

- Collector output: `/home/akisarou/.cache/nts-scratch/848/after-f48fc1a-contended/environment/tooling-tests.raw.log`; SHA-256 `bf0d8e10cff090ac54e61dc5be56d8e3f11c3e4166897468ae40f683650554f8`.

- Gate output: `/home/akisarou/.cache/nts-scratch/848/after-f48fc1a-contended/run.log`; SHA-256 `3a32fbdc53a513eb43353f4a893ab0514040fec6e4749fc6b94309310ce6369d`.

## First-run transition and fixed-step counterfactual

At `68febe56d462d7df2ce3331375a2ddfc76bb5ea9`, the real landing target's scheduling history was copied into each supplied-observation runner fixture. Its tooling entry retained `unit: step` and peaks up to 17,331,140,048 bytes. The per-file runner entered beside two 4 GiB ordinary jobs, waited on genuinely full memory, and ran its nested gate against an independent supplied ledger. Neither experiment changed the real landing history or machine ledger.

Restoring the original fixed-step classification from a saved copy made tooling wait for a 21,474,836,480-byte grant beside those jobs without entering its payload. The genuinely full control also waited, at the runner's initial grant. Only the controls' own named units were stopped. Both modified source files were restored byte-for-byte from their saved current copies.

- `/home/akisarou/.cache/nts-scratch/848/landing-steps-v5-before.json`; SHA-256 `757d2e154f7c97ef11b29e91c3c23548b12adacba1488047f638b712c74b3702`.

- `/home/akisarou/.cache/nts-scratch/848/real-history.log`; SHA-256 `96241846d15ade5c246ce920979859e9fcfbf83ecc064238774d913e658ddd48`.

- `/home/akisarou/.cache/nts-scratch/848/fixed-control.log`; SHA-256 `d35f40b30d0737e78e1f92163cbcc29e058b70b0d3471e1ac66d6f74395905d0`.

- `/home/akisarou/.cache/nts-scratch/848/wiring-real-history-experiment.ts`; SHA-256 `63893627269e611978a22d07fe442de610a331d58b95e0cf82012a24db3532b4`.

- `/home/akisarou/.cache/nts-scratch/848/wiring-fixed-counterfactual.ts`; SHA-256 `27c14e821d76420a75e3868a581eb2eab7ba0f6c730df52f3b37a4c56065c666`.

- `/home/akisarou/.cache/nts-scratch/848/step-table-fixed-before.mjs`; SHA-256 `6c927bb75106630fcf647ef2cbc62ced7b32695f7deaee912b241179df8f15e6`.

## Completed stack proof and cap handoff

Commit `10beb07ceff3e681cf524e6db95d1db70f13bc9a`, stacked on the separate #842 toolchain fix, passed all 20 owed steps in its `--here` rerun. Tooling completed 334 files and the separately leased selector self-test in 785.813 seconds (4561.400 CPU seconds). Its ledger peak was 10.782 GiB; the raw cgroup peak was 13.824 GiB. This was a contended whole-gate proof, not an idle timing comparison.

All 334 file completions retained their rows, including the seven deliberate descendant-OOM files. The 29 controllers' largest sampled used heap was 12.902 MiB, and the greatest first-to-last growth was 0.710 MiB. Each file used its registered 6,144,000,000-byte bound, including controllers whose bootstrap allowance had been smaller. The external sampler saw 290 of 334 source entries and at most 22 source test processes together; its coverage reduction names the 44 unsampled short entries.

A separate kernel control allocated beyond the production 6,144,000,000-byte cap. It retained the named runaway budget incident and both passing neighbour results. Restoring inherited census roles, the cached bootstrap cap, and the hierarchical worker OOM verdict each failed its intended negative control; the last produced false own-budget incidents for the seven completed descendant-OOM files. Source copies were restored after each experiment.

- `/home/akisarou/.cache/nts-scratch/848/here-10beb07-rerun/proof-summary.json`; SHA-256 `f382e8bdca74f22d79f2b212955a7f2f8ddc4593b153b8316e198a28b224ca72`.
- `/home/akisarou/.cache/nts-scratch/848/here-10beb07-rerun/sha256.txt`; SHA-256 `11da75e12244506ced9f466c519c8c3705dd337c828e86515d00634c08ddf392`.
- `/home/akisarou/.cache/nts-scratch/848/production-cap-control/final.log`; SHA-256 `644984dcf21c2dab7bfe5c7e94eadb878115fca7d147ee4452eb6d25b3a8d8fd`.
- `/home/akisarou/.cache/nts-scratch/848/counterfactuals-10beb/results.json`; SHA-256 `1c8f51b61bc01f3cdcf03c74e01830084baa625c0b2182b233342be8610aaa0c`.

## Interleaved timing and admission order

These are measurement runs, not landing evidence. **Before admitted from an empty private history to bypass the whole-step reservation; execution unchanged.** After used normal warmed per-file history. Every arm ran in its own named unit, with the full check stopped by its owner for the measurement window. Start/end ledger status, load, available memory, process inventory, external RSS samples and the gate's actual summary are retained. Before's only definite failures were the two #842 Cargo-layout controls; the stacked after arms passed.

The first implementation (`10beb07ceff3e681cf524e6db95d1db70f13bc9a`) regressed wall time despite reducing CPU and peak memory:

| Pair | Before s | After s | Ratio | Start load B/A | Available GiB B/A | Ledger peak GiB B/A | Max reservation GiB B/A | Wait s B/A |
|---|---:|---:|---:|---|---|---|---|---|
| 1 | 417.922 | 477.581 | 1.1428 | 1.56/3.94 | 23.02/23.02 | 15.375/8.796 | 19.000/20.000 | 0.115/328.113 |
| 2 | 422.173 | 506.558 | 1.1999 | 4.04/5.29 | 22.99/22.78 | 15.366/10.213 | 19.000/20.000 | 0.037/341.139 |

Median ratio: 1.1713; every pair <=1.05: False.

The collector alone took 333.9→390.2 seconds (ratio 1.169) and 337.6→420.5 seconds (1.246). JVM member-name requested its lease 0.013 seconds after the first request but received it at 293.160 seconds; 44 later requests were granted first. It became the final file.

Ordered admission (`be8227b4dd7f3f06128fa33ee584ce5062676386`) prevented that overtaking. JVM member-name was admitted at 171.836 seconds in its first arm. The resulting pairs still missed the timing bar:

| Pair | Before s | After s | Ratio | Start load B/A | Available GiB B/A | Ledger peak GiB B/A | Max reservation GiB B/A | Wait s B/A |
|---|---:|---:|---:|---|---|---|---|---|
| 1 | 415.929 | 451.831 | 1.0863 | 1.71/3.46 | 22.30/22.99 | 15.081/10.235 | 19.000/21.000 | 0.114/343.564 |
| 2 | 418.418 | 449.511 | 1.0743 | 7.86/3.82 | 23.03/23.20 | 15.164/10.713 | 19.000/21.000 | 0.040/345.574 |

Median ratio: 1.0803; every pair <=1.05: False.

Collector-only times were 332.6→360.8 seconds (ratio 1.085) and 334.7→362.0 seconds (1.082), separately from the whole-step ratios above. The selector self-test still occupied a serial tail. Summed lease lifetimes minus reported test-file wall times were 90.921 and 86.892 seconds across 334 files; the largest individual differences were 0.615 and 0.564 seconds. These include wrapper launch, readiness, dispatch and drain, not just CPU work.

The ordered request control kept the later acquire unissued while the head waited, then held both leases before either completed. Its unordered counterfactual failed on the bypass assertion. The real-runner control refused a head forecast larger than its entire budget by name and returned its reservation.

- `/home/akisarou/.cache/nts-scratch/848/pairs-window-live-10beb/comparison.json`; SHA-256 `b1b62a43b568da02b8230df4eeb0035357f6679ecbabf0bd26d77d04314d1772`.
- `/home/akisarou/.cache/nts-scratch/848/pairs-window-live-10beb/sha256.txt`; SHA-256 `57125040c5c424a6163fec718c23f1c501e82b61eb40c65bb223b79d4bfc6dee`.
- `/home/akisarou/.cache/nts-scratch/848/pairs-ordered-be822/comparison.json`; SHA-256 `6ccf316522a7652867760fcbe61ce403bcddf734b62deb67a4a380b4a29f043c`.
- `/home/akisarou/.cache/nts-scratch/848/pairs-ordered-be822/sha256.txt`; SHA-256 `a3f0580db6e1e6f849caade8c8c357bb0f9bedf7a8d27c99e7759436ed13d364`.
- `/home/akisarou/.cache/nts-scratch/848/collector-ratios.json`; SHA-256 `f50ff8fb50c2bb946d413fb28635fe1076cb61478cd720c1f16b33e7167b8b2c`.
- `/home/akisarou/.cache/nts-scratch/848/pairs-window-live-10beb/1-after/admission-tail.json`; SHA-256 `1b4b4dcaaa58714ce24bf720ea0de16eda63f29f4cd43db942ce74ef4784005a`.
- `/home/akisarou/.cache/nts-scratch/848/ordered-be822/run.log`; SHA-256 `dbf8c743fda0c38f04b44a1a1c68cc7817d10d5f1e0653b057186f8b9de3ad0c`.
- `/home/akisarou/.cache/nts-scratch/848/ordered-be822/unordered.log`; SHA-256 `ac082f64d933f6870beead28b05502641ab1f8039826a0cbd1b9fe19e62adbeb`.

A bounded paired dispatch probe executed the same trivial file through the resident test API and the fresh scoped wrapper. All 48 executions used distinct child PIDs. After two warmup pairs, median call walls were 75.339 and 146.196 ms respectively. Both modes shared the same probe process, so its heap readings cannot independently attribute retention to either mode. This is a controller diagnostic, not a whole-step timing verdict.

- `/home/akisarou/.cache/nts-scratch/848/dispatch-profile-be822/summary.json`; SHA-256 `a28241a313d4307904da234cc15abe37a4081e0b2e1fda0e7d71598d99c6bda4`.
- `/home/akisarou/.cache/nts-scratch/848/dispatch-profile-be822/results.json`; SHA-256 `731a6b8e2d0e9b4e1e7f6be2a8f3271fb275620f7e52fc02c47b879e979e294e`.
- `/home/akisarou/.cache/nts-scratch/848/dispatch-profile-be822/children.jsonl`; SHA-256 `9b89dbdde41b7aca6d0950dd1a7aaa1fcc6891f2645e9af7c69646a4753cf3a4`.

The initial selector-fixture failure was separately traced to a network acquisition also attempted by the original runner. A fetch-denying Git wrapper on `39f4978a723067b4f99b6639aa8967551a4827bc` observed the AWFY fetch and reproduced the truncated selector-input error path. This establishes the baseline network dependency, not the exact cause of that earlier transient. The coordinator filed it as #855; linker-message truncation is #854. Neither fix is part of #848.

- `/home/akisarou/.cache/nts-scratch/848/fetch-probe/before.log`; SHA-256 `541419af645ade76646106e641796e771a4c0d1086437c6385bc46906ce0cc3f`.
- `/home/akisarou/.cache/nts-scratch/848/fetch-probe/39f4978a723067b4f99b6639aa8967551a4827bc.json`; SHA-256 `bb7839602675bbbb7244cb9c0f2c475a8268950ad87a9e4e45f7dcc845d9f852`.

## Pooled selector entry and dispatch diagnostics

At `2ae3b195e7450e39ac502f0931f0ec090d668e61`, the selector self-test is an explicit entry in the same case pool. Its structural overlap control requires both an ordinary file and the self-test to start before either may complete. PASS, definite assertion FAIL and observation-failure controls passed, including a descendant helper's private cap and the selector's stable case history. All affected runner tests, strict tooling types and the host-input audit passed. This is focused evidence; no new whole-step paired timing verdict is established.

Splitting the test engine from the scope/admission launcher removed that launcher graph from each fresh execution worker. A 24-pair diagnostic still found a median scoped/API ratio of 1.992 after two warmup pairs (99.680/49.408 ms), with 48 distinct child PIDs. A separate 200-file API-only diagnostic grew from 7,289,472 to 14,249,552 bytes of used heap after forced GC. Consequently repeated API calls in a resident supervisor did not demonstrate bounded retention.

A scratch-only prototype runs the same trivial entry in one fresh Node process, using the public `isolation: none` API within the otherwise identical finite file slice and scope. Across 22 pairs after two warmups, its median one/two-process ratio was 0.6004 (60.350/97.934 ms), and all 48 executions had distinct PIDs and fresh globals. The prototype omits production activity guards and is only a startup diagnostic, not landing evidence or satisfaction of the whole-step timing bar.

- `/home/akisarou/.cache/nts-scratch/848/entry-8701/run.log`; SHA-256 `eb63475d2e27e7a257ac5c2e7af2398d537dd9375a1339c695f5294eb494d772`.

- `/home/akisarou/.cache/nts-scratch/848/entry-2ae3/run.log`; SHA-256 `c329221cc9915f009583ec284f8af2aad8a93e23180b32c8eb518d45902708bc`.

- `/home/akisarou/.cache/nts-scratch/848/dispatch-profile-2ae3/results.json`; SHA-256 `dac65b2a71f458e79adbde95090d79d968f4eda729b738b616aaeae285694d8c`.

- `/home/akisarou/.cache/nts-scratch/848/dispatch-profile-2ae3/summary.json`; SHA-256 `9f3549bdec1654bbb565621b3558410cbc1cd0d96c2c7fb91b7abaf82ae565fa`.

- `/home/akisarou/.cache/nts-scratch/848/resident-api-2ae3/results.json`; SHA-256 `de860dcb710a96bfeab22138169bc3bda85ab095f3c65e529a91e462b588496c`.

- `/home/akisarou/.cache/nts-scratch/848/single-entry-2ae3/results.json`; SHA-256 `ccd2b333c8ff70091e50a4cab0559dad0711791c5c806f954539a0a4979e4983`.

- `/home/akisarou/.cache/nts-scratch/848/single-entry-2ae3/summary.json`; SHA-256 `c8c8de2626a81d46d1c7a63a9358034517e7c8a601b08af9e64872348f1fab73`.

- `/home/akisarou/.cache/nts-scratch/848/single-entry-2ae3/sha256.txt`; SHA-256 `2ac2a2109e76c3f6fbe756aa8950f7a6ec07cad634d02b9d9e58df9e768cc077`.

## Final scoped-entry proof

The final executable change is `52f6a45e647a1b37a6da2b8167058503aaf22b5a`, above the separate #842 prerequisite. Each source test executes in one fresh scoped process. Its resident controller observes activity outside that process and accepts completed assertions on the private nonce-bound descriptor before termination. The synchronous blocked-thread control retains an earlier completed FAIL; forged or late evidence is refused, a ready process dying mid-file cannot become a partial PASS, and a finite-cap failure retains its passing neighbour. The selector remains an explicit case in the same pool.

The six affected test files passed 62 checks through the single-file route. The final timing and synchronous-block updates passed their 13 focused checks; strict tooling types and the host audit passed. The normal inner route passed formatting, Clippy, compiler build and 664 Rust/backend tests (4, 2, 1 and 299 seconds by phase). The final `--here` was green for all 20 selected steps, retaining all 337 entry rows: 336 test files and the selector self-test.

Tooling took 643.930 seconds in that whole-gate proof, with ledger peak 12.006 GiB and raw cgroup peak 12.913 GiB. The external sampler observed 301 of 337 entries and at most 24 source-test processes together; the coverage reduction names every unsampled entry. This whole-gate proof is separate from the paired timing verdict.

A 200-file controller probe used 200 distinct execution PIDs. Post-GC used heap was 11,636,096 bytes at file 50 and 11,881,296 at file 200; its last 50 readings spanned 73,104 bytes. Controllers were not recycled. The raw probe retains its earlier preparation label; `conditions-source.json` identifies the actual execution commit and source hash.

The dispatch counterfactual restores only the two-process route in a private copy staged by the module-closure owner. The production runner is byte-identical to the saved original. After two warmup pairs, 22 paired comparisons gave a median new/old ratio of 0.6522 (66.540/104.834 ms), with 48 distinct execution PIDs. This is a dispatch diagnostic, separate from whole-step timing. Its source metadata distinguishes the repeated run from the probe's older preparation label.

## Five interleaved pairs

The owner stopped the full check for this window. Each arm used its own named unit on CPUs 0–3 and 6–31. **Before admitted from an empty private history to bypass the whole-step reservation; execution unchanged.** After used the normal warmed history copied after its green `--here`. These history-controlled runs are measurements, not landing evidence. Every baseline's only failing file was `test-artifacts.test.ts` (#842); all five after arms passed.

Collector-only time is the last source-test completion in the production timing report, at its 0.1-second resolution. It excludes the pooled selector entry. Whole-step time includes the collector and selector on both sides. Available memory below is the ledger's start observation; raw kernel readings and complete start/end inventories are also retained.

| Pair | Whole s B/A | Whole ratio | Collector s B/A | Collector ratio | Load B/A | Ledger available GiB B/A | Ledger peak GiB B/A | Max reservation GiB B/A | Wait s B/A |
|---|---|---:|---|---:|---|---|---|---|---|
| 1 | 432.241/383.559 | 0.8874 | 348.3/383.4 | 1.1008 | 11.42/3.94 | 23.00/22.80 | 15.552/10.429 | 19.000/21.000 | 0.046/362.059 |
| 2 | 430.300/379.988 | 0.8831 | 346.3/379.8 | 1.0967 | 26.54/3.04 | 22.00/23.30 | 15.209/10.535 | 19.000/21.000 | 0.047/359.740 |
| 3 | 429.129/385.569 | 0.8985 | 345.7/385.4 | 1.1148 | 27.46/3.12 | 22.20/23.10 | 15.500/10.187 | 19.000/21.000 | 0.093/362.973 |
| 4 | 429.254/380.110 | 0.8855 | 346.0/380.0 | 1.0983 | 25.53/4.67 | 21.90/22.80 | 15.314/10.663 | 19.000/21.000 | 0.048/357.303 |
| 5 | 427.456/404.304 | 0.9458 | 342.9/404.1 | 1.1785 | 26.07/3.47 | 22.00/22.50 | 14.768/10.202 | 19.000/20.000 | 0.087/387.967 |

Whole median: 0.8874; every pair <=1.05: True.
Collector median: 1.1008; every collector ratio <=1.05: False.

The whole-step median is below 1.0, while collector-only time regressed, with median ratio 1.1008 and worst pair 1.1785. Moving the old serial selector tail into the pool accounts for the whole-step improvement. The raw queue and file timelines identify memory admission as the collector bottleneck. In pair 1, growth waited for 362 of 383 seconds, while the measured ledger peak was 10.4 GiB and reservations reached 21 GiB. Only about seven files ran together during seconds 20–100, against 28.9 before; the 24-token ceiling was not binding. Longest-first dispatch clustered the 2–3 GiB leases, and tooling's serialized acquire hid fitting lighter files behind a blocked heavy request. Those files' individual peak phases did not coincide. The duplicate-process counterfactual above isolates process startup savings; it does not excuse this separate admission regression.

Median tooling ledger peak fell from 15.314 to 10.429 GiB; median scope CPU was 5636.368 versus 4929.452 seconds. Growth waits in the table overlap already executing files; they are not a whole-step wait before entry.

## Paired file RSS

These are maxima across the five arms on each side, including each source process's rooted descendants. Shared pages can be counted more than once, and independent services are covered by the file's cgroup meter rather than process ancestry. The sampler observed one additional nested source process in the fifth baseline (30 rather than the configured 29).

| Arm | Source | Own RSS GiB | Tree RSS GiB |
|---|---|---:|---:|
| before | `tooling/gate/owed.test.mjs` | 2.514 | 3.145 |
| before | `tooling/config/workspace-project.test.ts` | 0.081 | 2.614 |
| before | `tooling/landing/selection.test.ts` | 2.447 | 2.574 |
| before | `tooling/gate/accepted-revision-data.test.ts` | 2.437 | 2.566 |
| before | `tooling/gate/precise-changes.test.ts` | 2.438 | 2.548 |
| after | `tooling/gate/owed.test.mjs` | 2.384 | 2.592 |
| after | `tooling/config/workspace-project.test.ts` | 0.102 | 2.587 |
| after | `tooling/landing/selection.test.ts` | 2.343 | 2.504 |
| after | `tooling/gate/accepted-revision-data.test.ts` | 2.324 | 2.501 |
| after | `tooling/gate/precise-changes.test.ts` | 2.335 | 2.488 |

## Final raw evidence

- `/home/akisarou/.cache/nts-scratch/848/here-52f6-final/proof-summary.json`; SHA-256 `50e7e0a72f95e6416d3d4145effb8366696b8e0c2368c7e2d116b869363ef639`.
- `/home/akisarou/.cache/nts-scratch/848/here-52f6-final/sha256.txt`; SHA-256 `51314055725b9f3059f485963c7d22d45c4cd9b94c69a1839c3b6dd50856bf21`.
- `/home/akisarou/.cache/nts-scratch/848/entry-single-e204/summary.json`; SHA-256 `6b82a31e7647eccc2920ce8844064faab5f29bd7b9004e5b98efc8f4ddb7a6a8`.
- `/home/akisarou/.cache/nts-scratch/848/entry-single-e204/sha256.txt`; SHA-256 `66ee00e7056ff5512974f8db83087b45adb791699aad92c38488aaa3baabe537`.
- `/home/akisarou/.cache/nts-scratch/848/entry-timing-current/synchronous.log`; SHA-256 `a20907909a81bd5f705af555e75db9c10442b89fc5563ac5c9224fdc0a424ad6`.
- `/home/akisarou/.cache/nts-scratch/848/inner-entry-e204/summary.json`; SHA-256 `8d14e006919a92b59cfa1799a807e5dd5cdfc63c8802b1b8f6813d9faab49abd`.
- `/home/akisarou/.cache/nts-scratch/848/inner-entry-e204/sha256.txt`; SHA-256 `9831c482402882d663b4912aa6752f40cbfa5134a5b44de2c522ef0a4c6b8000`.
- `/home/akisarou/.cache/nts-scratch/848/resident-scope-e0b9/summary.json`; SHA-256 `36017ddf4ba929b90da3db918b84373425d4de694c92cfd5d61333f0ee5a714d`.
- `/home/akisarou/.cache/nts-scratch/848/resident-scope-e0b9/sha256.txt`; SHA-256 `ee3951c7d38301e5434efefb99f193bcfa07f2990c228b163e3cd90f26cd2114`.
- `/home/akisarou/.cache/nts-scratch/848/dispatch-counterfactual-e204/summary.json`; SHA-256 `80dded05f70d3977aa1902eb6f17ccd3dfec2144e4c8ed6e1f9c710dc3b1f945`.
- `/home/akisarou/.cache/nts-scratch/848/dispatch-counterfactual-e204/sha256.txt`; SHA-256 `2e047ec3a35c92cba6ef391b26fec77266e9ba4f440b8167232d48ab1782ba11`.
- `/home/akisarou/.cache/nts-scratch/848/pairs-single-entry-52f6/comparison.json`; SHA-256 `f818608be5ebc265128cb5f844e6c2e2b56bb7617d1cdb8c983f8c4f72b4291b`.
- `/home/akisarou/.cache/nts-scratch/848/pairs-single-entry-52f6/sha256.txt`; SHA-256 `cca4e53a856087639a4fb9f72c1cd0df95454161e89634b7a05bbd7cbbc99147`.
- `/home/akisarou/.cache/nts-scratch/848/pairs-single-entry-52f6/accounting.json`; SHA-256 `b9042916ec2c501f0a9e460cf726ce71d18000090ad788f5cfae82e613a20e38`.
- `/home/akisarou/.cache/nts-scratch/848/pairs-single-entry-52f6/accounting.sha256`; SHA-256 `23ad67dd46b8b9cc5515a389f05a7c8e6c7d942e02e255881de167d4c6423b7e`.

## Review revision: bounded fitting backfill

Executable commit `ffbb588e60ca5d6b801d9ef0813d9c755de26e1f` removes tooling's serialized acquire wrapper. The shared token pool sees concurrent file requests and can admit fitting work. Each waiting request permits at most one cohort of later grants: the held plus free pool token count when it begins waiting. That allowance is fixed; after it is spent the request is a barrier until admitted or withdrawn. Running cases still finish and release their leases. Machine-ledger priority and arrival order remain with the ledger.

The production constructor remains `run.mjs`. Its clients include census definitions, test262 and TypeScript oracles; differential agree and check-consumers; conformance blockers, integrity, C compilation, assembly, JVM verification and type checks; benchmark recording, compile-time and the shell token command. Existing token, admission, verifier, integrity, blockers and census memory/readiness/policy controls pass unchanged. There are 119 unique focused assertions across eleven files; the final token-lease rerun passes all 15 assertions. Strict types and the host audit pass. Private module-closure counterfactuals fail as expected: strict FIFO leaves admitted memory idle, and removing the backfill bound starves the waiting head under a continuing light stream. Supplied ledger observations prove that pool backfill cannot move growth past higher-priority or earlier ledger work. A refused oversized head preserves its name, and draining or withdrawing a barrier restores progress.

`inner.ts --no-agree` passes formatting, Clippy, build and 664 Rust/backend tests; the test phase takes 268 seconds. The controls and inner raw-output manifest is `/home/akisarou/.cache/nts-scratch/848/backfill-controls.sha256`, SHA-256 `f6fedb85f22d658c1d48dd124cddd05087e91620005e16684c48e196a13f918c`.

`check.ts --here` on that executable commit passes all 20 selected steps. Tooling takes 610.252 seconds, with an 11.586 GiB ledger peak and 14.650 GiB scope peak. All 337 entries complete. Its raw output is retained in `/home/akisarou/.cache/nts-scratch/848/here-backfill-ffbb`, with the `sha256.txt` manifest and `proof-summary.json`.

## Remaining per-file footprint cost

Bounded fitting backfill removes tooling's head-blocking wrapper and bounds starvation. The remaining collector regression is the separate heavy-file footprint issue #857. Each file honestly reserves its measured peak through its whole lifetime: the selector forecast is 4.15 GiB and several other files reserve about 3.1 GiB. In the first new idle pair, summed reservations reach 21 GiB against a 9.609 GiB measured ledger peak; growth waits overlap execution for 377.506 seconds. Sampled concurrency in seconds 20–100 is 9.0 entries versus 28.88 before. The collector-only ratio is 1.1227. These observations are a regression, not a performance pass. The #848 criterion is the card's idle whole-tooling-step wall time; the selector and all test files are included in that comparison.

The before arm remains `39f4978a723067b4f99b6639aa8967551a4827bc`, admitted from an empty private scheduling history solely to bypass its whole-step reservation; execution is unchanged. The after arm uses a copy of normal warmed history. These are measurement runs, separate from landing evidence. Each arm has its own named unit and external `/proc` sampler on CPUs 0–3,6–31. Start/end status, load, available memory, service/process inventory, per-file RSS and concurrency are retained.

#842's two Cargo-layout assertions are known baseline failures; the stack includes its signed-off `9f618231afa6f60fd3e73d14a2cbcf94cce59e5e` separately. #856's stopped-exec-environment receipt assertion can fail in either arm under load. Its raw FAIL verdict is retained per arm. The resumed measurement harness permits only those named assertions, rejects unknown failures, and requires all 330 baseline collector rows plus its successful serial self-test, and all 337 after entries. No incomplete or duplicate inventory can contribute a timing ratio.

## Five idle pairs with bounded backfill

before admitted from an empty private history to bypass the whole-step reservation; execution unchanged; after uses the normal warmed history copied after its green --here. Measurement only.

| Pair | Whole s B/A | Whole ratio | Collector s B/A | Collector ratio | Load B/A | Ledger available GiB B/A | Ledger peak GiB B/A | Max reservation GiB B/A | Wait s B/A |
|---|---|---:|---|---:|---|---|---|---|---|
| 1 | 424.378/408.399 | 0.9623 | 340.7/382.5 | 1.1227 | 4.25/3.52 | 23.40/23.00 | 15.598/9.609 | 19.000/21.000 | 0.042/377.506 |
| 2 | 430.437/418.839 | 0.9731 | 346.4/385.8 | 1.1137 | 0.35/3.70 | 22.70/22.40 | 15.406/9.242 | 19.000/20.000 | 0.038/381.106 |
| 3 | 438.647/405.021 | 0.9233 | 354.7/382.8 | 1.0792 | 12.02/3.44 | 22.50/22.80 | 15.714/9.168 | 19.000/21.000 | 0.055/377.741 |
| 4 | 431.995/400.410 | 0.9269 | 347.6/376.2 | 1.0823 | 16.28/5.55 | 22.70/22.60 | 15.812/9.442 | 19.000/21.000 | 0.045/371.929 |
| 5 | 425.979/405.042 | 0.9508 | 341.9/380.2 | 1.1120 | 14.08/3.13 | 22.80/23.10 | 15.721/9.962 | 19.000/21.000 | 0.117/373.894 |

Whole median: 0.9508; every pair <=1.05: True.
Collector median: 1.1120; every collector ratio <=1.05: False.

All five after arms complete all 337 entries. Every baseline retains #842 and #856 failures; every after arm retains only #856. Each baseline serial self-test completes. Median ledger peak falls from 15.714 to 9.442 GiB; the whole-step median ratio is 0.95085 and the worst ratio is 0.97306. The idle wall-time criterion passes. Collector-only median ratio is 1.11202, a regression tracked by #857.

| Arm | Source | Own RSS GiB | Tree RSS GiB |
|---|---|---:|---:|
| before | `tooling/gate/owed.test.mjs` | 2.536 | 3.055 |
| before | `tooling/config/workspace-project.test.ts` | 0.081 | 2.632 |
| before | `tooling/gate/accepted-revision-data.test.ts` | 2.446 | 2.581 |
| before | `tooling/gate/oracle-record-owed.test.ts` | 2.430 | 2.556 |
| before | `tooling/landing/selection.test.ts` | 2.426 | 2.521 |
| after | `tooling/config/workspace-project.test.ts` | 0.093 | 2.583 |
| after | `tooling/gate/owed.test.mjs` | 2.403 | 2.573 |
| after | `tooling/gate/owed.mjs` | 2.328 | 2.512 |
| after | `tooling/gate/oracle-record-owed.test.ts` | 2.336 | 2.498 |
| after | `tooling/gate/precise-changes.test.ts` | 2.338 | 2.491 |

These external `/proc` RSS maxima include rooted descendants; shared pages may be counted more than once. Independent fixture services are included in the authoritative per-file cgroup peak, rather than process ancestry. The sampler can observe nested source processes as well as admitted entries.

## Controlled ordinary-agent-job arm

One real agent job reserves and touches 4 GiB, retaining that allocation while a single CPU-bound SHA-256 loop runs. The same PID and cgroup remain live at 4.0 GiB in all four start/end snapshots across the two arms. Its affinity excludes CPUs 4–5. The job runs from an immutable module-closure copy outside tree 10, so source switches cannot change it. It is stopped by its named unit after both arms drain. `agent-condition-verified.json` retains the readiness and four ledger lines.

before admitted from an empty private history to bypass the whole-step reservation; execution unchanged; after uses the normal warmed history copied after its green --here. Measurement only.

| Pair | Whole s B/A | Whole ratio | Collector s B/A | Collector ratio | Load B/A | Ledger available GiB B/A | Ledger peak GiB B/A | Max reservation GiB B/A | Wait s B/A |
|---|---|---:|---|---:|---|---|---|---|---|
| 1 | 448.806/441.651 | 0.9841 | 362.9/441.5 | 1.2166 | 5.56/4.96 | 19.30/19.40 | 16.183/8.668 | 15.000/17.000 | 326.623/436.102 |

Whole median: 0.9841; every pair <=1.05: True.
Collector median: 1.2166; every collector ratio <=1.05: False.

Both arms finish beside the real job. The whole-step ratio is 0.98406; the collector-only ratio is 1.21659, a regression under the same per-file footprint constraint tracked by #857. This is one controlled pair, separate from the five idle pairs. The baseline still uses its empty private history solely for measurement. Its growth waits while it executes, and it can hold more than its reservation; neither top-level tooling arm nor the controlled job is OOM-killed or stopped by its budget. Both complete their full entry sets, with the known #842/#856 outcomes retained.

## Bounded-backfill raw evidence

All raw/source hashes in these manifests were checked against their current bytes. The manifests cover summaries, full logs, per-file RSS samples, start/end machine conditions, timing and case histories, controller sources and the controlled job. The idle derived accounting also names every sampled file and its peak RSS.

- Green landing proof: `/home/akisarou/.cache/nts-scratch/848/here-backfill-ffbb/sha256.txt`, SHA-256 `2b36703ab8350dc08df2ea37d11edf8b5647eda6e4075106443c6273f60fbaac`.
- Five idle pairs: `/home/akisarou/.cache/nts-scratch/848/pairs-backfill-idle-ffbb588e60/sha256.txt`, SHA-256 `79a739e0325eef41c40a25339eea1967691bc3822510d2f323800b6736e677d0`.
- Controlled 4 GiB-job pair: `/home/akisarou/.cache/nts-scratch/848/pairs-backfill-agent-ffbb588e60/sha256.txt`, SHA-256 `8d03b355c2112f8941a8ab488cc7512ce576048131af6734b1c2323e07d38737`.

The per-arm `comparison.json` retains each known failure and raw-log line. For example, #856 occurs at `pairs-backfill-idle-ffbb588e60/1-before/environment/tooling-tests.raw.log:2031` and `1-after/environment/tooling-tests.raw.log:1957`, under the scratch root above. Every idle and controlled baseline retains the two #842 assertions and #856; every after arm retains only #856. The green `--here` run has neither failure.
