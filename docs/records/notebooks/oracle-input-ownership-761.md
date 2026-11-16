# Oracle preparation and input ownership (#761 correctness slice)

This slice makes preparation, selection, runtime claims and fixture reproduction
use the owners that perform each read. It retains the unconditional `ALWAYS`
rule. A full native coverage decision and retirement of that rule remain
separate work under #761; neither is certified by these integration results.

## Contracts in this slice

Rust and TypeScript oracle consumers require a sealed dependency image. They
do not run an installer on a missing image. The acquisition, cold/hit, [1,2,2]
and reservation controls belong to the tooling producer fixture, whose Git
fence reads its own staged tree. Provider selection consumes the parent's
image. Standalone commands prepare through one entry owner, including the
full check's real post-landing recordPending route. Internal workers remain
consume-only. The entry and shell audits enforce those boundaries.

The image contains third-party packages and installation metadata and named
bin targets. Workspace implementation code remains live consumer input, with
its package.json included for Node resolution. Changing a workspace
implementation does not re-prepare an image; changing a named bin target does.
The ordinary preparation path validates an available parent image and, for
identical inputs, issues a version-2 seal bound to this source and revision.
It leaves the parent's immutable image and helper lifetime intact. Changed
manifest, bin or producer inputs fall back to cold preparation; malformed or
forged evidence refuses. No cross-run image store is introduced.

One module graph now keeps separate selection files, runtime claim files,
producer placing files, reproductive staging files and immutable fixture
ownership. Source-candidate race-guard observations remain fully validated and
claimed, while only actual producer and target recipe members select their
consumers. Installation-status observations remain selection inputs. Every
reproductive visit promotes before deduplication, independent of visit order.
Type-only clause imports and exports are erased runtime edges; named-type
imports retain Node's side effects. Host, type, metadata and execution owners
have no compatibility re-exports.

Project descriptors require an explicit type-check or compiled-program role.
The Program supplies the compiler's actual files and observations. Type-check
requests acquire no runtime URL/data obligation; executing compiled programs
retain those obligations. The 426 pre-existing native project declarations
remain explicitly compiled-program. The native declaration table also names
the publication targets and #702's two new reader paths.

Fixtures stage through copyModuleClosure before private mutations. Inspection
observations do not accidentally become reproduced immutable files. The host
audit rejects manual copying of closure.files, and moved-name checks include
generated and shell-embedded Node programs. Affinity and check-report command
entries are separated from their imported libraries. The benchmark link owner
uses a fresh owned cwd through the existing Recorder and ScratchDir lifetimes.

## Findings settled before landing

The resolver starter owns a helper and its completion from spawn, so failed
readiness, an invalid session and watch-construction failures cannot leave a
helper reading removed output. Both gate and standalone preparation previously
launched that helper with ambient process.env while claiming planned options,
an existing main defect. It now receives the planned environment explicitly
and publishes its actual Node arguments and received NODE_OPTIONS. Conditional
exports controls distinguish canonical default, explicitly planned poison and
a named actual/intended mismatch with helper drain.

The branch's new post-grant token marker introduced a binding-failure unwind
gap, caught by review before landing. Packet validation now precedes acquisition;
a later binding failure releases and joins its actual lease before rethrowing.
Real request/grant/release events and zero held, active and waiting capacity
prove the after-grant control. A malformed initial packet emits no request.
Before-first-grant and after-grant child controls pin marker timing.

Canonical re-entry validates each command's documented environment options and
carries them as explicit owned values. An undeclared changed option refuses
before admission, including same-source reuse. The actual wrong-JVM mutation
requires disagreement output, preventing a generic preparation refusal from
satisfying it. Source owners bind their resource handoffs with assignOwnedValues.
The recorder fixture now passes its complete ownMemory capability through the
real candidate route and asserts pool:null in the sealed child; it previously
lost that capability and consulted live disk during cold preparation.

Identity-verifying checkpoint resume and report modes prepare before comparing
the oracle identity. This supersedes the earlier metadata-only resume decision;
the old starved/no-admission expectation was removed for that deliberate
behaviour change. Pure usage/errors/listing that compare no identity remain
unprepared. A sealed checkpoint resumed from an unsealed entry retains the
writer's identity, and a committed recipe edit refuses. An invalid TMPDIR now
refuses at the entry before recorder dispatch: nonzero status, exact refusal,
empty stdout and no record are asserted.

