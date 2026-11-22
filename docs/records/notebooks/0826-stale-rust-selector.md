# Stale Rust selector projection (#826)

The implementation is `3e3c2fed41ffe0aafd7492e704e33705236ce69b`, based on
`ce0df059af2e77d7fa9417827d2d3a8b251d92c1`. All observations below use the
same `owed --commit ce0df059af` question and the original stale selector record.
Fresh-record controls write and commit a canonical record only in their private
prepared sources. No generated selector record is committed by this task.

## Where the time went

An unmodified, admitted CLI selection took 332.60 s wall, 389.52 s user CPU
and 57.22 s system CPU. Its Node sampling profile attributes 172.17 s to two
live Rust projections: 95.02 s in the accepted-source self-test and 77.14 s
in the working-tree selection. The self-test's prepared-source trust and the
requested selection's trust constructed separate graphs.

Within those projections, `projectInputOwner.read` accounts for 67.68 s,
including 46.87 s in native Program creation. Reader identity capture accounts
for 62.16 s, including 48.26 s in `OracleFilesystem.inputIdentity`. Inclusive
times overlap. A Program request was already resolved once per batch, but its
physical reader identities and emitter nearest-config lookups were captured
again for each Cargo consumer.

Within the sampled `main`, 140.41 s outside live Rust projection is the ordinary step graph,
source preparation and other selection work. Startup and GC account for additional
profile time outside that `main` stack. The coordinator split that floor
into #967; this task does not claim the entire selection takes only a few seconds.

## Representation and controls

Fresh Program transactions now produce context-free reader and pin facts once.
Compiled-program requests also produce emitter nearest-config facts; other roles
retain their declared-config semantics. Each snapshot composes those detached
facts with its own reader, namespace and target provenance. Equal facts union
their causes and ordinary authority promotes acquisition-only facts; conflicting
answers refuse. Scope-end validation still checks every distinct answer,
project match, source ownership and tracked population. No Program or projection
answer persists across scopes. Every stale key still performs live projection.

The CLI's self-test and selection share one committed Rust-source lifetime and
trust context. JS retains working-tree bytes. Rust retains committed bytes.
Rendering and execution happen after the source fence and temporary cleanup.

The operation-count control compares one reader with twelve consumers of the
same complete Program request. Both construct one native Program and perform
the same positive number of physical identity captures. Returned snapshots
remain independently mutable. A later scope constructs a fresh Program and
observes a formerly missing source. Existing controls exercise source, package,
membership and negative-lookup mutation fences, distinct compiler roles and
complete cause unions. A new composed-selection control edits a shared JS/Rust
reader and makes the working Rust module structurally invalid: JS still sees
the working input, while Rust selects the committed input and never enters that
working module. Stale-live target roles also equal a newly accepted fresh record.

## Timed selections and counts

Both real CLI timings ask `owed --commit ce0df059af`, with Node CPU profiling,
through `admit.ts --key landing-selection`. The after command also loads the
transparent operation counter. The prepared-endpoint pair fixes one committed
source, self-tests its rules, and replays all changes under that one trust
context; its fresh arm writes a canonical selector record privately and requires
an authenticated current-key decision. It never changes a task-tree record.

| Observation | Before | After |
| --- | ---: | ---: |
| Real profiled CLI wall (s) | 332.60 | 117.35 |
| Real CLI user + system CPU (s) | 446.74 | 177.80 |
| Sampled live Rust projection (s) | 172.17 (two graphs) | 49.27 (one graph) |
| Live `inputIdentity` sampled time (s) | 48.26 | 2.33 |
| Prepared endpoint, stale wall (s) | 134.19 | 116.04 |
| Prepared endpoint, fresh wall (s) | 78.93 | 61.36 |
| Stale minus fresh endpoint wall (s) | 55.26 | 54.68 |

These are observations under concurrent machine work, not a wall-time threshold
in a test. Admission waits are excluded. The extended before replay took
170.26 s in a later sitting; it supplies the complete eighteen-row identity
control, not a replacement for the original before timing. The observed fresh
endpoint floor fell from 78.93 s to 61.36 s; #967 owns the remaining ordinary
selection cost.

| Per prepared endpoint | Before stale | Before fresh | After stale | After fresh |
| --- | ---: | ---: | ---: | ---: |
| Physical identity captures | 905,863 | 161,648 | 97,194 | 20,782 |
| Native Program constructions | 671 | 206 | 671 | 206 |
| Physical identity captures in live Rust | 744,215 | 0 | 76,412 | 0 |
| Native Program constructions in live Rust | 465 | 0 | 465 | 0 |

The real CLI performed 1,811,726 identity captures and 1,342 Program
constructions before, versus 97,194 and 671 after. Each live projection still
constructs 465 native Programs: none of the compiler's work is cached. Ordinary
JS identity capture falls from 161,648 to 20,782 calls per endpoint, a reduction
of 140,866 calls inherited by #967.

## Eighteen distinct changes

