# Tooling file admission measurements

Issue #848 measured the fixed tooling step and the first complete per-file implementation in the same pool tree. Both runs were contended by the full check and benchmark service; neither is an idle-machine comparison. The compiler body was unchanged.

| Source | Collected files | Step wall (s) | Scope CPU (s) | Ledger peak (GiB) | Raw cgroup peak (GiB) |
|---|---:|---:|---:|---:|---:|
| `39f4978a723067b4f99b6639aa8967551a4827bc` | 330 | 440.819 | 5791.544 | 15.534 | 17.366 |
| `943f6728dda53dca966156a39c0cc3ac0ff33b27` | 332 | 455.990 | 5540.523 | 15.488 | 17.590 |

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