The TypeScript suite's string-array source hashes were undeclared byte inputs.
Their identity owner now hashes exactly its fileInput URL list. The earlier
whole-tooling fixture links had hidden the missing declarations. On main an edit to tooling/census/typescript-oracles.ts or its hashed siblings
may not owe the steps whose identity consumes them. No step-specific main
selector result is claimed here; the declared byte list now makes that
dependency explicit. Splitting the TypeScript
oracle changes its raw checkpoint identity, with zero committed record keys
and all 36,567 backend rows in three cases.tsv files unchanged. Checkpoints
refuse the changed identity by name.

## Deciding evidence

| Proof | Source | Actual result |
| --- | --- | --- |
| Final reviewed owner controls | 38df22d3d8df | 82/82; strict, host and timing green; no skips/cancellations |
| Fresh inner | 38df22d3d8df | fmt 3 s, Clippy 5 s, build 15 s, tests 505 s; green/drained |
| Final selector writer | 38df22d3d8df | 110.952 s; pending true to false; only rust-runtime.json rewritten |
| Ordinary full tooling | 68a1fe1b870c | 314 files; 2,695 pass, zero fail, two existing Unicode TODOs; no skips/cancellations |
| Supported --here | 68a1fe1b870c | 19 summary PASS plus build; canonical, dirty 0, no experiments; complete cleanup and diagnostics |

The native proof and supported source differ only in the generated
results/gate-inputs/rust-runtime.json. The final writer keeps 57 targets and
adds four path-table entries for #702's new readers/lookup alternatives;
dependencies remain 31,657, optional inputs 1,218, byte inputs 1,381 and lists
4,087. It refreshes source/engine and target-role hashes through the writer.
Earlier refreshes include the settled declarations, required project roles
and the publication crate's increase from 55 to 57 targets; these are retained
as separate source-bound writer receipts.

The real corpus census found 1,724 tasks, zero bare imports resolving workspace
packages and zero mapping errors. This is not an empty parity claim: the
19-to-23 live-code fixture, unread-code selection control and bin-reprepare
control prove the projection. A real library case separately retained status,
stdout, all five input bytes and its live package.json before and after.

At its retained source, the copier comparison covered 678 invocations and 643
plans: 307 lost inspection-only files, none gained a file, no reproductive
file was lost and no replayed directory listing changed. Eleven unexercised
sites were oracle-reservation-fixture.ts:93; module-closure-fixture.test.ts:153,
279, 457, 461, 505 and 528; population-inputs.test.ts:140;
project-inputs.test.ts:227; reader-census-graph.ts:31–32; and
reader-observations.test.ts:127. This is a measurement at that source,
not a claim that every later fixture branch was exercised by the instrumented
census. Final ordinary tooling provides the later integration evidence.

The 13 previously failing copied fixtures supplied 60 ordinary preparer ledger
rows: every acquisition was hit/rebound with zero pnpm selection commands.
The final full-run hit wall cost was 373.139–963.960 ms, median 565.498 ms;
the independent
validation-route measurement was about 240 ms wall and 200 ms CPU. Earlier
failing-test durations and later completed-test durations are retained as
context, not an isolated speed comparison. The producer fixture's complete
cold/hit/resource proof cost 24.9143 s wall and 24.356322 CPU s in the final
full run; the earlier focused measurement was 11.7361 s wall and 12.551367 CPU s.
Those complete-control durations include the fixture's actual production work
and are recorded under different concurrent load, not as a phase subtraction.

The source-state population implementation fell from 1.50 to 0.075 s per
describe with identical facts after replacing repeated prefix scans with one
tracked-ancestor index. In the measured last-day landing window, 17 landings
included one importer-directory edit; image narrowing is a correctness boundary,
not a large measured re-preparation saving from that window.

The benchmark cwd control replays the retained real fib linker argv against
the same absolute objects and output path. Only cwd changes. Both complete
26,432-byte ELFs have SHA-256
b44c0210b63a57ce61ba9fc9b6d18a79c0eb3b1c43c4f6be214e3d02bd21fd15,
with no stripping. The owned fresh-root receipt and both binaries are retained
beside link-cwd-focused-v3/link-byte-parity.json. Later integration uses the
Recorder::link_output owner, preserving the build-usage receipt and cleanup.

