# Bounded selector batches and tooling file memory

Issues #857 and #780 share the same retained-snapshot owner. The profiling base is `e6162a71245e04e1381d57b9a8f3443b1234fd1c`.

## Completion ruling and review

The coordinator ruled that this change completes #857 through its “peak falls by at least half, or its retained memory is shown to be needed” alternative. The normal-cap rows below do not show a halving of whole-file peaks. They attribute each remaining peak to the native parser/Program owner or to real installation and fixture-route work. [#1003](https://github.com/AkisArou/nts/issues/1003) owns native parser residency and [#1007](https://github.com/AkisArou/nts/issues/1007) owns incidental fixture installation breadth; those separate tasks do not keep #857 open. This ruling does not claim that idle parser residency or excess package breadth is intrinsically necessary.

The coordinator also accepted the interleaved loaded collector pairs as the comparison after no quiet interval arrived within three hours. They replace the requested idle comparison for this task. They remain labelled as loaded, include priority yields and disagree in timing direction; they establish no idle throughput improvement. The commit closes #857 and #780 under that ruling.

After review, `describeBatch` delegates to `mapDescriptions` and `describeAll` delegates to `mapAll`, so each API pair shares one transaction body. Per-row `sourceInputs` is documented as progressive capture evidence, not a target-specific source closure; only the complete batch's union binds graph-wide inputs. The source-union control compares projection against separate canonical visitors. The rejected native-retirement commits and their revert are absent from the landing branch; their source and evidence remain reachable through the cited commits and kept scratch. Measurements below continue to name the exact revisions measured.

## Retained objects

The normal file cap is 6,144,000,000 bytes; the observed V8 heap limit is 2,248,146,944 bytes. All ten named entries pass. The probes retain per-process RSS, including native TypeScript parser and Program children, and take V8 snapshots at the retained batch boundary. Entries without a large retained batch are captured at exit. The workspace row uses a separate capture of its actual selector child query.

These are attribution diagnostics, not timing or uninstrumented peak measurements: writing a heap snapshot raises RSS and CPU. Other admitted work was active during profiling.

`moduleGraph.withDescriptions` saves full snapshot copies until scope-end replay. `rustRuntimeInputGraph.describeAll` also retains every returned full target snapshot. The retaining paths are `Context.snapshots -> InputSnapshot.observations[] -> ReaderObservation.context/observation/causes` and `describeBatch results[].snapshot`. The first Rust batch has 57 targets and about 597 thousand observation rows; it is nested inside a larger step-input batch.

The joint-retention analysis cuts every alias of the selected snapshot payload and measures what loses its last strong root. It counts shared objects once and preserves independently rooted objects. Its shared-alias diamond control retains externally rooted data and reports the expected 256-byte observation cut and 320-byte payload cut. Constructor retained totals overlap and are not added.

| Entry | Snapshot-shaped objects | Strong-root graph MiB | Joint observation payload MiB | Joint full-snapshot payload MiB |
|---|---:|---:|---:|---:|
| `owed.mjs` | 1359 | 1003.69 | 521.47 | 610.46 |
| `owed.test.mjs` | 1245 | 431.06 | 113.45 | 190.81 |
| `selection.test.ts` | 1359 | 924.80 | 453.74 | 542.71 |
| `accepted-revision-data.test.ts` | 1360 | 925.03 | 453.74 | 542.72 |
| `precise-changes.test.ts` | 1359 | 923.75 | 453.73 | 542.72 |
| `workspace-project.test.ts` | 1360 | 916.10 | 453.75 | 542.72 |
| `record-pending-selector.test.ts` | 1 | 24.69 | 0.00 | 0.00 |
| `owed-range.test.ts` | 1 | 25.78 | 0.00 | 0.00 |
| `oracle-dependencies.test.ts` | 1 | 30.95 | 0.00 | 0.00 |
| `typescript-record-cli.test.ts` | 1 | 23.40 | 0.00 | 0.00 |

The accepted-revision, precise-changes and landing-selection captures reproduce about 475.8 MB of joint observation retention and 569.1 MB of full snapshot payload. The accepted-revision graph cut removes 58.7% of the strongly retained graph. The selector entry retains more; its capture includes the accepted-source route. The `owed.test.mjs` capture is its first outer step-input batch, before its later Rust batch.

The four record/range/oracle/CLI test processes no longer retain hundreds of MiB of these snapshots on this base. Their installer/compiler children remain included in RSS sampling. Their terminal heap graphs are small; their required child work is separate from the snapshot holder.

Raw dumps are losslessly compressed after retainer extraction. Each `.archive.json` stores the original, decompressed and archive SHA-256 values; decompression is verified before the uncompressed copy is removed. Raw logs, RSS samples, archive hashes and instrument sources are covered by:

- `/home/akisarou/.cache/nts-scratch/857/base-profile-sha256-resolved.txt`; SHA-256 `4bc2f4bd0ae2ba6792b63274cd70401942d4268fd01796f113caea7410a591ab`.
- `/home/akisarou/.cache/nts-scratch/857/base-retainers.json`; SHA-256 `3413a2c9936a4d9de3b7cbed0cb149a90342e1f99af36891458bb0a27dc0d0b9`.

## Ownership and controls

Projecting consumers take the existing selector roles from one target snapshot at a time inside the same synchronous transaction. The fence retains distinct observation answers, authority descriptors, project matches and physical membership facts. It replays them before returning any result. Full-snapshot APIs retain independent mutable outputs; request caches remain confined to the call.

