# Census worker caps (#789)

The census spent most of its leased overhead waiting for repeated systemd property writes. Persistent workers now retain their kernel caps, and the parent worker slice retains the sum of registered worker allowances until the acquired scopes depart. The calibrated full C and LLVM pairs reduced step wall by 30.2% and 53.9%. JVM is supportive, contended evidence.

## Cause and change

The first C slice held 1,298 leases and made 3,264 `systemctl set-property` calls: 1,323 each for worker and scope caps, and 309 each for step supervisor and worker caps. Attachment consumed 146.472 summed case-seconds under mean load 16.64. The old worker path rewrote matching caps; the parent cap followed active leases and fluctuated as cases attached and completed. These manager round trips occur while a case owns its lease.

The broker reads actual cgroup caps and ancestry on every lease using the existing filesystem owner. It writes only a differing cap and still verifies kernel readback. Per-lease peak resets, CPU accounting, history keys and meter closure remain fresh. Registered persistent workers retain acquired cgroup dev/inode identities; actual absence retires an allowance, while replacement or unreadability refuses. `StepScope.apply` updates only a sibling whose requested bound changed. The parent floor therefore changes with registration, cap changes and actual retirement, rather than every lease completion.

Supplied before/after accounting retains independent peaks 100/50/70, all three resets and closes, case keys and ancestry observations, while worker writes fall from six to one. This is accounting-contract parity; live CPU and wall are measured separately. Controls also retain a case at its full allowance during lease handoff without lowering the parent, resident workers without lease receipts, changed identities, absent scopes and unreadability.

## Matched slice and final floor

The ABBA alternates Git-authenticated old and conditional-write owners on the same compiler, directories and width. These use the intermediate conditional-write source `82a7c0512d5ea478ed71440b8123f771a3534b33` and `nts-dev` compiler SHA-256 `b43a4ebe7544c075406b6c0bd4f6b6ba0dd1b99378d88ee92183a54a18958241`; the later full census uses release and includes the persistent-worker floor.

| ABBA arm | Step wall s | Step CPU s | Controller CPU s | Attach case-s | Unspanned case-s | Mean load |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Old A1 | 54.604 | 113.130 | 18.803 | 37.232 | 49.177 | 1.95 |
| New B1 | 50.763 | 113.122 | 8.657 | 8.310 | 19.792 | 2.62 |
| New B2 | 51.207 | 112.246 | 8.693 | 9.075 | 20.724 | 2.06 |
| Old A2 | 55.107 | 114.215 | 18.647 | 38.182 | 50.332 | 3.11 |

A 30-second case limits this slice's critical path. The final floor repeat passed the same 1,298 leases in 50.187 step-wall / 115.394 step-CPU seconds, with 2.551 attach case-seconds, 11.980 unspanned case-seconds and 130 property calls (54 step-worker, 31 worker, 45 scope). This repeat is unpaired and supplies call-count evidence, not a second calibrated speed ratio.

## Full release census pairs

All six arms use the full check's plain `cargo build --release -q` route, the same release compiler SHA-256 `7d89bfae8c8b50f06e969f1c5d44b2ab5f643cd824bf568d3f72dec50a4423cc`, Test262 pin `14e8c908e54ae2e770e473bcacf536f8cb654929`, width eight and the unchanged production command. The frozen tree is `bbe38a2cdbea6a9ac81770e9f1dce56ae977c43d`; exact Git-buffer imports select old owners at `2c5ecea8ef72c5dc50fad2b84c8b56e5b77c7880` or the new owners. The terminal records prove each selected owner loaded once. Source receipts bind the launcher, command, compiler and preparation.

Order is C old/new, LLVM new/old, JVM old/new. All arms pass recorded outcome checks. The complete five directory reports retain equal compiler/harness identities and aggregate outcome counts; this is not per-case output-byte identity. JVM language alone changes `degraded` from false to true, retained separately from outcome equality.

