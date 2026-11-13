# Runner delay and pressure: #757

Source `6a1ce581ecc64d7dfcfac43091f92d155c128704` adds runner diagnostics through the complete
`HostObservations` capability. The implementation is source
`c0a624dd0cd5ab8c898d7f0fc2176e59026b0473`; only its contract and retention row
follow before the frozen proof pin. The parent is `f018490034afc05d55fe1a66ab2e95b73c27ea3a`.
The [companion](runner-pressure-757.json) authenticates 371
retained artifacts (24,043,571 bytes) and 96
base/corrective/proof source receipts. Raw timelines, test resources, counter arms and
failed attempts remain off tree with exact sizes and hashes.

## Accepted integration

`here-6a1ce581ecc6-1794611769074` is canonical, with no experiments. All
19 summary steps pass; cleanup and diagnostics complete.
Tooling: 2,324 passed, 0 failed, 2
existing TODOs. Native: 3047 passed, 0 failed,
8 ignored across 55 binaries and 18
doctest crates. Runner wall is 514.677 s; CLI reports 518 s.
Summed admission waits are 306.143 s;
they may overlap execution and are not deducted from either wall measurement.

The real run retained 25,294 native delay samples, max
529.006591 ms and p99 21.594111 ms. Every started step has its
own native histogram and endpoint pressure exposure. Machine, runner cgroup and
worker-root identities are distinct; worker exposure starts only at attachment.
The final timeline row follows meter drain and reports `complete`.

The actual documented `node tooling/gate/inner.ts --no-agree` route passes at
the same source: fmt 3 s, clippy 1 s, build 0 s, tests 274 s.
No hand-built compiler or environment substitutes for either route.

Focused owner/consumer/timing proof is 96/96.
Host audit is 1,911 sources / 272 closures / 418 reads; strict is 852 modules /
5,694 diagnostics / zero improvements outstanding. Gate-inputs retains 178 full
paths, split into 142 fallback and 36 policy paths.

## Controls and review corrections

Supplied observations cover exact PSI arithmetic, overlapping step exposure,
counter reset and scope identity refusal, empty histogram count zero with null
percentiles, delayed wall acquisition and later worker attachment. Missing
observations fail by name. Native meter wiring explicitly waits for samples.
Terminal publication follows every meter close; a supplied close failure leaves
an incomplete terminal state. A staged real runner cleanup failure is non-green
and still drains its ledger. Reused summaries retain diagnostics under `origin`
with the original `sourceRun`, and acquire no fresh measurement claim.

The initial review found publication before meter drain and a late monotonic
origin paired with an earlier wall timestamp. Both are corrected. A subsequent
host audit refused the new direct wall-clock read; `wallNow` now belongs to the
complete fixed/live capability. No host allowance or strict count was relaxed.
The three earlier preflight refusals are individually retained in the companion.

## Held run and handle attribution

The first whole run, `here-6a1ce581ecc6-1794609156637`, is held, not accepted
green evidence. Native passed 3,047/0/8. Tooling completed 2,303 passing
assertions with no completed assertion failure, then the existing 300 s
no-activity guard named owed-range's policy-range case; service was also
canceled. Both cleanup and diagnostics completed. The inner route did not start.

Both canonical module closures reach changed sources, so the coordinator required
three standalone runs per file at main
`d43883e4d75ad27fc1be9f8e136969addb946042` and at the unchanged proof tip.
All 12 named/admitted runs exit zero: 582
assertions pass. All 97 case-completion resource
comparisons and terminal snapshots match. A shared transient TCPServerWrap is
gone by file completion; file/exit retain only the inherited pipe pair. The
beforeExit transient Timeout is identical in both arms. No persistent
candidate-only live handle or standalone hang is observed.

Between 22:40 and 22:46 UTC on 13 November the held run's 360 samples show
machine CPU/memory/IO some avg10 maxima 57.8% / 3.03% / 55.91%, and worker-root
46.12% / 1.13% / 26.62%. Runner delay max is 424.935423 ms with no >1 s block.
These establish pressure in the environment, not the exact child event that
stopped advancing. The timeline and matrix are attached to
[#756](https://github.com/AkisArou/nts/issues/756#issuecomment-6867320600);
the precise child cause remains open under #756/#773. The coordinator authorized
one unchanged rerun after the matrix; that is the accepted run above. No guard,
source or test expectation changed between these whole-run attempts.

## Component cost

One fixed-source off/on/on/off cohort runs directly under `with-lock.sh` with
key `perf-count` on CPU 4. Each arm has 4,000 requested body iterations. On arms
have 4,005 actual boundary/body samples and five native delay meters; each has
14 actual native run samples. The companion retains individual arms, load,
source/Node/binary identity, cgroup CPU, peak and raw perf counters.

| Component | Mean instructions | Mean cgroup CPU s | Mean wall ms |
| --- | ---: | ---: | ---: |
| off | 664,241,497.0 | 0.089303 | 95.449178 |
| on | 2,868,148,280.5 | 0.367636 | 368.120648 |

The incremental mean is 0.069583375 ms per requested
body sample, including amortized boundaries. It measures nine PSI reads, native
histogram snapshots and a synchronous timeline append. This tight-loop component
is not a matched whole-gate overhead experiment or a measured production 1 Hz
CPU fraction. Scope peak includes the controller and varies across arms; no
memory improvement is claimed. Full arms remain visible rather than deriving
instructions from CPU or comparing absolute costs across cohorts.

## Admission correction and limits

The coordinator initially suspected failed priority yielding, then requested
#776 for an apparently impossible growth forecast. Exact ledger accounting
showed yielding already applied. The apparent 25.6 GB need was two separate
test/tooling forecasts of about 12.7/12.9 GB, each admissible on its own; tooling
waited for tests, then ran. This is correct serialization. #776 is closed
`NOT_PLANNED` as not a defect, with the original snapshots, source attribution
and correction retained. No unit, grant, history or floor was changed.

PSI is shared elapsed exposure, never an additive causal charge. Native
histograms measure the runner's observed delays, not child event loops; an
empty histogram certifies no latency value. Minute windows close at their next
actual sample and retain elapsed duration. A pressure timeline cannot identify
an unrecorded child wait by itself.