The lifetime assertion marks one observation wrapper in each complete snapshot and uses `v8.queryObjects` to require exactly the current wrapper during projection and none after return. The focused controls also compare every consumed role and reader/context provenance, distinguish generated private contexts, reject source/package/membership/negative/SDK changes before publication, and close parser, Program and generated owners on projection, validation and cleanup failures.

## Earlier composed-batch evidence

#761 measured the original 55-target composition. Its v6/v7 receipts and profile remain the initial component evidence, not a claim about the present full collector. All 55 source/name/kind identities are still present; the two newer publication targets are outside that matched cohort and remain in the full 57-target proofs.

- `/home/akisarou/.cache/nts-scratch/761/runtime-table-probe-v6.json`; SHA-256 `214ea0f377f65fe92c9dee672e7e21b9eef24fef1be25dba92f2dd8b640ed883`.
- `/home/akisarou/.cache/nts-scratch/761/runtime-table-probe-v7.json`; SHA-256 `db69d8c8533a3a4314a9c977e6833eb296a32f56b807070518c5fec88e51d9fc`.
- `/home/akisarou/.cache/nts-scratch/761/runtime-table-profile-v7.cpuprofile`; SHA-256 `8ba4bb867d9b26033f3b11dadfec4d3d5ca4f790c6398e0db25fca23e7c8da67`.

## Step-inference lifetime

The intermediate `cf5fce7d949bcc50348409e0028e6b5fd17ab2c2` capture identifies
another transient holder: `stepInputGraph`'s `inferred` Map retains per-module
references with `metadata -> InputSnapshot`. The accepted-revision capture's
Map retains 143,126,880 bytes through `Context.inferred -> Map/table ->
references.metadata`. It is used only inside the step-discovery loop. No code
after that loop reads it, and later calls use the memoized final graph. The
loop clears it in `finally`, before Rust selection, preserving every detached
fact already accumulated in the final graph.

The existing first owed test observes the actual cache and marks its first
complete snapshot for `v8.queryObjects`. It requires the snapshot to be gone and
the cache to be empty before Rust selection, verifies that a later call returns
the same final graph without another inference, and checks release after an
injected discovery failure. Its original name and selector assertion remain.

The resolved baseline manifest preserves the original instrument hashes under
versioned source paths: `profile-worker.base.mjs` and `profile-run.v1.mjs`. The
runner was later extended for after captures; baseline raw output is unchanged.

## Remaining native parser holder