The first fifteen rows are the last fifteen landed commits at the frozen base.
The final three are additional Rust-only, tooling-only and docs-only commits.
The component replay uses `changedPaths --commit`, `owed`, `gateSteps`,
`interopOwed` and doctest subjects under one explicit committed-source lifetime.
Every step set, interop selection and doctest subject list is exactly equal
between the before implementation, stale after implementation and fresh after
record. Step counts below include the ordinary policy checks.

| Commit | Kind | Steps | Before = stale after = fresh after |
| --- | --- | ---: | --- |
| `ce0df059af2e` | landed | 50 | yes |
| `a62745f1736c` | landed | 10 | yes |
| `8fdcf6583aaa` | landed | 50 | yes |
| `0089f5130fbb` | landed | 50 | yes |
| `3dcc28a2e056` | landed | 13 | yes |
| `8433d668622a` | landed | 17 | yes |
| `3d5c99fa1905` | landed | 53 | yes |
| `db0d83592f94` | landed | 45 | yes |
| `0dcaef564cef` | landed | 39 | yes |
| `4d36984f4431` | landed | 37 | yes |
| `2d933c741d60` | landed | 18 | yes |
| `45b19aba92e6` | landed | 13 | yes |
| `2f1b7f7fb74e` | landed | 18 | yes |
| `f540193c4baf` | landed | 29 | yes |
| `509af3ea5145` | landed | 32 | yes |
| `d9ef8caa3244` | rust | 29 | yes |
| `f5018b35edfc` | tooling | 10 | yes |
| `6fd9bf1feae8` | docs | 13 | yes |

The docs, Rust and ordinary rows were also run through real CLI processes with
fresh process state. All three exited zero and their owed sets equal the valid
in-process rows. The comparison normalizes the API's `interop: "all"` and the
CLI's omitted interop limit to the same meaning. Original outputs are retained.

The first standalone after replay had an outdated pool-tree installation catalog
and correctly took `catalog-stale-live`, conservatively owing all Rust targets.
Those component rows are excluded. The paired sources prepare their verified
catalogs, and the task-tree installation was refreshed before the final checks.
The initially successful docs CLI was revalidated from its retained zero-exit
output against the correct paired row; no raw result was rewritten. An earlier
unfinished after run was stopped and supplies no timing evidence.

## Mechanism and verification controls

The physical-recapture mutant in a private committed source changed graph
composition back to consumer-side capture. The count guard failed with
224 captures versus 37 for the single-reader reference; the enabled guard passed.
The quadratic-union mutant changed set membership back to an array scan. Its
guard failed with 24,512 comparisons for 128 input causes; the enabled guard
passed. Both staged files were restored from their saved copies before cleanup.

All 55 focused projection, trust, mutation and view tests passed. The additional
pure cause-union test passed. Strict tooling types passed for six projects and
1,210 modules before the final pure guard was added; the final gate checks the
complete final inventory.

## Retained raw evidence

All paths are under `/home/akisarou/.cache/nts-scratch/826/`. Named systemd units
run off CPUs 4–5, at agent rank, through `admit.ts`. Timers start after memory
admission. Memory admission waits are outside the reported selection wall.

| Artifact | SHA-256 |
| --- | --- |
| `profile-before/owed.cpuprofile` | `5190243ab146a0af1dd7098a01392ce4c18796814697e45358a2f0207266a2a2` |
| `replay-before/rows.json` | `284b396247c854897c66a60d7987d02ff2a73d177c25b3c5f1991fb6f336b9ed` |
| `pairs-before/rows.json` | `df044f8a8d3910a28a6d5a4d2206487c7397164498eee0cfc0072964b45d8002` |
| `profile-summary.json` | `e3470a32299058b99370f18ab6a4778022d44fc6246dd276cba55f556cfbc103` |
| `selection-proof/pairs-after/rows.json` | `ceeae1bff990d6b69ee3ef9056c95ae090f31ee1cf9617f3439319ca9a65c6a5` |
| `selection-proof/before-extended/rows.json` | `82be844973e19fdf7703b2db2d77a13f900c9086a94a323aee98456ac59604dc` |
| `finish-selections/crosscheck/owed.cpuprofile` | `d1a0a51727188d1a0c2765f561b4a2441afcf8245cc6bf83d57a50013b90d38c` |
| `cli-validated/rows.json` | `39002b9cdd1d2829dcc7ade265e4929327ca04eee716d38d8d3dc4a274475048` |
| `control-proof/result.json` | `85d5aeae24b3c3722b4160f2846e2f5f587c10fe1c5978720ad0f244f9b45145` |
| `control-proof/recapture.stdout` | `19f8d5ad7e0bf64a9fb78e0450b252e75a8ec760dcb2d6afcefd6a47eb5bcd71` |
| `control-proof/cause-scan.stdout` | `817eb7f1c95aed58cf49887fa7f9e392c589762ecdef29e825daf2e7107ca6fb` |
| `focused4/stdout.log` | `f51d444f29e24484879f46adb85f27c1819ff390bdae09b90586a35467dcc4c4` |
