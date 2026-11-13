# Completed reports before synchronous work — #773 (partial)

The child-to-parent reporter can leave a completed async case invisible while
its synchronous successor runs. The shared test bootstrap now offers queued
reports a serialization opportunity through a captured scheduler before each
case. The historical selector failure is still unattributed; #756 and #773
remain open.

Source: `24e49aa832bca9b3873f4876a067e9972d3fa043`, based on `13f536b72f5678c044be012e3cafd19155b5db7d`. The production change is in
`test-host-bootstrap.ts`; no selector, Git/collection protocol or guard changed.
The Node reporter observation and exact source digest are in the JSON.

## Event-order reduction

Seven synchronous cases precede an async marker. A synchronous successor runs
a TCP child, whose parent releases it only after receiving the marker's real
`test:complete` event through `runTooling`. This makes the dependency structural.
The original bootstrap is staged from the committed parent of the fix; the
second arm uses the fixed bootstrap. All other staged modules share the same
source. Both use the unchanged 300000 ms guard.

| Bootstrap | Result status | Report wall (ms) | Marker completion received | Probe exit |
| --- | ---: | ---: | --- | ---: |
| before | 2 | 300160.166813 | False | 0 |
| after | 0 | 143.064636 | True | 0 |

The original arm reaches the synchronous TCP request without delivering the
marker's completion; the guard names the already-finished marker. The fixed
arm delivers completion before that TCP request. Both probes eventually exit
normally, without a forced exit. The old probe's post-result drain makes the
whole paired unit ten minutes; report wall is not process lifetime.
The first incomplete paired attempt is retained and excluded.

The committed control supplies the clock/idle scheduler and asserts event
completion, without a short timing window. Its outer shared instrument guard
catches a wedge. A second control installs a parent test clock and proves the
captured transport scheduler still permits nested completion.

## Broad observations and supported proof

Two pre-fix loaded supported runs passed, one with private inline phase logs
and one with external scope observations. They showed completion of collections,
endpoints and children, or later synchronous work in the same worker; they did
not reproduce the historical failure. The early-failed-child hypothesis has
no observed failed child and is not attributed as a cause.

The final supported run is `here-24e49aa832bc-1794561101636`, at the exact source above. Its
controller used 32 allocated CPU workers and
2147483648 bytes, through their own measured admission.
It watched landing state and would stop only its named parent on a landing;
this batch was uninterrupted. Other ordinary work may overlap.

Verdict: **green**, cleanup complete. Gate wall is
1031.397 s; summed admission wait is
609.161 s and can overlap execution. These are not a
before/after performance comparison. Per-step cgroup CPU and wall, exact logs,
controller/load observations and artifact digests are in the JSON.

Loaded tooling: 2258 passed, 0 failed,
2 existing TODOs (2260 total).
Native: 3047 passed, 0 failed,
8 ignored, across 55 binaries
and 18 doctest crates.

Focused runner: 23 passed,
0 failed. Consumer/selection/timing:
36 passed,
0 failed.
Host ownership and strict checks passed; the earlier strict refusal of an
optional regex group and its explicit presence assertion are retained.

## Reproduction and evidence

The JSON authenticates the executed scripts under `~/.cache/nts-scratch/773/`.
`matched-transport-v2.sh` runs the paired reduction; `broad-v3.sh` runs the
supported loaded route, each inside its named collected parent. The latter
uses the unchanged controller's landing-state cancellation and the route's own
admission. Raw scope observations stay off tree. Staged old-bootstrap source
was removed after the pair drained; the source pin and exact staging command
remain reproducible. No independent Git source copies remain.

This slice fixes the demonstrated reporting boundary. It does not establish
what physical operation stalled the historical concurrent preflight, and an
unchanged loaded pass is not presented as a historical fix.