A normal-cap, snapshot-free trace on `8a941533b05eeef127aa24710429a262faf474e5`
finds an idle parser retaining 769,449,984 bytes of RSS immediately before a
fresh two-root Program. Its owner path is `moduleGraph -> api ->
API.client.channel.child`; it has zero SourceFile leases and zero Program
snapshots at that point. Separate per-process peaks are not added. This
residency remains in the final batch/inference change. Entries that do not
reach half their former peak identify this holder and [#1003](https://github.com/AkisArou/nts/issues/1003),
which owns using the Program's existing ASTs or a measured parser reuse design.

An experimental native retirement before each Program/config capture was
reverted after its explicit stop rule fired. In 91.516 seconds of the first
accepted-revision entry it started 223 APIs (221 reacquisitions) for 2,985
parses across two graphs. Of 222 retired sessions, 168 parsed exactly one
source. The entry was stopped by `nts-857-verification-native-v2.service`;
its partial peak/wall and the subsequent cancelled setup attempts are not
measurement rows. The experiment's lifetime control passed 16/16 versus
15/16 without retirement, proving release but not acceptable restart cost.
The final code contains neither retirement nor its extra native-child control.

- `/home/akisarou/.cache/nts-scratch/857/native-lifetime/trace.jsonl`; SHA-256 `0fa549360f89998f1cdf1a537ad04b3d592e157c48a258001f74685fa9177dd0`.
- `/home/akisarou/.cache/nts-scratch/857/native-lifetime/source-receipt.json`; SHA-256 `29225f4f2643393bcb0fecf7f053b44fde70d82d17cc77d66ba4e3e3a927f862`.
- `/home/akisarou/.cache/nts-scratch/857/native-lifetime/terminal.json`; SHA-256 `76a451c1c3483e915a0de40bbcfe5fa369bdd7ef8d9e8a262a7adae62288b324`.
- `/home/akisarou/.cache/nts-scratch/857/parser-counts/aborted-parser-restarts.json`; SHA-256 `39f89e907a296742bdf372bc4a24f6708594395e10bc121d140e19a6c9ec58d2`.
- `/home/akisarou/.cache/nts-scratch/857/parser-counts/sha256.txt`; SHA-256 `5974eaee9d53f8ebdaa7c83a64de36521b49b09bcc194f2446a16db05a041adf`.

## Committed-source lifetime controls

The projecting-batch control passes 16/16 on `cf5fce7d949b`; replacing the
scoped projection with eager accumulation fails three controls (13/16),
including two complete snapshots alive where one is required. The inference
control on `5d239f010afb` passes all 124 original owed tests; removing only
the inference-cache clear fails the first snapshot assertion at one instead
of zero (123/124). Both counterfactuals use in-memory loaders and leave the
committed source bytes unchanged. The inference observer deliberately keeps
no mock call history that could itself retain its snapshot arguments.

## Matched 55-target component

The component comparison runs `describeAll` and `mapAll` at the same committed
`cf5fce7d949bcc50348409e0028e6b5fd17ab2c2`. The accumulator's gain is shared by
both arms, so the measured reduction is a lower bound on the change against
`e616`. The whole-collector pairs carry the end-to-end comparison.

A scratch-only loader filters the target dispatch map to #761's authenticated
55 source/name/kind identities, identically in both arms. Inventory, declaration
binding and Cargo linkage retain all 57 targets. The two newer targets remain
in the full 57-target production proofs. The partial harness omits
`assertComplete`; production and full-inventory controls keep it unchanged.
Every consumed identity must match the authenticated cohort exactly, and every
unvisited manifest reader must belong to the production `rustBuildModules` /
`cargoRuntimeRoots` closure of an excluded target. No exception list is kept.
The only unvisited reader is `tooling/publication/tests/publication.rs`.

The meter belongs to each fresh body scope and includes its controller, graph
and every native SDK child. It includes import-time peak and is read before
proof serialization. All six role/provenance payloads and complete source
unions match directly. These are loaded runs; wall times are descriptive.

| Row | API | Cgroup peak MiB | Cgroup CPU s | Wall s |
|---|---|---:|---:|---:|
| warmup A | `describeAll` | 1068.46 | 81.267 | 48.215 |
| warmup B | `mapAll` | 755.39 | 80.373 | 52.280 |
| pair 1 B | `mapAll` | 673.00 | 91.774 | 69.736 |
| pair 1 A | `describeAll` | 869.84 | 120.964 | 130.627 |
| pair 2 A | `describeAll` | 1020.52 | 90.174 | 54.770 |
| pair 2 B | `mapAll` | 674.77 | 82.299 | 47.913 |

The measured streaming/eager peak ratios are 0.774 and 0.661 (22.6% and 33.9%
lower). The canonical role/provenance digest is
`afdc99d88084dc397d9d880a3334827c91033d910d39db49f75d7312037f5345`;
the source-union digest is
`b1bb120945d4e7e0923c1520788dde2d380b4e53a305ffd98de65b9954e16e7d`.

Counted controls use CPU 0, outside the reserved CPUs 4–5, under the production
`perf-count` owner and measurement mutex. Both arms run the same committed
source and the same complete proof serialization. The P-core instructions
event reports 100% running; the hybrid atom event is unavailable on CPU 0 and
is not treated as a zero count. No benchmark row changes.

| Pair/order | API | Instructions | Scope peak MiB |
|---|---|---:|---:|
| 1 B | `mapAll` | 684,985,508,401 | 740.21 |
| 1 A | `describeAll` | 707,888,203,212 | 897.80 |
| 2 A | `describeAll` | 707,688,016,921 | 1084.84 |
| 2 B | `mapAll` | 687,098,922,543 | 724.05 |

Streaming/eager instruction ratios are 0.96765 and 0.97091.

- `/home/akisarou/.cache/nts-scratch/857/measurements/cohort-normal-v2-sha256.txt`; SHA-256 `4a2141b561bb5b67d4cb8422a045b8bb35374adc6b48f3f9940d9a7f95da5647`.

- `/home/akisarou/.cache/nts-scratch/857/measurements/cohort-count-v2-sha256.txt`; SHA-256 `6f3cdb8ac5e6b4a7217808f4b8f7b062275b682ad16d078b4d0388a7c81555ca`.


## Matched-cohort bindings

The same scratch-only dispatch hook is used in normal and counted arms at `cf5fce7d949bcc50348409e0028e6b5fd17ab2c2`. These bindings accompany the source and role/source-union digests above. The hook is absent from production and from the committed change.

- `/home/akisarou/.cache/nts-scratch/857/measurements/cohort-normal-v2/cohort-hook.mjs`; SHA-256 `7f74823d6d5607b071ce561c8818eb4802b331d57a9f643dcd0f9cad521c91c0`.
- `/home/akisarou/.cache/nts-scratch/857/measurements/cohort-normal-v2/identities.json`; SHA-256 `1161ea4268408a1b168cc937cd27f54b6a68177da9a6d06c553df144d18a3032`.
- `/home/akisarou/.cache/nts-scratch/857/measurements/cohort-normal-v2/dispatch-identities.json`; SHA-256 `74288d839f9871a683c303eaac34321f6307f380abc872a4416d18fd57b0f646`.
- `/home/akisarou/.cache/nts-scratch/857/measurements/cohort-normal-v2/source-receipt.json`; SHA-256 `8481998843d682c5c00d7378e160cd8ed91e1ff1052a5f39253d0e0c0cdaa256`.

## Collector setup and reproduction

The end-to-end arms compare `e6162a71245e04e1381d57b9a8f3443b1234fd1c` with `2b608baa2ba05da8d176edadb7fede81c5833253` on the same base. Compiler, runtime, differential producer and Cargo source bytes are identical across those revisions. Both arms drive the same complete compiler bundle, built through the ordinary `nts-dev` build owner. Production `run.mjs` pins the compiler, planner, suite and test262 protocol together before running tooling. Each arm's actual summary is checked against all four expected member hashes.

The retained immutable bundle is `/home/akisarou/.cache/nts-scratch/857/compiler-pins/f6e5881fd7cfee54d162a2d04004cdc5c5744a3aaf565def1fc2557a242a0012`; its compiler SHA-256 is `9d7cd8d088598762452f7ed336074dcc5a91af1cf6e8a3222464d7b9b1258dcd`. The original primary-tree compiler outputs stayed frozen throughout the collector comparison. The setup receipt records the adjacent member hashes, source equality check and normal build log.

The approved measurement repository is an independent `git clone --shared` with a separate Git directory, not an extra worktree. Its object alternate reads main's object store. Each arm's private `main` ref names that arm's measured committed revision to model acceptance; shared main refs and source remain read-only. Its private owner supplies only its own `third_party` symlink to main's corpora.

The production pnpm registry store measured 195,245,486 bytes and was copied privately. Free space was 48,735,596,544 bytes before and 48,534,470,656 bytes afterward, both above 45 GiB. No reflink or hard-link fallback was used. The source store is never an installation target. The clone's owner-derived cache mapping is:

- Tree: `/home/akisarou/.cache/nts-scratch/857/collector-clone`.
- Git/input owner: `/home/akisarou/.cache/nts-scratch/857/collector-input-owner`.
- Private cache: `/home/akisarou/.cache/nts-scratch/857/collector-dependency-cache`.
- Only owned global alias: `/home/akisarou/.cache/nts-dependencies/09db339b366a41783c0dcdec16c5845d2b2a2cb8f18864cb58a33fc7906d6264`, pointing to that private cache.

The arms use separate `history-v2-before` and `history-v2-after` scheduling histories, one successful warmup each, the same canonical environment, normal finite file caps and full test inventory. No job-count option, parallelism cap, admission, margin or lease change is applied. Production reports a maximum of 29 concurrent files; observed maxima are sampled separately. Each arm runs in its own named systemd unit with Nice 19 and CPUWeight 20, excluding CPUs 4–5. The RSS observer runs on CPUs 16–31. Machine load and live ledger holders are retained beside every row. The quiet-window deadline expired, so these are disclosed loaded pairs.

The first setup attempt is excluded as a setup failure, not omitted performance evidence. It used an older release compiler whose oracle producer identity differed and whose adjacent planner was absent. `program-oracles` and `benchmark-shadow` exposed that mismatch; its own named unit was stopped. The corrected bundle passes focused setup controls (7/7 program-oracle tests and 1/1 benchmark-shadow test), and fresh private histories are used for all rows shown here. `/home/akisarou/.cache/nts-scratch/857/measurements/invalid-v1-setup.json` identifies the excluded raw run and compiler hash.

## Whole-collector comparison

Both arms use the same compiler bundle and finite production caps. Each has a private scheduling history and one successful warmup. The measured order is A/B, B/A, A/B. Pair 1 after failed one unchanged live-clock fixture and is retained in full below, not treated as a green pair. The two subsequent pairs are green. These are loaded pairs: the quiet-window deadline elapsed before warmups ended. Admission and priority yields remain included in collector time.

The origin is the tooling-file collector's monotonic start after gate preparation; arm-wide setup/queue time is retained separately in its terminal and analysis receipts. Collector time ends at the last ordinary tooling file; the separately scheduled `owed.mjs` selector self-test is omitted from that endpoint and mean, with its own wall time shown separately. Its overlapping execution remains present in both arms. Mean concurrency is summed ordinary file wall time divided by collector time; maximum concurrency counts observed inventory file leases, with nested fixture runners kept inside their parent entry. Starts have the production report's 0.1-second precision.

| Row | Verdict | Collector s | Mean files | Sampled max files | Tooling step wall / CPU s | Selector self-test s | Load 1 min–max | Other agent / landing / culprit jobs, max |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| warm-before | PASS | 2892.868 | 2.96 | — | 2901.263 / 6751.630 | 124.712 | 15.18–157.03 | 3 / 2 / 2 |
| warm-after | PASS | 572.348 | 14.40 | — | 572.829 / 6270.226 | 153.246 | 11.08–78.40 | 5 / 0 / 2 |
| pair1-before | PASS | 511.415 | 10.46 | 23 | 585.036 / 5501.563 | 173.297 | 18.13–44.32 | 2 / 0 / 1 |
| pair1-after | FAIL ([#1008](https://github.com/AkisArou/nts/issues/1008)) | 664.376 | 8.11 | 23 | 675.620 / 5441.588 | 158.061 | 19.27–54.26 | 4 / 0 / 1 |
| pair2-after | PASS | 662.415 | 8.36 | 24 | 662.683 / 5490.787 | 148.274 | 19.13–46.16 | 6 / 0 / 2 |
| pair2-before | PASS | 2293.629 | 2.84 | 24 | 2293.805 / 6192.480 | 154.894 | 12.02–133.52 | 10 / 2 / 1 |
| pair3-before | PASS | 1192.934 | 5.08 | 24 | 1193.593 / 5925.135 | 151.523 | 17.59–73.21 | 11 / 0 / 2 |
| pair3-after | PASS | 1955.145 | 3.41 | 23 | 1955.492 / 6112.075 | 116.997 | 14.29–183.16 | 9 / 0 / 2 |

The largest external ledger holder by sampled live charge is identified for each row below. Live-charge and reservation maxima are separate maxima, not simultaneous RSS measurements; the complete sampled ledger is retained with each row.

| Row | Largest external holder | Max live charge / reservation GiB |
|---|---|---:|
| warm-before | culprit-search: `gate run full-check/core-5c00b70387d0-20261124T001522Z` | 10.09 / 18.62 |
| warm-after | culprit-search: `pinned compiler preparation 5c00b70387` | 4.08 / 5.84 |
| pair1-before | culprit-search: `pinned compiler preparation 094aa95195` | 4.53 / 5.84 |
| pair1-after | agent: `968 final complete release build` | 4.46 / 6.03 |
| pair2-after | culprit-search: `pinned compiler preparation 9f09890a0e` | 3.90 / 5.88 |
| pair2-before | culprit-search: `gate run full-check/core-dc669ade6118-20261124T021653Z` | 10.91 / 19.70 |
| pair3-before | culprit-search: `gate run full-check/core-dc669ade6118-20261124T021653Z` | 4.65 / 8.70 |
| pair3-after | culprit-search: `gate run full-check/core-2017bf23a3de-20261124T031115Z` | 11.47 / 19.00 |

Warmup maxima are omitted because the full-lease observer started during the after warmup; the measured pairs have identical observer coverage.

Pair 1 after failed only `tooling/full-check/measure.test.ts`: “a run whose temporary has its disk is admitted at once, with no disk wait and no hold”. Its live 2-second stall bound fired during startup (0.2 CPU seconds and 2 seconds stalled, status 124 instead of 0). [#1008](https://github.com/AkisArou/nts/issues/1008) owns that load-sensitive fixture. All ten memory targets passed. No test, bound or admission setting was changed; B/A and then A/B were added with both private histories retained.

Pair 1 (not a green pair; descriptive only): after/before collector-time ratio 1.2991; mean-concurrency ratio 0.7754; selector wall-time ratio 0.9121.

Pair 2 (green pair): after/before collector-time ratio 0.2888; mean-concurrency ratio 2.9461; selector wall-time ratio 0.9573.

Pair 3 (green pair): after/before collector-time ratio 1.6389; mean-concurrency ratio 0.6722; selector wall-time ratio 0.7721.

## Normal per-entry peaks and wall time

All entries below run without heap-snapshot instrumentation. Pair 1 retains the failed whole-step arm described above; all ten listed entries passed. RSS is sampled every 500 ms: own RSS is the Node test worker; lease RSS sums unique processes under the complete resident file lease, including its controller and bounded compiler/SDK children. Analysis deduplicates PIDs observed in two cgroups during a move, using their larger sampled RSS, identically for every arm. Shared pages can still be counted more than once across different processes. Native RSS identifies SDK `tsc --api` children in the same sample as the lease RSS peak; it is part of that total, not an added independent peak. Case peak is the production scheduling history's kernel scope peak, which also accounts for charged cache and staging work. It is a distinct measurement, not RSS. Values are MiB. B/A columns contain before then after.

| Pair | Entry | Own RSS B/A | Lease RSS B/A | Native at lease peak B/A | Case peak B/A | Wall s B/A | Lease RSS A/B | Case peak A/B |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| 1 | `owed.mjs` | 1690.3 / 1009.8 | 2097.8 / 2149.2 | 1054.1 / 1086.8 | 2699.3 / 2834.1 | 173.297 / 158.061 | 1.024 | 1.050 |
| 1 | `owed.test.mjs` | 1597.1 / 1299.0 | 2292.1 / 2270.6 | 1204.1 / 1064.7 | 2424.1 / 2346.8 | 345.914 / 387.116 | 0.991 | 0.968 |
| 1 | `selection.test.ts` | 1599.4 / 1072.6 | 2226.5 / 2144.7 | 1421.0 / 1069.1 | 2222.8 / 2189.8 | 152.320 / 148.223 | 0.963 | 0.985 |
| 1 | `accepted-revision-data.test.ts` | 1511.8 / 1005.8 | 2114.3 / 2146.6 | 1057.5 / 1067.7 | 2163.5 / 2104.7 | 127.840 / 151.545 | 1.015 | 0.973 |
| 1 | `precise-changes.test.ts` | 1618.3 / 1072.8 | 2149.8 / 2114.1 | 1067.6 / 1074.4 | 2343.6 / 2037.9 | 135.764 / 138.037 | 0.983 | 0.870 |
| 1 | `workspace-project.test.ts` | 86.2 / 86.4 | 2401.9 / 2177.2 | 1233.6 / 1065.8 | 2242.8 / 2049.2 | 166.915 / 140.746 | 0.906 | 0.914 |
| 1 | `record-pending-selector.test.ts` | 363.3 / 347.5 | 1049.9 / 980.3 | 0.0 / 0.0 | 1336.3 / 1399.5 | 229.082 / 223.156 | 0.934 | 1.047 |
| 1 | `owed-range.test.ts` | 329.6 / 334.9 | 972.8 / 996.0 | 0.0 / 0.0 | 1406.4 / 1340.2 | 186.816 / 199.425 | 1.024 | 0.953 |
| 1 | `oracle-dependencies.test.ts` | 336.7 / 338.5 | 873.3 / 904.3 | 0.0 / 0.0 | 876.0 / 991.2 | 216.060 / 279.034 | 1.035 | 1.132 |
| 1 | `typescript-record-cli.test.ts` | 442.6 / 464.0 | 1308.4 / 1153.5 | 0.0 / 0.0 | 1522.4 / 1439.0 | 161.265 / 206.957 | 0.882 | 0.945 |
| 2 | `owed.mjs` | 1494.1 / 968.2 | 2141.4 / 2073.9 | 1071.0 / 1157.4 | 2957.7 / 2887.7 | 154.894 / 148.274 | 0.968 | 0.976 |
| 2 | `owed.test.mjs` | 1591.5 / 1272.5 | 2244.4 / 2461.8 | 1054.0 / 1090.7 | 2445.4 / 2462.5 | 354.554 / 349.905 | 1.097 | 1.007 |
| 2 | `selection.test.ts` | 1518.1 / 967.8 | 2189.1 / 2184.4 | 1104.6 / 1132.8 | 2148.3 / 2092.7 | 167.028 / 130.943 | 0.998 | 0.974 |
| 2 | `accepted-revision-data.test.ts` | 1521.3 / 974.2 | 2091.8 / 2377.0 | 1063.6 / 1518.8 | 2030.9 / 2297.4 | 260.659 / 152.844 | 1.136 | 1.131 |
| 2 | `precise-changes.test.ts` | 1503.5 / 955.7 | 2144.4 / 2193.2 | 1111.2 / 1146.0 | 2151.7 / 2164.1 | 182.821 / 127.178 | 1.023 | 1.006 |
| 2 | `workspace-project.test.ts` | 86.1 / 85.9 | 2276.7 / 2192.2 | 1106.1 / 1064.7 | 2240.3 / 2139.4 | 168.173 / 125.677 | 0.963 | 0.955 |
| 2 | `record-pending-selector.test.ts` | 338.7 / 382.2 | 1083.7 / 1132.3 | 0.0 / 0.0 | 1292.9 / 1362.4 | 228.780 / 227.019 | 1.045 | 1.054 |
| 2 | `owed-range.test.ts` | 326.0 / 333.0 | 1001.3 / 962.6 | 0.0 / 0.0 | 1267.1 / 1385.5 | 194.712 / 197.615 | 0.961 | 1.093 |
| 2 | `oracle-dependencies.test.ts` | 350.9 / 344.6 | 1032.4 / 1122.4 | 0.0 / 0.0 | 946.6 / 992.2 | 216.767 / 225.069 | 1.087 | 1.048 |
| 2 | `typescript-record-cli.test.ts` | 450.5 / 473.5 | 1251.6 / 1240.1 | 0.0 / 0.0 | 1385.7 / 1420.5 | 188.000 / 167.873 | 0.991 | 1.025 |
| 3 | `owed.mjs` | 1680.9 / 1007.8 | 2140.0 / 2157.1 | 1041.5 / 1080.8 | 3171.2 / 3224.0 | 151.523 / 116.997 | 1.008 | 1.017 |
| 3 | `owed.test.mjs` | 1494.3 / 1303.3 | 2289.3 / 2421.8 | 1201.2 / 1085.6 | 2816.9 / 2499.8 | 462.023 / 416.887 | 1.058 | 0.887 |
| 3 | `selection.test.ts` | 1636.6 / 984.6 | 2121.5 / 2177.1 | 1061.6 / 1122.3 | 2175.8 / 2105.2 | 138.496 / 138.113 | 1.026 | 0.968 |
| 3 | `accepted-revision-data.test.ts` | 1605.5 / 999.4 | 2052.3 / 2110.0 | 1060.8 / 1069.4 | 1976.3 / 2010.2 | 163.214 / 171.211 | 1.028 | 1.017 |
| 3 | `precise-changes.test.ts` | 1543.6 / 1041.4 | 2167.4 / 2077.7 | 1074.4 / 1093.3 | 2061.6 / 2006.6 | 178.995 / 167.358 | 0.959 | 0.973 |
| 3 | `workspace-project.test.ts` | 99.5 / 86.0 | 2163.2 / 2185.9 | 1062.1 / 1068.5 | 2043.8 / 2184.1 | 131.195 / 157.625 | 1.011 | 1.069 |
| 3 | `record-pending-selector.test.ts` | 380.5 / 342.6 | 1012.6 / 1015.8 | 0.0 / 0.0 | 1404.4 / 1919.5 | 270.236 / 311.002 | 1.003 | 1.367 |
| 3 | `owed-range.test.ts` | 349.6 / 329.4 | 1025.1 / 1020.7 | 0.0 / 0.0 | 1306.9 / 1621.9 | 227.960 / 253.750 | 0.996 | 1.241 |
| 3 | `oracle-dependencies.test.ts` | 357.5 / 337.9 | 1186.6 / 947.9 | 0.0 / 0.0 | 1067.8 / 917.1 | 294.881 / 282.612 | 0.799 | 0.859 |
| 3 | `typescript-record-cli.test.ts` | 533.2 / 438.1 | 1019.7 / 1234.9 | 0.0 / 0.0 | 1380.7 / 1569.5 | 211.710 / 222.270 | 1.211 | 1.137 |

These loaded comparisons do not establish idle-machine throughput. The retained-object controls and matched component comparisons isolate the holder change; the whole-collector rows disclose admission and machine contention.

## Final retained-heap profiles

These captures use committed `2b608baa2ba05da8d176edadb7fede81c5833253`, including the inference-cache clear and the native-retirement revert. They use the same finite normal caps and capture rule as the base; snapshot writing is diagnostic and is excluded from normal RSS and timing rows. The workspace row again uses its actual selector child capture. Ratios compare each entry's strongly rooted graph and joint snapshot-payload cut, not independent constructor totals.

| Entry | Snapshot-shaped objects | Strong graph MiB | Joint observation payload MiB | Joint snapshot payload MiB | Strong graph A/B | Snapshot payload A/B |
|---|---:|---:|---:|---:|---:|---:|
| `owed.mjs` | 3 | 527.08 | 0.00 | 0.00 | 0.525 | 0.000 |
| `owed.test.mjs` | 0 | 240.38 | 0.00 | 0.00 | 0.558 | 0.000 |
| `selection.test.ts` | 4 | 516.70 | 0.00 | 0.01 | 0.559 | 0.000 |
| `accepted-revision-data.test.ts` | 3 | 516.28 | 0.00 | 0.00 | 0.558 | 0.000 |
| `precise-changes.test.ts` | 3 | 515.65 | 0.00 | 0.00 | 0.558 | 0.000 |
| `workspace-project.test.ts` | 4 | 507.96 | 0.00 | 0.01 | 0.554 | 0.000 |
| `record-pending-selector.test.ts` | 1 | 23.89 | 0.00 | 0.00 | 0.967 | 1.000 |
| `owed-range.test.ts` | 1 | 25.75 | 0.00 | 0.00 | 0.999 | 1.000 |
| `oracle-dependencies.test.ts` | 1 | 30.94 | 0.00 | 0.00 | 1.000 | 1.000 |
| `typescript-record-cli.test.ts` | 1 | 23.40 | 0.00 | 0.00 | 1.000 | 1.000 |

## Ranked remaining strong holders

The final accepted-revision capture is representative of the shared selector graph. Its strong-root graph is 541,357,581 bytes, versus 969,969,212 bytes on the base. The shape detector counts objects with `observations` and `moduleFiles`, including empty sentinels; this is distinct from the marked complete-target lifetime assertion. Only three small snapshot-shaped objects remain: their joint observation cut is 64 bytes and joint full-snapshot cut is 5,000 bytes, versus 569.1 MB of snapshot payload on the base. The 143,126,880-byte `inferred` holder from the intermediate capture is absent.

| Rank | Retaining path | Retained MiB | Lifetime/need |
|---|---|---:|---|
| 1 | Rust builder `Context.targets -> Array` | 127.67 | The compact target roles and identities are the result under construction. All roles/provenance are compared directly with the eager API; they remain required return data. |
| 2 | Active graph `Context.discoveries -> Map` | 60.26 | Per-call detached discovery answers are reused during capture. The Map remains reachable at the validation boundary, is not read by `validate`, and is cleared by `finally`; its existing fact-cache semantics are unchanged. |
| 3 | Second active graph `Context.discoveries -> Map` | 37.24 | The other nested graph has the same bounded call-scoped reuse cache and `finally` cleanup. |
| 4 | `Context.sourceTexts -> Map` | 35.45 | Captured source text supports repeated reads and parsing within the graph lifetime; the separate source-input hashes fence current bytes before return. |
| 5 | SDK `nativeFiles -> Map` | 27.23 | Live SDK client/native-file data for the active transaction. |
| 6 | SDK `toolchain.nativeFiles -> Map` | 27.10 | A second active SDK client/native-file cache. |
| 7 | SDK `toolchain.nativeFiles -> Map` | 27.10 | A third active SDK client/native-file cache. |

Retained sizes can overlap and are not added. Each SDK native-file Map includes a 24,523,112-byte Buffer; those buffers are nested evidence, not extra rows to sum. Native parser/Program process memory is measured separately by the RSS streams and native lifetime trace. The per-entry JSON summary retains ranked holders for every named entry; the four installer/CLI terminal heaps are distinct from their earlier child-process peaks.

- `/home/akisarou/.cache/nts-scratch/857/profile-after-final/accepted-revision-data.test.ts.heapsnapshot.groups.log`; SHA-256 `7256a40bfd8a4baece71081d01cc640d062eb0f56eb2c470e81cdd1c1c0a63d8`.

## Why the remaining peaks remain

The whole-file rows do not promise a 50% RSS reduction. The six selector-bearing entries still execute the native SDK and retain the detached answers their selector must return and validate. Their peak can occur during Program/configuration capture, before the batch boundary or the inference clear; reducing later snapshot retention cannot remove an earlier peak. The native lifetime trace above identifies the approximately 770 MB idle parser residency; [#1003](https://github.com/AkisArou/nts/issues/1003) owns the Program-AST/reuse follow-up. The native-at-lease-peak column includes all live SDK children, including Programs, and is not a measurement of only the idle parser.

The other four entries have small terminal strong heaps (23–31 MiB on the base) and peak during real installer or fixture-route work. An actual install is part of their tested behavior. Its whole production workspace package breadth is incidental: the shared `oracleWorkspaceFixture` reproduces the production `installationInputs` and `installationStatusInputs`, including the benchmark importer and AssemblyScript. [#1007](https://github.com/AkisArou/nts/issues/1007) owns deriving a smaller staged package graph from production declarations. No fixture is narrowed here, and no second package list is introduced.

| Entry | Remaining holder and why its work is required | Follow-up |
|---|---|---|
| `owed.mjs` | Native parser/Program and detached selector answers. The full self-test must exercise every rule and the committed-source Rust selector; the facts and final memoized graph remain authoritative. | [#1003](https://github.com/AkisArou/nts/issues/1003) |
| `owed.test.mjs` | Native parser/Program plus the real selector graphs exercised across its original 124 runtime cases. The lifetime assertion proves the inference cache is empty before Rust projection; later calls retain the same final graph without inference recomputation. | [#1003](https://github.com/AkisArou/nts/issues/1003) |
| `selection.test.ts` | Its production selector child still needs SDK Programs, compact Rust roles, source union and replay answers to classify landing obligations. | [#1003](https://github.com/AkisArou/nts/issues/1003) |
| `accepted-revision-data.test.ts` | Its accepted-source selector must retain detached authority and facts for the full committed inventory, and still uses the native parser/Program owner. | [#1003](https://github.com/AkisArou/nts/issues/1003) |
| `precise-changes.test.ts` | The real change selector still uses native parser/Program state and detached observations needed to distinguish precise input changes. | [#1003](https://github.com/AkisArou/nts/issues/1003) |
| `workspace-project.test.ts` | The small parent test process delegates to the real selector child. That child needs Programs and facts to detect workspace/configuration changes; its native memory is included in the file lease. | [#1003](https://github.com/AkisArou/nts/issues/1003) |
| `record-pending-selector.test.ts` | The test invokes the real selector writer and verifies pending/current transitions and record-delta application. `smallSelectorRepository` and each committed-source acquisition use the ordinary linker to publish the authentic installation catalog. The peak contains pnpm, the test worker, dependency-input and selector-writer processes. A real install is required; the complete production package breadth is not claimed necessary. | [#1007](https://github.com/AkisArou/nts/issues/1007) |
| `owed-range.test.ts` | Its real-selector controls assert trusted answers and “installation catalog current” for independently prepared committed endpoints, as well as dirty-policy isolation and cleanup. The production linker performs the needed installs; pnpm and the test worker dominate the sampled peak. Excess package breadth is separate. | [#1007](https://github.com/AkisArou/nts/issues/1007) |
| `oracle-dependencies.test.ts` | The owned-producer control tests a real cold install, a hit with zero pnpm selection, and preparation before a zero-memory consumer. The peak includes the reservation-fixture owners, pnpm and the actual producer. An install is the behavior under test; its separate `installFixture` already uses a minimal root and one workspace member. | [#1007](https://github.com/AkisArou/nts/issues/1007) |
| `typescript-record-cli.test.ts` | The unsealed-resume control deliberately removes the dependency seal and requires the same prepared oracle identity. `conformance262` prepares that identity before reading resumed rows; copied-consumer recipe/adapter controls also use the real route. The peak includes the test worker, pnpm, census route and producer. The route and preparation are required; excess package breadth is separate. | [#1007](https://github.com/AkisArou/nts/issues/1007) |

The new `owed.test.mjs` lifetime assertion uses [`v8.queryObjects`](https://nodejs.org/api/v8.html#v8queryobjectsctor-options), which observes matching live objects after full collection. Its entry rows include that committed test control. Production selectors do not request collection; the other selector-bearing entries and matched component controls measure their ordinary execution. The counterfactual keeps the same observer and fails when only the inference clear is removed.

The per-entry install audit is retained at `/home/akisarou/.cache/nts-scratch/857/measurements/fixture-peak-audit.json`, SHA-256 `3f37f3ccdd9025552a4184d8c8ff12bd030ededbdb78468c60b7e12854da258a`. It binds the inspected source bytes and names the required behavior for each of the four entries. The peak-process receipts and complete command/RSS streams accompany the collector rows.

## Cleanup and proof receipts

After the collector sequence ended, the production unit/process ownership guards found no users of the private clone roots. Only the owned third-party link, clone, private Git/input owner, private dependency cache and exact global alias were removed. Main's shared dependency cache had zero clone-keyed catalog entries before and afterward. Logs, histories, recipes and the immutable compiler bundle remain in kept issue scratch.

- `/home/akisarou/.cache/nts-scratch/857/measurements/cleanup.json`; SHA-256 `08cfaf5003a4acad06fa7c60ebf17e5f76bbca8b0cd847128b334d3dd764b0f5`.
- `/home/akisarou/.cache/nts-scratch/857/measurements/collector-v2-sha256.txt`; SHA-256 `3c885b0ddde1faabe5cbf4e59447f8f526e204b71eb448355a39b056fb08f985`.

The collector manifest binds every arm's raw tooling log, complete file-wall report, before/after scheduling histories, RSS and host/ledger streams, native command provenance, runtime bundle summary, canonical environment, analysis and measurement scripts. Row names above map to directories of the same name with the `collector-v2-` prefix under `/home/akisarou/.cache/nts-scratch/857/measurements/`.

Focused controls on the measured final source pass: module-batch 16/16, Rust-runtime linkage 2/2, and the previously flaky full-check measurement file 28/28, all without skips. Original literal test names and multiplicities are preserved; four approved batch controls are added, while the tooling inventory stays at 360 files. The full collector's owed file retains all 124 runtime cases.

- `/home/akisarou/.cache/nts-scratch/857/controls-sha256.txt`; SHA-256 `e6a186089ad72649e76f61eab614db0dcb35b2c129c75f3857baa44a9b7199f7`.

The controls manifest includes committed-source fixed/eager raw outputs and hooks for the projecting batch, inference cache and reverted native experiment, plus the final focused outputs and their normal-cap runner. The batch-owner bytes are unchanged between `cf5fce7d949b` and the measured final source; the inference-owner bytes are unchanged between `5d239f010afb` and that source.

The six selector-bearing final captures retain at most 12,832 bytes of full-snapshot payload, including empty sentinels; the four terminal captures retain 1,264 bytes each. Values displayed as 0.00 MiB are rounded, not necessarily zero. Every archive verifies that its decompressed SHA-256 equals the original dump SHA-256 before the uncompressed dump is removed.

- `/home/akisarou/.cache/nts-scratch/857/final-profile-sha256.txt`; SHA-256 `8cd373172ad22299b88338cfb2771bd4a66f38783c44e628a608609dc012eae5`.
- `/home/akisarou/.cache/nts-scratch/857/final-retainers.json`; SHA-256 `badae5a1968929095817a4be354332804294ae2d18cc6c3133773f4b92ccb5fe`.