| Backend / arm | Step wall s | Step CPU s | Controller CPU s | Attach case-s | Property calls | Mean load |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C old | 821.666 | 2429.229 | 647.369 | 1879.636 | 137,418 | 4.58 |
| C new | 573.425 | 2495.164 | 236.679 | 49.909 | 5,075 | 7.62 |
| LLVM old | 725.450 | 2063.476 | 734.247 | 2332.373 | 124,548 | 6.10 |
| LLVM new | 334.133 | 2040.636 | 153.393 | 24.293 | 2,826 | 6.98 |
| JVM old | 743.497 | 1894.054 | 640.967 | 2221.644 | 118,794 | 5.27 |
| JVM new | 646.305 | 2566.243 | 328.010 | 83.277 | 5,254 | 26.86 |

C step CPU rose 2.7%; its controller CPU fell. Their disjoint owned-scope total falls from 3,076.598 to 2,731.843 CPU seconds (11.2%). This sum excludes the systemd manager and makes no whole-machine CPU or instruction-count claim.

The full check's wide run on `39a3a07fd14a` starts at 22:29:08.374 UTC (its gate starts at 22:29:11.708). JVM old spans 22:17:40.063–22:30:11.198 UTC and new spans 22:30:11.198–22:41:08.469 UTC. The retained later wide status proves it remained active beyond both arms: old overlaps only its last 62.824 seconds, new overlaps throughout. Mean load rises from 5.27 to 26.86. JVM is contended and excluded from performance/bound calibration; its actual CPU remains usable sizing data. C and LLVM precede the wide and have no overlapping census; their sampled load still includes other machine work.

| Backend / arm | Supervisor calls | Step-worker calls | Worker calls | Scope calls |
| --- | ---: | ---: | ---: | ---: |
| C old | 21,625 | 21,625 | 47,084 | 47,084 |
| C new | 4,948 | 51 | 31 | 45 |
| LLVM old | 19,749 | 19,749 | 42,525 | 42,525 |
| LLVM new | 2,685 | 62 | 22 | 57 |
| JVM old | 16,872 | 16,872 | 42,525 | 42,525 |
| JVM new | 5,116 | 55 | 36 | 47 |

Remaining supervisor writes follow the controller's live step-reservation/runaway-bound increases while token requests are answered; they do not rewrite the persistent worker floor per lease. The old parent updates could coalesce. Counts are actual calls, not an assumed call per attach. Full-table counts cover all parent-spawned calls; the narrower ABBA attach instrumentation has a different scope. Attachment totals count scope attachments, including repeated self-check attachments within one lease; the lease table counts token lifetimes.

## Per-case attribution

Raw queue, native check and worker phase records are joined by case/request identity and authenticated before aggregation. Case-seconds sum concurrent leases and cannot be read as step wall.

| Backend / arm | Leases | Complete compiler terminals | Lease case-s | Known phase CPU s | Unspanned known case-s | Grant to compiler case-s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C old | 47,059 | 47,056 | 4902.447 | 1827.446 | 2803.786 | 2453.679 |
| C new | 47,059 | 47,056 | 2978.841 | 1883.283 | 824.158 | 507.481 |
| LLVM old | 42,500 | 42,497 | 5145.800 | 1667.146 | 3356.790 | 2977.970 |
| LLVM new | 42,500 | 42,497 | 2285.658 | 1645.507 | 554.829 | 349.885 |
| JVM old | 42,500 | 42,496 | 4790.531 | 1381.418 | 3072.178 | 2878.474 |
| JVM new | 42,500 | 42,496 | 3711.147 | 1892.562 | 1320.723 | 823.078 |

Three C/LLVM cases and four JVM cases lack complete compiler phase terminals. Capture/lowering/emission totals remain unknown where incomplete; known partial observations are retained. Unspanned totals above cover only complete joined records. Scope CPU is independently complete. Missing terminal observations are not zero-cost cases.

The new C tail was a serial host C compile of `test/staging/sm/String/string-upper-lower-mapping.js`: passive owned `/proc` and cgroup samples show roughly one CPU-second per second in `cc1`. It is work on the critical path, not an idle manager wait.

## Derived bound and baseline

