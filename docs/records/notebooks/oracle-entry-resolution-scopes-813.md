# Oracle entries own their resolution sessions

Fixes #813. Two real CLI commands now run sequentially under the same unsealed
canonical parent, each with a live resolution holder of its own. A sealed
parent instead lends its one live session to both commands and alone closes it.

## Cause and ownership

Immutable dependency-image reuse also reused the directory containing mutable
Node resolver state. The first standalone entry closed and joined its helper,
leaving terminal holder metadata there; the second correctly refused that dead
holder. Retrying, deleting that metadata or weakening holder validation would
hide the lifetime mismatch.

The canonical Context now carries a private resolution root's captured path,
device, inode and uid beside its actual owner PID and birth. Fresh unsealed
entries create that root under their own temporary. Same-source sealed children
retain the exact parent's scope. One Node-only locator in oracle-runtime.ts
checks root identity, privacy and live birth for both sealOracleRun and emission.
ownerRunScope keeps its dependency-image meaning for locks and accounting.
Non-Linux keeps the existing bounded path; missing Linux ownership refuses by
name before its PID is used. No new portable runtime asset is needed.

The entry's existing command closer joins its child and newly acquired helper
before releasing admission and disposing scratch. Borrowers close none of the
parent's session. Completed metadata remains terminal; changed root, birth,
options, executable and holder identities still refuse.

## Actual controls

| Route | Result |
| --- | --- |
| Exact main canonical/runtime/emitter modules, read-only loader, same fresh planner and private population | First command completes three plans; second refuses `oracle Node executable holder changed`; first helper already closed |
| Current unsealed parent, real record-oracles plan then plan-rc under canonical --pinned | Both pass; distinct live holders and roots; first helper joined before the second starts; all helpers gone at final receipt |
| Current sealed parent, same real CLI pair | Both pass; one exact live session survives both borrowers; parent closer joins it before receipt |
| Captured root replacement or changed birth; absent scope | Named refusal before reuse |
| Completed holder metadata re-acquisition | Named dead-holder refusal; metadata bytes unchanged |
| Affected scope/holder cohort | 53/53; strict, timing and host audits 0 |

The main loader substitutes three complete immutable Git blobs from
41dc670e98cd at their real URLs. It changes no source tree and does not claim a
historical whole-compiler run. Its snapshot receipts authenticate every byte.
The fixed sibling controls execute unchanged production command entries without
that loader. Corpus markers are declared fixtureInput bytes placed before
private cases; ordinary planning has three backends and RC has two.

The generated controller uses runAsCommand and registerCommandCloser for helper
close/completion, temporary disposal and the drained receipt. The unsealed
pinned child owns a nested run rather than the controller's temporary. No timer
was added to keep an unreferenced helper join alive.

## Source and gate proof

The clean #812 rebase at 9b6eee597076 preserved all seven own non-document blobs
from the reviewed source. The single fresh inner there passed fmt/Clippy/build/
tests in 3/2/16/733 seconds, with 809 passed, none failed or ignored, external
0/null. Subsequent changes are confined to the new fixture declarations and RC
assertion. All 1,691 native source facts and 367 literal embeds remain exact;
803 retained dependency texts exclude that test file. The inner is retained by
that explicit equivalence, not relabelled as a second run.

Supported check.ts --here ran at 537da7c76876. All 19 selected steps passed,
including build. Native results were 3,079 passed, zero failed and eight ignored
across 57 binaries and 19 doctest crates. Frontend had seven files, zero failures
or unavailable. Tooling had 2,851 passed, zero failed and two existing Unicode
TODOs. Both new CLI controls passed in that canonical tooling run.

The landing owner and runner reported 964.513 and
954.825 seconds; the complete CLI took 1083.850 seconds,
including selection. No speed claim follows. Environment was canonical without
experiments; cleanup and diagnostics completed; the green temporary was removed;
the CLI returned 0/null and its unit drained inactive-success.

The accepted rust-runtime.json is inherited byte-exact. Both endpoints selected
conservatively stale-live; no selector guard was relaxed and no generated record
was hand-merged. The final record is the only source change after supported.
After inner drained, only this tree's regenerable nts-dev/incremental was
removed (703,094,426 logical bytes), as required by AGENTS.

## Excluded setup attempts

Affected V1's six failures were existing fixture setup refusals naming an
obsolete oracle-emit.ts installation-catalog pin; real linker publication made
the unchanged 53-test cohort green. The first historical harness labelled raw
TypeScript as JavaScript; the next exposed absent corpus-root markers, and a
third omitted fixtureInput's required empty data context. Those are setup
failures, not main verdicts. The fourth historical arm reached the exact named
second-command refusal. Fixture corrections preserve all lifecycle assertions.

The initial supported wrapper rejected a mistyped source pin before preparing
anything. The corrected wrapper ran the exact committed source above. An initial
summary reader assumed 20 selected steps and Cargo-style native lines; it was
corrected against the actual 19-step green result and aggregate native summary.
That reader failure is not a run verdict. Raw evidence and the correction are
retained. One affected wrapper used the label HEAD; its separate binding names
the actual clean source, and the label was never an execution input.

Finite raw evidence is `~/.cache/nts-scratch/813/raw-evidence-v1.json`, SHA-256
`ea2ac12168c7e29ffcee6c996aa67ba1e090ff829ca178872c11daa2ff264bed`. It binds 1,884 artifacts / 13,009,519 bytes and
7,892 Git facts, including explicit source absences. Actual gate
bindings are in supported-v1-final-verification.json; retained native proof and
later-source equivalence are in native-source-v1.json, dep-info-v1.json and
post-inner-fixture-equivalence-v2.json. Exact-tip readiness and peer review have
separate final bindings. No recovery, scheduling, retention or deletion policy
changes belong to this slice.
