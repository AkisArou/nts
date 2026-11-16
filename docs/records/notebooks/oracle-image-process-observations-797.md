# Run-owned process observations for oracle image disposal

Part of #797. This slice fixes observation ownership and reports returned
uncommitted pool offers. Interrupted-run recovery remains unbuilt.

Image disposal now uses the run's required process-users view. Production
retains the existing live scanner and strict unreadable-process refusal.
Fixtures supply an empty owned proc tree or explicitly observe their captured
PIDs. Missing or malformed observations refuse by name.

The root-identity landing at `c236813e4707` failed at
`oracle-dependencies.test.ts:138:58`: the image still existed after a red close.
The close returned `retained after red`, but the test checked existence before
its per-image disposition and removed its private registry. The particular
vetoing PID or guard is unavailable. Four relevant owner/test blobs were
unchanged since #797 landed. The source path did depend on a scan of unrelated
same-user processes, contrary to the owned-fixture contract; this slice does
not claim to reconstruct that run's missing veto.

## Ownership and controls

`gateEnvironment` validates one complete descriptor before pruning or creating
a run temporary, then holds that in-process object through seal and close.
The serialized Context is unchanged. Construction validates the descriptor
without sampling resources or walking proc. The real canonical-entry controls
prove missing-view refusal before the requested allocation, and a later method
failure keeping its image by name while registering the closed root and bytes.
Direct temporary callers acquire an omitted view lazily inside each image
guard. A no-image close needs no process view, and a malformed view cannot
veto the root's closed accounting.

The candidate launcher acquires its explicitly owned resource packet before
calling another version's factory. A current candidate's held object is used
after descriptor equality; a downlevel return without that field uses the
launcher-acquired object. A rewritten descriptor refuses before payload work.
Actual downlevel controls pair supplied holder and empty views through the
child's red close and the wrapper's existing discard policy: the holder keeps
its image and closed row; the empty view permits removal. Missing-view refusal
leaves no factory entry, temporary or image, and only the wrapper's drained
group-receipt namespace. The existing discard policy is unchanged.