The three fixed one-hour census fields are removed. The existing `stepBound` owner derives allowances from measured tree CPU history or the committed baseline and the concurrent plan. The baseline's three rows were serialized by the exact Git-authenticated `run.mjs::recordTimes` function over the healthy new release summaries, retaining the old file bytes verbatim. JVM is explicitly labelled sizing-only. No hand-computed bound is frozen in code.

As a concurrent-wide check, use the larger uncontended new census CPU, 2,495.164312 s, for each of three censuses. The other fifteen steps in the retained green wide at `077ebae9a22a` total 15,716.417992 scope-CPU seconds. Thus plan CPU is 23,201.910928 s at 24 slots; the existing rule yields `ceil(max(3600, 3 × (2495.164312 / 8 + 23201.910928 / 24))) = 3836 s`. This is a forecast using the measured new census and a historical concurrent plan, not an observed new concurrent wide. The historical wide has its own distinct compiler identity. Runtime bounds continue to follow current plan/history.

## Validation and retained limitations

Source `39556227413b7f0b31845eae4c6d1c9cbadb1992` passes the focused 54-test batch, timing lint, host audit and strict checking; final preflight keeps exact full/unplaced/policy arrays equal at 178/142/36 with no problems. The ordinary supported run passes all 19 summary steps in 521.238 seconds (20 CLI steps including build), with canonical environment, no experiments, complete cleanup and diagnostics. Native reports 3,047 pass / zero fail / eight ignored; tooling reports 2,359 pass / zero fail / two TODO. Actual `inner.ts --no-agree` passes format, Clippy, build and backend tests. Its sequential chain is fully drained.

The four measured owner files remain byte-exact from the six-arm source through the proof pin. Subsequent source changes retire the fixed bounds, serialize the measured baseline, state the contract and supply the private admission-fixture bound; the only post-proof change is this Markdown record.

The first whole-cohort attempt accidentally used `nts-dev`, so its old C red and interrupted new C are excluded from release performance and sizing. Fifteen existing flow-fixpoint assertion cases were inventoried with exact backend/pin/log hashes on [#492](https://github.com/AkisArou/nts/issues/492#issuecomment-6884542147); compiler work remains held. A normal release preparation precedes every accepted full arm.

Other retained refusals are source-audit placement of the initial identity read, private analysis aggregation of JVM's degraded flag, oversized analysis serialization, the first supported fixture setup red, and an abbreviated-pin launch rejected before proof. None supports a green claim. The kernel identity read now resides in the existing memory-limits leaf; the fixture supplies its own bound independently of production.

A copied preflight launcher accidentally overwrote four historical #786 artifacts. Two were restored by exact SHA; the two original full placement dumps remain missing. The loss and surviving support are explicit in [#786](https://github.com/AkisArou/nts/issues/786#issuecomment-6885711689). New #789 outputs were saved separately, with a migration receipt; the final preflight uses a fresh versioned directory and one issue variable. No nonmatching reconstruction is presented as historical evidence.

## Raw evidence

Retained manifest: `/home/akisarou/.cache/nts-scratch/789/retained-v1/manifest.json`; SHA-256 `6613c6e842da5d8b0cdccab185a2b952988bd886e9548ab2f3f2d95ef692228c`. It binds 551 retained artifact files / 247,055,272 encoded bytes and 30 Git source receipts. The original independent authentication covered 271,412 artifacts / 3,031,509,702 bytes with zero errors; that full index is historical after pruning.

Raw outputs remain in the kept `/home/akisarou/.cache/nts-scratch/789` folder; no raw JSON is committed. Complete per-arm summaries and large raw streams use lossless gzip. Six `tar+gzip` phase archives consolidate 264,304 exact native/worker/queue files; the manifest records their membership counts and bytes, and retained per-case rows keep the table directly readable. Expected outcome TSVs and actual comparison/pending logs remain distinct; no missing full observed-outcome map is invented. The small existing #492/#786/#761 citation anchors stay at their original paths. Regenerable run trees, package installations, compiled outputs and duplicate materializations are retired only after this citation lands.
