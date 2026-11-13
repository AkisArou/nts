# Lowering split: the test module — #681

The conditional inline `tests` module moved from `compiler/core/src/hir/lower.rs`
to `lower/tests.rs`, preserving `hir::lower::tests`. The source proof reconstructs
the exact old block, checks its dedented bytes, and verifies that everything
outside it is unchanged. All sixteen test attributes and existing allowances
remain. Cargo fmt joined four unchanged statements after dedenting; there are
no path-sensitive macros or visibility changes.

The source pins are base `7cdb7b565f38cd2594d543c0c93782b0f1b63b1f`, pure
move `fb2c3390d5707f01804f84ccaf788e8ac82c31de`, and formatted proof tip
`4ed677760685a98b374ddc7877ade7d4ddbcd9b9`. A separate retention commit keeps
the evidence through coordinator review.

| Proof | Result |
| --- | --- |
| Compiled core-library test identity | 628 rows in each arm; all 16 moved tests occur once; zero differences |
| Independent release pins | Byte-equal compiler binaries, `f2bc72acf36cfd8ffcb167e97c678993aef527e15ad94bd7ac7af9b5d6c8278b` |
| Full prepared HIR population | 1,068 program projects and 165 benchmark projects |
| C, LLVM, JVM, C with RC | 1,233 pairs per preparation; 4,932 identical pairs, zero differing or unproved |
| Successful HIR listings | 4,924 pairs; the eight matching nonzero outcomes are separate below |
| Original baseline repeats | 200 matching controls |
| Actual prepared inner | fmt, Clippy, build and tests pass on the formatted proof tip |
| Canonical pinned gate | build, compile-time and compile-time-rc pass; canonical environment, cleanup complete |
| Focused layout/timing/owed/selection/report consumers | 135 pass, zero failures; host ownership and strict tooling pass |

The compiled identity capture used the existing test-profile artifact API at
`ebbef6787a69dd46fef5ee226889b1a4c0701d03`, physically staged by
`copyModuleClosure`. All eighteen snapshot files were authenticated against
that Git authority before import. Each arm used its own Cargo target. The
initial relocated snapshot refused before Cargo; the corrected route supplied
the real public disk-capacity descriptor. The temporary baseline pool tree was
returned after the comparison; the tiny authenticated owner fixture remains
with the retained evidence, without a Git directory or build target.

The HIR driver uses the production project selector, token/case identity,
compile activity/CPU owner, aggregate and worker boundaries, and command drain.
It compares raw stdout/stderr hashes, lengths, statuses and signals. It yields
only between completed pairs and publishes its terminal report after cleanup.
No stream normalization or elapsed-time verdict is used. The complete pair
and config indices remain off tree, authenticated by the companion record.

`tests/programs/invalid` and `benchmarks/cases/jetstream-lebab-wtb` return status
1 under all four preparations in both arms, with `the program does not typecheck`.
Their matching bytes establish unchanged failure behavior, not prepared HIR.
The original agreeing raw captures were deleted after hashing. A separately
labelled eight-pair replay retains these streams: all 32 before/after streams
match the original hashes and statuses, with no normalization, and four new
baseline repeats agree. Its generated benchmark config has identical bytes at
a separate path. This replay supplements rather than replaces the full cohort.

| C test262 record | Pass count | Negatives accepted | Verdict |
| --- | ---: | ---: | --- |
| language | 7,014 | 1,315 | reconciled |
| built-ins | 888 | 185 | reconciled |
| annexB | 9 | 1 | reconciled |
| staging | 54 | 3 | reconciled |
| harness | 17 | 0 | reconciled |

Every record has zero REGRESSED, CHANGED, MISSING, FIXED, NEW PASS, NEW FAIL or
UNSTABLE rows. These ran against the authenticated tip release pin through the
stable whole-job `test262-records` owner, with all.sh's eight-worker case policy.

The first supported `--here` run at
`f55e8a396084383361d3780cd5ece95ba1a83d9e` was red only on rustfmt. Every other
requested step passed. Its chained inner command never started. The formatter
follow-up is validated by exact source checks and the actual green prepared
inner on the final source; the earlier supported run is never called green.
The first source-name assertion also omitted two tests with intervening
attributes and refused; the corrected source proof and independent compiled
inventory include all sixteen.

The first pinned attempt wrapped the whole build-and-gate chain in admission
and was stopped before gate entry. #774 fixes that separate tooling boundary.
The accepted canonical run uses launcher
`4c635792ae764ff4f6fd58f416b92c36a4aea7d2` and the proof-tip candidate, with no
outer reservation. Its workspace release build has its own recorded identity
`d8975021da9ad7d8e0af3ab95bc98c0847281ef2e06318fae452fc05fc4a5cd5`;
byte equality is claimed only between the two independent pin.ts builds.
Both preparation tripwires count all 34 modules within their existing budgets.
No speedup is claimed, and per-unit CPU is not substituted for separately
owned scope CPU.

The [companion JSON](lowering-test-module-681.json) retains precise pins,
per-preparation results, matching failure details, all five record verdicts,
proof exclusions, the immutable artifact-owner manifest and artifact digests.
