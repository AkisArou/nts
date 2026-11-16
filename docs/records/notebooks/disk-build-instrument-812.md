# Disk build admission is an instrument result

Fixes #812. A disk admission refusal is immediate, typed INSTRUMENT in every build route. The enclosing run releases its memory; it does not wait or immediately retry under the same reservation. Actual compiler errors with adequate owned disk remain product failures.

## Cause and contract

The full check at records-only 1a8ddfb121a2 classified test-profile's plain disk admission Error as red tests/doctests and began culprit attribution. The observed doctest refusal needed 1,659,498,496 B above the floor and promises. The typed owner now publishes the exact root, target, output kinds, shortage, free bytes, floor and promises. Receipt validation checks shape, canonical paths, integer bytes and the equation; a message alone grants no classification.

The gate keeps the primary disk receipt before interpreting missing Cargo artifacts or observer output. Inner phases bind unique receipts at their existing launch boundary and preserve canonical owned values. Landing's build route and ordinary steps retain the typed cause. The full check holds and uses its existing retry, without a culprit search.

## Queue policy

A disk-held landing is already drained. The service stays up without a run reservation while that entry waits aside; docs and records entries may pass. Capacity events from claim releases, lease changes, upkeep and reclaim trigger the existing full snapshot. There is no periodic retry, readiness cache or attempted build. When the real equation permits it, the entry returns with its original arrival key. Every answer has a source-owned nonce; readiness for an old answer cannot revive a newer same-timestamp result. A disk-held withdrawal answers immediately, and the actual check.ts command wakes the waiting service through watched held/withdraw paths. Status text and JSON identify the entry, last measured shortage and automatic retry.

## Why refusal does not wait

| Owned capacity experiment | Result after release/completion |
| --- | --- |
| A 1 GiB temporary promise releases | -1 GiB becomes zero |
| An unspent 2 GiB Clippy claim releases | -1 GiB becomes +1 GiB |
| Clippy allocates its 1,358,548,992 B forecast, completes and releases, output retained | 284,807,168 B deficit remains |
| Two idle unbuilt trees each promise 7 GiB | 100 observations change nothing; giving a lease back restores room |

A completed build can retain its bytes, so waiting for completion does not generally supply the deficit. The one full production snapshot measured 91.804 ms, across five current pool leases, live statfs/claims and allocated-byte reads. Those profiles were complete and promised zero remaining bytes in this sample; no speed or cold-tree cost claim follows. No admission, reclamation or cached state was used in that measurement.

Open pool-policy question, outside this change: an unbuilt taken tree keeps its cold-build promise for its entire lease, even after days idle. Whether that promise expires or status should flag it is for a later decision.

## Proof

| Evidence | Actual result |
| --- | --- |
| Focused V5 at b7d014c2d9 | 189/189; strict/timing/host 0; helper joined and green temporary removed |
| Rebase onto #809 at 43115e220e5d | All 25 own code blobs exact; accepted selector inherited unchanged |
| Fresh inner at 43115e220e5d | fmt 3 s; Clippy 10 s; build 18 s; tests 790 s; 809 passed, no failures or ignored cases; external 0/null |
| Native input binding | 1,691 Rust/Cargo/toolchain facts, 367 literal embeds, 598 actual dependency files captured |
| Final supported at 43115e220e5d | All 20 selected PASS; native 3,079/0/8 ignored; frontend 7 files/0 failures/0 unavailable; tooling 2,844 passed/0 failed/2 existing TODOs |
| Finalization | Canonical/no experiments; complete cleanup and diagnostics; green temporary removed; zero retained candidate-group receipts; external 0/null and unit inactive-success |


The immutable b7455013106e disk-capacity module, loaded whole and byte-exact at its actual URL, fails the new typed-authority assertion with the original plain Error. Fixed source emits the validated disk receipt and owns no build claim. Both arms deny the same owned 1 GiB shortage before Cargo. The actual E0308 control has ample owned disk and remains Cargo exit 101 with no instrument receipt.

All five production beginBuild callers are covered: landing build, inner build, Clippy, test-profile and tooling-load. Direct capacity controls and the outer inner/Clippy/shell/doctest/workspace routes also exercise receipt propagation. Real gate controls run in private owned systemd lifetimes and require empty admitted/waiting sets after close. Full-check controller control observes held/no attribution and its normal later retry after supplied room. Queue and service controls separate original-arrival ordering from asynchronous filesystem event observation.

## Exclusions

V1 stopped at strict on three test typings. V2 strict/timing passed and host audit found a duplicate inner launch-environment spread; the correction binds values at run's existing launch boundary without new debt or exemption. V3 had 179/189, with a Checking projection defect and fixture setup errors: shared inherited observations, an already-returned pool path, and shell diagnostic placement. V4 had 188/189: its C-order assertion demanded an event order policy does not promise. The coordinator approved moving exact arrival ordering to the queue and retaining A-held/B-pass/release/A-landed at the service. Those red controls remain raw evidence. Inner V1 was stopped by its own named unit at the coordinator's direction while Clippy still waited, before heavy work: #809 changed two Rust readers, so the fresh inner belongs after rebase. It is incomplete and supplies no native pass. The first counterfactual harness called fixtureEnvironment without a fixture; it is setup failure, not a historical verdict. V2 uses testEnvironment and the exact named old-code failure.

Main's accepted rust-runtime.json remains unchanged. #798 owns the next canonical refresh; this slice may land conservatively stale-live. No floor, forecast, promise policy, bound, history, parallelism or deletion kind changes.

Supported reported 735.853 s at its owner and 730.488 s in the gate runner.
The whole CLI took 881.996 s including selection. Tooling used 368.838 s of
its unchanged 1,239 s bound, with no excluded admission wait in its bound
clock. The native test step used 355 s; gate-inputs used 223 s. These are
observed costs under concurrent work, with no speed claim. After inner and
before supported, only this tree's regenerable nts-dev/incremental output was
removed after the inner unit drained: 6,007,512,575 logical bytes.

Both endpoints deliberately ran conservatively. Main's record was stale-live
at host-environment.ts; this tip also reached the known endpoint-catalog
mismatch at command-entry/instrument.ts. No selector record was regenerated or
hand-merged. The subsequent #761 endpoint and records slice remains separate.

The rebase preserves every one of the 25 own non-document blobs from focused
source b7d014c2d9. The final native proof is freshly run at the combined
43115e220e5d source, after #809's Rust changes. The earlier stopped inner is not
carried as proof. The two declared compile producer key inputs are byte-exact
to the base, so compile outcome retirement is not owed.

Finite raw evidence: `~/.cache/nts-scratch/812/raw-evidence-v1.json`, SHA-256
`32fe7f13846991e72af0be3dd62f98a030ec908c17d884f1504260408d06614b`. It binds 1,711 artifacts / 12,571,191 bytes and 5,973 Git facts,
including explicit source absences. Decision experiments are in
`promise-measure-v1/snapshots.json`; the live snapshot is
`snapshot-measure-v1.json`; final actual supported bindings are in
`supported-v1-final-verification.json`. The raw manifest also binds all scoped
controls, historical loader bytes, native facts/dependency receipts, the exact
rebase comparison and the intentionally excluded runs. Exact-tip readiness and
peer authentication have separate final bindings in the same kept scratch.