The observer sabotage control lost its argv index when image-reader mode was
added. It failed with 0 != 2 rather than passing vacuously; command_index fixes
that private mutation. The failing and passing logs remain distinct evidence.

## Selection projection and limitations

All six decisions use one frozen standing-cost snapshot. “Full” is build,
clippy, jvm-members, tests, tooling, gate-inputs, old-paths, rustfmt, test-host
and tooling-types. “Reduced” is build, jvm-members, tooling and tooling-types.
No step is deferred in these answers.

| Edit | Selection | Steps | Estimated wall s | Estimated CPU s |
| --- | --- | --- | ---: | ---: |
| tooling/records/record-pending.ts | Main d5fb8f00, ALWAYS | Full | 270.015 | 6,447.514 |
| tooling/records/record-pending.ts | Branch 68a1fe1b, ALWAYS | Full | 270.015 | 6,447.514 |
| tooling/records/record-pending.ts | Branch, private ALWAYS-off what-if | Reduced | 233.665 | 2,315.792 |
| tooling/tasks/new.ts | Main d5fb8f00, ALWAYS | Full | 270.015 | 6,447.514 |
| tooling/tasks/new.ts | Branch 68a1fe1b, ALWAYS | Full | 270.015 | 6,447.514 |
| tooling/tasks/new.ts | Branch, private ALWAYS-off what-if | Reduced | 233.665 | 2,315.792 |

For either edit the what-if saves an estimated 36.350 wall s and 4,131.721
CPU s (64.1%). The tests step accounts for 4,110.142 CPU s; tooling becomes
the longest step, so the wall estimate moves much less than CPU consumption.
These are sums of the selected steps' frozen standing CPU costs and the
selector's wall estimate, not an observed runtime or contention experiment.
The CPU keys for both tooling edits are build:other, clippy:other and tests:other.
Both branch endpoints authenticate accepted record bytes, current input key
and installation catalog. The private what-if changes only ALWAYS and its
local order self-test in an owned repository, with no production policy edit.

The six-answer receipt is
/home/akisarou/.cache/nts-scratch/761/landing-correctness-projection-v2/results.json,
SHA-256 108ffa0d7bec4b891144cc61461394d84684b7981ca88b47ccad22d2135a0d66.
The standing costs were frozen at 2026-11-15T22:39:11.779Z in that directory's
costs.json, SHA-256
fadd6e584eceb1afb4daff54c9105379274cb734c04860438d4f033ac5399d0a;
decision-costs.json retains each CPU summand.

Main has no accepted native input record before this slice. The candidate
cannot trust its own first record to narrow its landing, so the first transition
runs conservatively with catalog-stale-live and accepted blob none. Record-based
selection narrowing starts on the landing after this one, once main owns that
record and its catalog protocol. Supported reported about 683 s including
build/setup (the runner summary is 676.413 s; the whole CLI including selection
was 714.874 s). Tooling took 321.360 s against its unchanged 900 s bound,
records 235.397 s and gate-inputs 208.249 s. The 600 s figure is the selector
estimate budget, not a wall timeout. The coordinator accepted this one-time bootstrap
overrun for a normal queue submission; no bound, capacity or policy changed.
A service step that reaches its own bound still holds the change. The writer and later-source projection have
separate current/trusted checks. No unconditional policy is removed. Projected
step seconds are estimates from
one identified cost snapshot, separate from selector wall/CPU and observed
landing time. Native runtime capture/provenance implementation and its focused
controls are included, but historical partial traces are not final coverage
evidence for this source.

The gate's token.sh --step branch currently has fixture-only tracked callers;
it remains as a known edge and future unowned handoffs refuse by name. #797
owns cleanup of regenerable images in retained failed/interrupted runs, #798
owns compiler-filtered directory observation precision, and #799 owns the
provenance audit for environment writes. The conditional-export fixture uses the real command closer for its success
join: a raw top-level await on the unreferenced helper correctly failed with
exit 13. Production success joins already run within CommandLifetime.close;
failed-acquisition joins explicitly reference the child. Raw write bans or allowlists do not
prove handoff provenance; the runtime guard remains fail-closed. No existing
shared image or closed issue scratch was manually deleted for this slice.

