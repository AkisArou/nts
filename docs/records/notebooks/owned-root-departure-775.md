# Owned root departure: #775

Production `ac467e3ff0942463e0f6a3a999cd1c2c3b98ec95` binds pressure reads to each acquired root lifetime;
proof `10ca16f71af6cf7b884be2483505f0fd7aa5eb1e` includes the actual runner controls and final fixture drain.
The base is `c096060f7fabf3c887974479d40ccc6fc29c6eb5`. The [companion](owned-root-departure-775.json)
authenticates 214 retained artifacts (7,521,253
bytes) and 44 source receipts.

## Accepted integration

The supported run `here-10ca16f71af6-1794624078933` is green/canonical with no experiments.
All 19 summary steps pass; cleanup and diagnostics complete.
Tooling: 2,342 passed, zero failures, zero canceled, 2
existing TODOs. Native: 3,047 passed, zero failures,
8 ignored across 55 binaries and
18 doctest crates. Actual inner passes fmt/clippy/build/tests
in 4/1/0/457 seconds.
Runner wall is 585.111 s; CLI wall is 590 s.
Summed admission waits are reported separately and can overlap execution.

The final committed owner/runner controls pass 20/20. Timing lint, host audit
and strict logs are retained; no host allowance, expectation or timer is relaxed.

## Original failure and real cancellation order

A named cancellation of #761 had left a removed root's cgroup.events read as a
cleanup error. A later named stop during #756 additionally exposed #757's PSI
read after the acquired worker root departed. Both historical runs remain
interrupted/incomplete evidence, never accepted green proof.

The baseline control acquires an actual root and PSI endpoint, publishes readiness,
then receives a named-unit stop. Its signal handler observes the bound root absent
before the pressure sample and ownership close. The original source records
pressure sample ENOENT, diagnostics-close failure and cgroup.events ENOENT. It exits
143 and retains interrupted/non-green status. The initial corrected arm keeps that
same status but closes ownership and diagnostics, removing its own receipt. Raw
root identities and source hashes remain in both receipts.

The committed real-runner control pauses only after run.mjs acquires its root and
first endpoint, before a step starts. Normal release gives actual status 0/green.
Named cancellation gives status 143/red and interrupted SIGTERM, with no canceled
step recorded PASS. Both actual summaries retain scope_cleanup complete and
diagnostics complete. A body finally joins the runner before scratch/environment
teardown can remove files used by its reporters.

## Ownership contract

GateScopes retains the acquired group/device/inode independently of the ownership
receipt. A present root must match before and after its populated observation.
An absent root closes only after the exact manager is inactive or unloaded and
the path remains absent. A foreign, changed, populated or live-unreadable root
continues to refuse. Ownership receipt nonce validation still protects release.

The pressure owner supplies a read capability. Every callback, including the
initial one, is enclosed by matching acquired-identity checks. Removal/replacement
after reading does not certify that new point. A prior accepted worker point
retains its original counters and observedAt; departedAt separately records when
departure was observed. Current worker pressure becomes null. Each worker exposure
ends at its actual sample time, and a new step after departure refuses. Machine
and runner observations continue independently. There is no new signal authority
and no invented terminal counter or peak.

## Review correction and exclusions

The first implementation's separate presence check and pressure read allowed a
replacement's first point in a supplied-effects composition. Helper's retained
before reduction accepts foreign-pressure-root and later complete departure.
The read capability fixes that seam. Committed replacement-first, removal-first
and removal-later controls reject unavailable acquisition and retain only the
prior accepted 100 counter point, discarding the unaccepted 900 point. This is a
supplied-effects reproduction, not a kernel race observed in the historical run;
the old-signature private driver is before evidence only.

The first private runner setup listed only one all.sh row and was refused before
acquisition. The first committed fixture queried all.sh inside an executed closure
that did not contain it. Both are retained setup failures; the corrected controls
read the complete actual production registry through its declared source URL.
No product assertion was weakened. The before/initial-after root receipts predate
the final read-binding correction; final composed and actual runner controls
carry that correction's proof.