The packet binding belongs to `host-environment.ts`, the host audit's already
declared environment owner. Validation and sampling stay in
`host-observations.ts`. An intermediate placement there passed because the
matcher does not trace a parameter spread from its `process.env` caller, not
because that module owned environment reads: it is scanned, but its row grants
only disk, machine, kernel and clock kinds. The final placement adds no audit
exemption. A paired direct-spread mutation is accepted at the declared owner
and refused in the unowned launcher. The parameter-spread form is documented
in [#799](https://github.com/AkisArou/nts/issues/799#issuecomment-6924179896).

## Returned-offer telemetry

The first tooling-only diagnostic exposed #808's latent idle-pressure
accounting flake. Six grants and releases balanced, but the old equation
expected five: a granted offer can return before dispatch without becoming a
committed case replay. Exact outcomes, kernel-origin, completed-case/no-replay
and cgroup-drain assertions were already green.

`ResidentPoolSummary.returnedOffers` is production telemetry. The feed's one
memoized return counts a unique successful return after token closure and path
restoration; summaries aggregate every round, including hidden internal and
warm returns. The exact grant equation includes that count, bounded to zero or
one in the pressure fixture. Failures print per-path token history. Controls
pin unresolved/repeated joins, internal raced grants, a real warm attachment,
forced startup exactly one, and ordinary operation zero. Dispatch, admission
and retry policy are unchanged.

## Proof and cost

| Evidence | Actual result |
| --- | --- |
| Original process-view cohort, `687d4d446f` | 75/75; strict, timing and host audits 0 |
| Exact main owner / fixed owner | Main 31/32, supplied holder ignored; fixed 32/32 |
| Fresh inner, `687d4d446f` | fmt 3 s, Clippy 22 s, build 1 s, tests 423 s; 808 Rust tests passed |
| Joined-return cohort, `3b5da30cfe09` | 48/48; all audits 0 |
| Full focused cohort, `cfb2ec3405` | Uninstrumented 160/160; observational repeat 160/160; all audits 0 |
| Final affected cohort, `89dda065f0` | 69/69; all audits and paired owner mutation 0 |
| Rebase onto #810, `cd4bd92640` | All 28 own non-document blobs equal the final affected source |
| Final supported, `cd4bd92640` | 20/20 PASS including build; native 3,078/0/8 ignored; frontend 7 files, 0 failures/unavailable; tooling 2,821/0 with 2 existing TODOs |
| Exact-tip readiness | Separate receipts bind the final Markdown tip |

The retained inner is authenticated by 1,690 Rust/Cargo facts, 367 literal
embedded-input occurrences and 774 actual Cargo dependency files. All native
facts remain exact, and no later changed path intersects an emitted dependency
input. The final supported source has the same canonical constructor and
observation-validator bytes as the measurement source. No later fresh inner
is inferred or claimed.

A read-only loader timed only `hostObservations(env)` in the eight focused test
processes, excluding recording I/O and separately spawned CLI children without
the loader's execArgv. Both complete cohorts passed; their total durations are
not an end-to-end performance comparison under changing machine load.

| Constructor sample | Calls | Median, ms | p95, ms |
| --- | ---: | ---: | ---: |
| All successful acquisitions | 66 | 0.016485 | 0.126461 |
| Owned fixture descriptor | 27 | 0.084256 | 0.362146 |
| Live adapter construction | 39 | 0.005755 | 0.024275 |

Median averages the central pair for even sample sizes; p95 is nearest rank.
The original driver's upper-middle output is retained beside the derived
summary and all raw calls. The final supported run is uninstrumented. Its environment is canonical with
no experiments or dirty source; scope cleanup and diagnostics are complete.
The green temporary was removed, the external command exited 0/null, and its
unit is inactive. All selected steps passed on the first attempt. The owner
reported 1,100.326 s; the full command took 1,327.142 s including selection.
Tooling used 428.452 s of its 1,235 s bound. These are observed costs under
concurrent machine use, not a performance claim or a bound change.

The accepted `rust-runtime.json` is inherited byte-identically from main
`cb1e3f79decd`. This slice therefore runs conservatively stale-live. The
coordinator assigned the next canonical refresh to #798, after #812. No record
authority, resource bound, history or cleanup guard is weakened. Recovery,
image discovery/adoption and deletion policy are unchanged.

## Exclusions and receipts

Earlier results retain their exact source and scope. Tooling-only V1 was
2,805/1 with two existing TODOs and found the offer equation. V2 passed
2,807/0 with two existing TODOs at `3b5da30cfe09`; it is a diagnostic, not the
final canonical suite. Later tooling and supported launches stopped before
owner corrections are incomplete. Focused V5 stopped before controls on a
private path typo; V7 stopped in strict on an unused import; V8's audit rejected
an unowned environment spread. V9 was 68/69, solely an overbroad whole-run
absence assertion: the launcher's group receipt legitimately precedes factory
allocation. The final control checks the actual temporary/image boundary and
exact receipt namespace. No assertion was loosened to accept stray allocation.

The temporary one-requeue exception for #810's departure publication race was
retired when #810 landed, before final supported. It is not a retry policy for
this slice. Disk-admission waiting and own regenerable incremental reclamation
are instrument diagnostics; neither changes a fixture verdict or any bound.

Finite raw evidence: `~/.cache/nts-scratch/797/process-users/raw-evidence-v1.json`,
SHA-256 `d8b997ce9b5a6a796967da99705a9e9d5ea3139a1822e28532094ca10465f257`.
It binds 1,388 artifacts / 20,541,060 bytes and 378 Git facts including absences:
the original failure, source comparisons, complete/partial run statuses,
constructor calls, owner-audit pair, native/dependency and rebase bindings,
and the complete supported result. Exact-tip readiness and finite peer
authentication have separate receipts in the same kept scratch.