The finite raw manifest is
/home/akisarou/.cache/nts-scratch/761/raw-correctness-evidence-v1.json,
SHA-256 2204fa730fffae03f2eaefc4987f16d53fd7da0a265ad8860bc7b572dd6080c3.
It binds 566 selected artifacts (17,490,075 bytes) and 906 exact Git source or
absence receipts at the base, native-proof and supported-proof pins. The
verifier checks artifact size/hash and each exact Git blob or absence.
The final Markdown-only tip gets separate readiness evidence before queueing;
this record does not call that later check complete in advance.

The corpus receipt is workspace-image-focused-v1/corpus-cases.jsonl under that
scratch root, SHA-256
fdd9324f4cee7c96270f4108e0fb7e319ffa8ab633c1b8c32fcf3c79c118d824.
The copier receipt is copier-inventory-v1/comparison-v2.json, SHA-256
88e14eac325deb401d7a243129960687d4247d1b051dc9dd4d65c700091e2484.
The final copied-fixture cost receipt is fixture-reuse-cost-v7.json, SHA-256
3a8720bf23ffe3e34ce04dcdec40ecd8c3e8088059918f517eedcff3cfd44884.
The manifest also binds selector-refresh-v8.json and its exact generated-record
delta, the independent real library parity, the identity-impact census,
retained failing/passing sabotage controls and the cited-revision/rebase
receipts. All paths in this paragraph are relative to the same scratch root.
Retained REDs and setup refusals are excluded from positive proof; each later
green is tied to its actual source, not retroactively assigned to a newer pin.

## Rebase after the main memory-adjustment fix

The initial queue, 9829f0554fff-73f63757, did not land. Its tooling command
finished while the gate parent repeatedly shrank and re-requested the same
pending demand, oscillating between 17 and 19 GiB and starving its event loop.
The queue was withdrawn. This was an existing main defect, fixed and landed
as #800 at eeeb9a252cad; its record is
[gate-memory-growth-800.md](gate-memory-growth-800.md). The bootstrap cost
above remains separate from that livelock, and no time bound was raised.

All 115 pre-rebase commits remain under refs/cited/761-pre-800. Rebase
4c911134de94 adds exactly #800's seven paths to the previously authenticated
9829f0554fff tree. The sole conflict joined two independent workflow Decisions.
All 367 literal Rust embed comparisons are byte-identical, and none of the
changed paths appears in 246 retained Cargo dependency files. The prior inner
and 2,695-test full tooling results remain evidence at their original pins;
no fresh inner was owed by this rebase. The changed memory and scheduling
cohort passed 111/111 with strict, timing and host audits green. Its helper
joined before temporary removal.

The ordinary selector writer refreshed only
results/gate-inputs/rust-runtime.json: the run.mjs file fact's size and hash,
and the enclosing key hash. The 57-target projection hash is unchanged.
Commit 3b65c8f442a00cebd85e7755b900bcbcf131821a carries that generated update.
Rebased supported at 3b65c8f442a0 passed all 19 summary rows plus build.
The ordinary tooling cases were 2,697 pass, zero failures and two existing
Unicode TODOs. Runner wall was 859.146 s; whole CLI wall was 943.847 s.
Native tests took 402.445 s, tooling 322.251 s against its unchanged
900 s bound with no excluded wait, records 124.282 s and gate-inputs
103.659 s. This run overlapped the full check's core run; it is not
a speed comparison. Canonical environment, clean source, complete scope cleanup
and diagnostics were confirmed. Memory recorded two growths, two withdrawn
tickets, one shrink and no over-budget step or kill. The selector's 600 s
estimate budget remains separate from elapsed wall time.

The rebase supplement is
/home/akisarou/.cache/nts-scratch/761/raw-post-800-evidence-v1.json,
SHA-256 553e3c19f571bc4e5378f048c7c19f47355a339025ffea1e70f419f3cc013378.
It authenticates 126 artifacts (8,175,765 bytes) and 27 exact Git receipts, with the prior finite manifest
kept unchanged. The supported-v1 launcher refused a mistyped source pin before
starting any gate step; that setup attempt is excluded. Pool 3's idle incremental
output and the idle targets in the two historical control trees were reclaimed
after process-user and directory-identity checks. Their branches, trees and
retained evidence remain unchanged; the deletion receipts are in the supplement.
