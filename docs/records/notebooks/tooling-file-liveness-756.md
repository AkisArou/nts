# Tooling-file liveness: #756

Source `27c41bedf7ee4d4e9e530e70ae9bfb643f2af5ba` replaces the collector's silence-only decision with the existing
command liveness owner. Frozen proof `18a48a95f9847fc2bb361a70a58c3958cf4853e9` adds only the contract clarification;
the base is `bc0f92a309bad8583ac73c3e4fe242303d801f6d`. The [companion](tooling-file-liveness-756.json) authenticates
512 artifacts (18,810,552 bytes) and
66 base/intermediate/approved/proof source receipts.

## Accepted proof

The normal supported run `here-18a48a95f984-1794620338363` is canonical, with no experiments.
All 16 summary steps pass. Tooling is 2,336 passed, zero failed,
zero canceled and two existing TODOs; native is 3,047 passed, zero failed and
eight ignored across 55 binaries and 18 doctest crates. Both diagnostics and
scope cleanup complete. Runner wall is 470.932 s;
CLI wall is 473 s. Summed admission waits remain separate.

The actual documented `node tooling/gate/inner.ts --no-agree` route exits zero
on the same frozen source. Its exact formatting, Clippy, build and test output is
retained. The final focused owner/collector controls pass 56/56; host audit is
1,913 sources / 273 closures / 418 reads, and strict is 854 modules / 5,694
recorded diagnostics / no outstanding improvement. No expectation or guard is
relaxed.

The old/current control uses the old collector's exact Git blob and identical
current staged dependencies. At a supplied monotonic 300,001 ms the old arm
holds status 2; current completes status 0. Its body really performs silent CPU
work. This establishes the liveness decision boundary, not a physical five-minute
execution or the historical child's exact wait. Separate controls keep a truly
idle file held by name, verify acquisition before first-body blockage and on fast
completion, reject missing identity, and preserve a definite completed FAIL beside
its independently validated observation diagnostic.

## Ownership and behavior

The pinned Node public spawn channel identifies the actual owned test-worker
ChildProcess, executable entry, parent and PID birth before reporter delivery.
Eval, print, other-script and value-consuming option shapes cannot borrow entry
identity. One shared process snapshot per tick attributes each root's descendants;
a sibling or unrelated session cannot supply its progress. CPU progress or R/D
threads keep a silent entry live. The named five-minute no-progress backstop stays.

The collector explicitly delegates CPU budgeting to the enclosing step; a supplied
90,000 CPU-second observation proves there is no hidden 1,800-second per-file
limit. Missing acquisition/activity remains unmeasured and fails as INSTRUMENT
when no assertion has completed failing. A completed assertion failure remains
FAIL with its count and a separate observationFailure. Cancellation remains owned
by the existing tooling slice. The channel subscription, pending spawn listeners
and sampler registrations close after the stream drains.

## Named tests and scope

The earlier [partial record](../supplied-timing-756.md) retains the timer/scheduler,
TLS, bounded-entry and native acquisition controls and the exact historical fix
mapping. Existing causes include inherited sampler Worker flags, a late reporter,
a short capability probe and a real-disk fixture. The successful TLS deadline now
uses supplied scheduler decisions plus real accepted-socket wiring under the
common instrument guard. Those fixes are already on main; this slice changes the
collector shared by owed-range, service and the other tooling files.

The former selector hold and the later owed-range policy test were both cut by
the silence-only file guard. Their exact pending historical operation is not
retroactively diagnosed. The UV signal cause is likewise unknown. #773 retains
historical transport attribution independently of #756's liveness contract.

## Retained failures and exclusions

The private receipt representation first exposed that reporter events may not
arrive before a synchronous first body. It was replaced with the parent-owned
spawn channel. The V3 callback-scope ReferenceError, V7 numeric Node worker-option
refusals and all strict findings are retained. V8's passing controls did not cover
completed FAIL precedence; V9 adds the actual missing-observation fast-fail arm.

The earlier forensic loaded envelope had nine compiler/oracle preparation errors
and one observer-only FD3 EINVAL. A final reduction identifies that FD3 fault:
inserting --import before the simulated wrapper's candidate argument bypasses its
FD3-forwarding branch. Both trace targets completed without a guard, so this
cohort supplies no canonical integration or historical cause claim. The observer
investigation ended; it is not part of the product change.

Two later supported chains were stopped by their exact named parent units before
any deliberate load started. Their summaries retain SIGTERM and pressure endpoint
cleanup errors. A private controller's empty cleanupErrors array does not make
gate cleanup green. The exact acquired worker-root departure is assigned to #775;
this slice contains no scope or pressure-lifetime fix.

## Loaded confirmation

The coordinator accepted the old/current and supplied liveness controls plus
normal canonical/inner proof for landing. Deliberate-load `--here` is confirmation,
scheduled on landed main after tonight's benchmarks finish so it cannot contaminate
their measurement. Its actual result will be added to #756; a refusal reopens the
issue. No loaded whole-run success is claimed here, and no performance comparison
is inferred from these separately configured runs.
