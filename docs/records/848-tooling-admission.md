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
