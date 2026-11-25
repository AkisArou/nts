# Gate cost telemetry disk footprint

Issue #841. The first slice records pool snapshots only when their structural
state changes or after intervening state-bearing events, and appends compiler
observations to one file per process, with
session identity on every row. Readers accept both formats. Its purpose is the
session contract and removal of redundant snapshots; the measured population
below shows why these changes alone cannot substantially reduce core disk use.

## Baseline

Measured before repository edits, with committed tree HEAD
`3df1845faf` checked separately by `git log -1`. The actual core run is at
`1dccb9d1090c2b825f4e071cac7d43236f162cec`, green, with its original
`summary.json.case_costs` retained. Measurement used the agent-ranked memory
ledger in named units excluding CPUs 4–5. An earlier scan exhausted its unit
bound entirely in admission and measured nothing; the completed scan is
`nts-841-before-costs-v3`, and the event breakdown is `nts-841-before-queue`.

| Population | Files | Content bytes | Allocated bytes |
| --- | ---: | ---: | ---: |
| Entire baseline `costs/` | 65,872 | 528,645,661 | 685,195,264 |
| Check traces | 62,623 | 257,123,388 | 401,842,176 |
| Queue trace | 1 | 233,900,887 | 233,914,368 |

The queue has 3,660 `pool.state` rows using 12,036,374 bytes. Of these, 727
repeat the previous structural state when epoch and runner rusage are excluded.
The larger queue population is 243,050 `pool.change` rows using 82,873,271 bytes
and request/grant/release rows using about 46 MB per kind. Every check file has
a distinct PID: one file per process cannot reduce this run's inode count.
The initial task's attribution of the whole queue to periodic snapshots did
not match the measured event breakdown.

Raw baseline run:
`~/.cache/nts-full-check/runs/core-1dccb9d1090c-20261120T073629Z`.
Its sorted relative-path/content-digest manifest has SHA-256
`af2bfd1b4a159ef724fce7435083f82571c54cf37e2198b80d268eec28103e1f`.
The canonical JSON encoding of its original `case_costs` has SHA-256
`f62ff91cfddd04b9d05b83d6778e5bf051be0ad3e1f40a82660a7750a1b2e2ac`.
These are historical observations, not a reusable gate verdict.

The kept issue scratch contains the measurement recipes and raw output:

| Path under `~/.cache/nts-scratch/841/` | SHA-256 |
| --- | --- |
| `before.json` | `44089c9ed2066e9666f1f64b875966bae8b0c86a4de9c9454bdb92bcd2cad4b2` |
| `before-queue.json` | `b8dc81d9c081c6fce8c417bfa347a788fe63396f531ef36d70e7ef247d530ebe` |
| `measure-costs.py` | `04c0a0d02b79a1889fd4236dbf58abc543a72c6086e0ff9b63c4fac2593ef9ca` |
| `queue-costs.py` | `d3365001b2d7413eeeba6b12fb010071bc799414e749a681530d687a597eca80` |

`tooling/gate/case-costs-recorded.jsonl` is one completed compiler observation
from that run (`check-586929-0.jsonl`), SHA-256
`8e887f701f3565c4a9b7c919844821ac5d88a7d9f735a72153ff064a5e3a30fa`.
The replay groups interleaved sessions in legacy logical-file order and
deep-compares the entire derived summary, including its original floating-point
CPU and phase measurements. Additional controls count snapshot writes, preserve
every token event, retain completed and incomplete sessions separately, reject
unidentified compact rows, and exercise nested and concurrent Rust sessions.

## Review controls

Review identified that `waitingBreakdown` consumes every event carrying `used`,
including token events. Comparing a snapshot only with the preceding snapshot
could suppress the observation that restores the reader after a token event.
The added sixty-second replay has one request waiting throughout, a second
request short of memory at one second and cancelled at 1.2 seconds, and a
restoring pool snapshot at 1.5 seconds. Against the unfixed implementation at
`1443badd63342327052c8ebf9ff4991a531257df`, the new controls failed: memory
admission was attributed 59 seconds instead of 0.5 seconds, and the restoring
snapshot was absent. The raw output is
`~/.cache/nts-scratch/841/review-regression.log`, SHA-256
`843e3ac01a685780271f57d5ac265d872ccff68b279a399c520758a24c4450cc`.
State-bearing events now invalidate the snapshot comparison, independently of
their event names; unrelated diagnostics do not. The summary identifies its
polling interval rather than promising a stream of periodic samples.

The shared process output also owns its first I/O failure. A recovering writer
control writes a partial prefix, fails its second write, then would recover on
the next attempt. A second session sharing that output cannot make a third
write, so no later record can merge into the unfinished prefix.

Snapshot dedupe now invalidates after every state-bearing event, independently
of its event name. Replay compares both the complete wait breakdown and the
entire derived summary with the undeduplicated trace. The metadata reports
`pool_state_poll_interval_s`, rather than promising recorded samples at a fixed
interval. A recovering test writer also emits a partial row then an error;
sharing its process output with another session proves that no further writes
are attempted after that failure.

## Approved remaining scope

The coordinator requested independently proved `Part of #841` slices, with a
fresh assignment after the first slice lands. The approved remaining order is:

1. **(b) Temporary lifetime.** One explicit owner drains the run and removes
   its authenticated `tmp/`, with a systemd-bound backstop for the exact root
   and unit, including forced stop. Directory identity and live-holder guards
   remain mandatory; historical discovery is outside the design. Any failing
   input, captured stderr, core path or other diagnostic that a red run's
   summary/logs references inside `tmp/` belongs in the kept run log directory
   before removal. The implementation review includes that diagnostic inventory.
2. **(c) Target inventory.** `keep.json` declares targets, and the count reports
   obsolete top-level `debug` in every declared target, including non-pool
   targets. Existing current generations and unknown markers remain protected.
3. **(d) Enabled deletion policies.** The owner approved both on 2026-11-20:
   green raw cost directories beyond the newest three completed runs can be
   pruned only after their `case_costs` summary exists; red, held and unfinished
   runs retain raw events, and all summaries/logs stay. Obsolete top-level
   `debug` profiles in pins, the hand gate and record/bench targets join #709's
   existing reclamation, with the same locks, claims, process and unit guards.
   Each reclaim log names its kind. These decisions belong in the governing
   workflow Decisions entry and dated decisions log when implemented.
4. **(e) Worker ownership.** The existing case-pool worker or runner outlives
   its cases and already receives their results. Its existing channel can own
   check-record publication, reducing files to worker slots rather than PIDs.
   The coordinator confirmed that its first implementation uses
   `durableRecordStream` with `gzip: true`; a temporary plain writer is outside
   the design. Today's check-only target is 257,123,388 content bytes and
   401,842,176 allocated bytes, across 62,623 files. The after measurement of
   (e)+(f) includes both bytes and inode count on one real core run.
   No shared append file written by unrelated processes is approved. Explicit
   session identity and exact legacy-versus-compact replay remain the contract.
   Its reader replays legacy plain files, plain worker files and gzip worker
   files to identical records, tested with one recorded population in all three
   forms. A mid-write death either replays through the last complete record or
   produces a named refusal; a truncated-gzip fixture proves that corrupt
   records cannot be parsed silently.
5. **(f) Remaining compressed streams.** Queue, token, pool-change and other
   remaining streams use
   `durableRecordStream` with `gzip: true`, as input traces do. Readers decode
   plain and gzip formats losslessly. A fresh real core run supplies the after
   row in the footprint table and raw paths/hashes; baseline remeasurement is
   unnecessary. Each slice still owes focused tests, inner and exact-commit
   `check.ts --here`, and coordinator sign-off before Signalbox queues it.

Node compile-cache policy is already implemented on this tree's base and is
explicitly outside these changes. `canonical-environment.ts` selects
`host-environment.ts`'s `nodeCompileCache` root
`~/.cache/nts/node-compile-cache/v1`; Node writes the cache, and
`cache-environment.ts` propagates its capability. `keep.json` already names
this writer and `node-cache-retention.ts`'s hourly bounds. The coordinator
required preserving that policy exactly. No shared cache, historical tmp or
other state was deleted during the first slice.

## Temporary lifetime slice (b)

The run's owner closes after workers, resolution helpers, scopes and admission
drain. A per-token receipt binds the created temporary and its parent by device,
inode and UID. Creation authority stays in the launcher context; dependency
capabilities retain only physical identity, preserving canonical environment
identity. Normal close and the unit's post-stop backstop use the same guarded
remover. Acquisition joins backstop activation before payload readiness.

The backstop binds the exact creator unit and invocation. Its working directory
holds the cleanup source through callback completion. Normal close requests its
stop without synchronously waiting behind a creator already stopping. A closed
receipt is idempotent only while the original temporary remains absent; a new
root at that path receives no removal grant. Unknown, replaced or held roots
refuse by name. No historical temporary population is discovered.

The diagnostic inventory reviewed for this slice is:

| Producer | Retained diagnostic population |
| --- | --- |
| Oracle dependency capture | Capture stdout/stderr, command, failure and identity metadata beside the registered image; only authenticated image payload directories are excluded |
| Resolution service | Existing holder stderr and regular diagnostic metadata; sockets and links are not copied |
| Blockers | `blockers-check.mjs` prints its retained root with `kept` and failed child-result JSON with `full result at`; those roots contain emitted reproducers, child stdout/stderr and child-result JSON |
| Other conformance drivers | `blockers.mjs`, `native-half.mjs`, `differential-ts.mjs`, `unconditional-expectations.mjs`, `agreement.mjs`, `cascade-reach.mjs` and `last-mile.mjs` print `kept` roots when requested; `compiled-axis-floor.mjs` names its axis artifacts |
| Fuzz | `fuzz-runtime.mjs` prints a `kept` failing source when `NTS_FUZZ_KEEP` is supplied; a path outside the authenticated temporary stays outside this owner's authority |
| Census and compiler runs | `ownCensusScratch` drains and removes its own scratch. `conformance262.ts` publishes stopped compiler output in the step log before removal; any scratch left by a forced stop is fallback evidence |
| Cores | Existing files only; the units retain LimitCORE=0 |

Retained paths live below `diagnostics-<token>/files/`, preserving filesystem
name bytes, including names that are not UTF-8. The sibling manifest maps that
namespace to the original temporary. This separation preserves an input named
`manifest.json`. Retention is bounded at 64 MiB and 4,096 files per run, with a
named cap observation. Copies use a bounded buffer and flush before removal.
The review correction uses the run's step logs as the production reference
inventory, without a second list of producer paths. Referenced top-level
artifacts precede unreferenced scratch. Each reference's original root, source
logs, retained destination and complete/partial/absent state are recorded in
the diagnostic manifest, whose path is logged. Original step logs are preserved.
Every removal logs its run, path and allocated bytes in `temporary.log`; forced
cleanup also reports through its unit journal. Oracle setup telemetry is captured
before removing its inputs. A cleanup failure remains non-green.

Focused controls passed all 118 assertions across temporary lifetime, legacy
temporary guards, canonical environments, candidate launchers and scoped stops.
They include success, ordinary failure, SIGTERM, a forced SIGKILL unit stop,
backstop activation readiness, live process/unit holders, root and parent
identity changes, tokens, future receipts, legacy unregistered scratch, both
retention caps and filename collisions. Strict tooling types and the source
ownership audit also passed. Raw output is
`~/.cache/nts-scratch/841/b/proof-v3.log`, SHA-256
`9c89c6674894a536bf372f3f844955ae29e43bc6e7e394ba2e4b6e3056b97151`.

The additional malformed-birth control was committed at
`bd956938bdf387d0e10116c83974b308f98799e0` before its control run. Against that
reader it failed with `Missing expected exception`: malformed owner data could
reach normal disposal. Raw output is
`~/.cache/nts-scratch/841/b/owner-control-leaf.log`, SHA-256
`2e34757575b81e516a6aa3920465cf501593c7971d3a184c242100e23f9ced5d`.
The reader now validates canonical boot/PID/birth syntax, matching creation,
record filename and token identities, and terminal record shape. The backstop
also requires the recorded creator unit to be inactive or failed before removal.
The completed focused rerun passed all 119 assertions, strict typing and source
ownership. Its raw output is `~/.cache/nts-scratch/841/b/proof-v4.log`, SHA-256
`7d3886164ee308b86e9273b860defac08395a9e1ff8d6c28ec06b337473ec11e`.

The interrupted-publication control was committed at
`e70177c73796b8a0ebb9a90520362bd1421a51be` before execution. It failed
with `EEXIST` on retry: a partial diagnostic directory blocked cleanup. Raw
output is `~/.cache/nts-scratch/841/b/diagnostic-control.log`, SHA-256
`72b6b1ce660d1089e7933da383f77d8411b12abe5e2f6c5f7751f583ff0747e4`.
Diagnostic copies now stage inside the authenticated temporary, with a flushed
manifest and exact staged directory identity in the receipt before atomic
publication. Retrying at copying, prepared and published checkpoints preserves
complete evidence and disposes temporary copies. Replaced or future publication
records refuse removal. A real SIGKILL during copying exercises backstop recovery.

The final focused population passed all 122 tests, strict typing and source
ownership. Raw output is `~/.cache/nts-scratch/841/b/proof-v5.log`, SHA-256
`ca308db903ca3736348d3be6cf54251a48b42f31eb239669646ede5bdfc95b13`.

The exact-commit landing proof for `b6b988a90e1a326b44bfd01e0455a15305e6485a`
passed in 1,465 seconds and disposed its temporary, but artifact review found
aggregate owner observations were read after disposal. The regression assertion
was committed at `ffe4a1e70c4ab5c72e3a165dc20c9fed27ac17b2` and failed
with `missing` versus `complete`. Raw output is
`~/.cache/nts-scratch/841/b/owner-summary-control.log`, SHA-256
`b92013b9e801e3e224a714b3b8b64df423ef9770520db61b978e486ef52b09e7`. The owner now snapshots aggregate emissions after
producer drain and before disposal, alongside setup costs.

The focused rerun passed all 122 tests, including exact aggregate emission
counts after temporary disposal, plus strict typing and source ownership.
Raw output is `~/.cache/nts-scratch/841/b/proof-v6.log`, SHA-256
`3271f3eb339e5dcac21d3073aacdfb82bb2f28d15e02034a5ca47e5eba3d7a52`.

The `94ceda330dbda4c72608f97f3a3627803dacef3e` landing proof passed
every step except tooling. Concurrent kernel controls exposed ambient holder
observations: measure-reuse saw a sibling's nondumpable process, and
case-admission saw another test's unit argument. The closer refused both and
removed neither temporary. The enclosing red run still disposed its temporary,
retained diagnostics within the logged 64 MiB cap, and published complete
aggregate owner observations (343 emits, 68 hits, 28 held). Raw tooling output
is `~/.cache/nts-scratch/841/b/here-v3-tooling.raw.log`,
SHA-256 `57553337b539759fef56caa28a161995b282aaa9a51f481b20f9a36e3302e2d5`.

Unit ownership now belongs to the same complete HostObservations capability as
process ownership. Production uses the existing live guard unchanged; fixtures
supply explicit UnitTreeOwnership arrays. Missing or malformed observations
refuse by name. Only the temporary closer adopts this capability, on normal
and backstop cleanup; canonical and candidate launchers reach it through that
owner. Measurement fixtures now retain their ownMemory packets instead of
dropping them through hostEnvironment. Argument parsing in the shared live
guard is outside this slice (#990).

Measurement packet authority now enters through pinnedGate's explicit `owned`
argument, preserving canonical verdicts instead of marking fixture observations
as ambient experiments. Fixed-resident case controls declare their named unit's
logical actor through fixedMembersUnitCommand. The widened focused suite passed
all 213 tests across nine files, including both previously failing areas, the
complete unit observation validation, and the temporary closer's refusal of
missing or held unit views. Strict typing and source ownership also passed.
Raw output is `~/.cache/nts-scratch/841/b/proof-v8.log`, SHA-256
`d2cc238de60d45304813ac218c5a43bef951e2407f4a2080dd90e51745b4acac`.

The `a754fc5df9db989afac55b5636d0db827173860f` proof exposed a
dependency regression: record writers owed the full gate because the common
observation owner imported reclamation's guards. Its owed-test assertion failed;
the local proof was then cancelled and drained before editing. Raw output is
`~/.cache/nts-scratch/841/b/here-v4-tooling.raw.log`,
SHA-256 `422d896d1452d1cdeb20a5474542c8946332ea174f11a5a125ebfd9c085c55f5`. The observation owner now returns typed
live or fixed unit data without importing reclamation. Only the temporary
closer dispatches the existing guards over that reading. The live guard and
its argument parsing remain unchanged.

The data-only reading passed the record-writer owed control, restoring its
precise selection. Strict typing, source ownership and the other nine focused
files passed. The standalone owed route needs a cache temporary directory;
with that supplied, one remaining metadata prerequisite control requires the
source refactor committed before execution. Raw output for that pre-commit
check is `~/.cache/nts-scratch/841/b/proof-v10.log`, SHA-256
`cfb695e012c309a725354f3a91ede5e0c7cc28fbceba4c91c94d4663c300755b`.

### Slice (b) review controls

Allocated-byte measurement now uses HostObservations after the authenticated
directory permission normalization. Both holder guards run again after that
measurement. Unreadable diagnostic directories and files produce named skips
instead of preventing disposal. The green predicate shared by retention and
terminal reporting includes cleanup failures, interruption, accepted skips and
strict timing.

The committed controls at `66a29a1b7e9ec38a7ba3f3c44b039fc609e09993` passed:

| Control | Observation |
| --- | --- |
| Owned allocated bytes | A fixed 8,192-byte observation is reported exactly; normalization precedes the measurement |
| Mode-000 directory and file | Green and red disposal complete; red diagnostics name both permission skips |
| Real unit exits with a mode-000 directory | Green, red, SIGTERM, SIGKILL and interrupted-copy recovery all remove the authenticated temporary |
| Referenced artifacts at the file cap | A logged blockers root survives ahead of 4,096 unreferenced files; its manifest mapping resolves the retained stderr, including a root with spaces and a log chunk boundary |
| Late holder | A unit appearing during byte measurement refuses deletion |
| Nested red runner | Its temporary is absent, its diagnostics manifest exists, and its enclosing lifetime's sentinel survives cleanup and a neighbour's prune |
| Owed selection | Record writers still owe only their own tests; all 124 owed controls pass |

The focused suite passed all 342 tests across ten files, together with strict
typing and the host-observation audit. Raw output is
`~/.cache/nts-scratch/841/b/review-proof-v3.log`, SHA-256
`8f2837dfd3e2d5ca32e53e8fd77fcf54b77ff0bae7361579b771646895b7ded2`.
The inner route passed formatting, Clippy, build and all backend tests (583
seconds for the tests). Raw output is
`~/.cache/nts-scratch/841/b/review-inner-v1.log`, SHA-256
`7a1dc52a5c25c3b761d181780c1bef5dcc02e9074d2d421dd8878e7312ceddfd`.

The delegated affinity scope's missing creator binding remains a separate
defect, #994. The workflow distinguishes it from this slice's bound step
hierarchy and preserves the backstop's live-holder refusal on that path.

The nested control also constructs two enclosing fixture levels, so it checks
the existing outermost-owner contract even outside a gate. Under an inherited
canonical context that owner may be the enclosing gate; the assertion compares
its exact registered path and preserves both fixture sentinels. All 13 scoped
runner tests passed after this correction at
`c73379d3e1898bf711175d3680526b08bf662e1a`. Raw output is
`~/.cache/nts-scratch/841/b/review-nesting-v1.log`, SHA-256
`f590ac96a890926ef9855cba443124813611292049aa97f1f11318eaae022108`.

The `71158a02820c146bfa75bd1e798ff7edb1fb266e` local proof completed
in 557 seconds. Tests and doctests refused the unchanged 40 GiB disk floor.
Tooling exposed two more fixtures with missing observation handoffs: pinned
setup had stripped every `NTS_*` field, and record application supplied only
the host environment. The former observed a disappearing ambient process
(`#996`); the latter saw a sibling ranks unit through the live argument
parser (`#990`). The nested control passed inside this real enclosing gate.
Cleanup completed, removed 390,569,984 allocated bytes and left no temporary;
red diagnostics hit the logged 64 MiB cap.

Raw controls are retained in issue scratch:

| Raw output | SHA-256 |
| --- | --- |
| `~/.cache/nts-scratch/841/b/review-here-v3-summary.json` | `e2cac0b9af93cdc14cb9a643f5cee235511221d3283480bd8adfeb941e81e3ec` |
| `~/.cache/nts-scratch/841/b/review-here-v3-tooling.raw.log` | `87304cddc36e9751ce173f86b6b79543fc3cfd8ac9583d29a25606c4439a7cb9` |

Pinned setup now receives its ownMemory packet through a canonical owned
handoff. Record application forwards an optional owned packet through the
existing candidate-command owner, and its fixture supplies ownMemory. The
census setup-only fixture uses the same owned gateFixtureMemory handoff as its
real-runner controls. Each asserts the descriptor observed by the candidate.
The host audit passed despite all six missing fixture handoffs; enforcing that
boundary is a separate task, outside this slice.

The handoff proof passed strict types, host audit, record application, census
setup and all 124 owed controls. It caught the canonical pinned-fixture
launcher dropping its private Git author fields before fixture commits; those
fields and private Git configuration now travel as owned values too. All eight
pinned controls then passed, including the exact observation-descriptor checks.
Raw outputs are `~/.cache/nts-scratch/841/b/review-handoffs-v1.log`, SHA-256
`df821f7664cc33353fd1b9f0cb67927dfc771aa4b7b588aad46b68c078fe229f`
(137 passed, four Git-identity failures), and
`~/.cache/nts-scratch/841/b/review-pinned-v2.log`, SHA-256
`d690f88e6669e79fbccbf3b9b7a296b0bfa51dc959cc767ce2b688cbe6b8e8ca`
(eight passed).

The next local proof, `5d2e3859763a1a4f75e70d640d1b8c1d2addc52d`, passed
every step except tooling in 1,048 seconds. All six repaired candidate handoffs
passed inside the gate. A startup-priority control hit its existing 120-second
unit bound; its assertion then hid the captured output by reading a missing
step log. That diagnostic now preserves the output even without the log. The
bound is unchanged. Cleanup completed and removed 511,791,104 allocated bytes,
leaving no temporary and retaining capped red diagnostics.

The coordinator requested three isolated measurements per revision before any
bound change. Each ran in its own named, admitted unit. Command wall time
starts after admission and includes the single selected test's setup. Main's
source was read-only from a clean free pool tree; both sources' HEADs remained
unchanged throughout every sample. Runs alternated, with round two reversed.

| Revision | Run 1 wall, s | Run 2 wall, s | Run 3 wall, s | Result |
| --- | ---: | ---: | ---: | --- |
| Main `e6162a71245e04e1381d57b9a8f3443b1234fd1c` | 16.868 | 13.571 | 10.507 | All pass |
| Slice (b) `8bc23683e3e01bac8c4a968631f25e23e77487c1` | 11.677 | 10.217 | 9.947 | All pass |

Every sampled gate child used its fixture's private observation descriptor and
ledger. All six traces captured both the dependency capture and synthetic
priority control waiting in that private ledger. The parent pressure request
also supplies that packet explicitly; the run's reservation and priority
reading retain its private ledger directory. No real-queue leak was found in
these paths, and these samples show no isolated slowdown. The coordinator
filed the enclosing-run delay separately under #694; this slice keeps the
120-second guard.

Raw results, outputs, ledger traces and their per-file hashes are in
`~/.cache/nts-scratch/841/b/startup-comparison-live/summary.json`, SHA-256
`295f26302db473484870bb709cb32950b291a820e2cf1d2736ab0225155d870e`.
The full proof's copied controls are
`~/.cache/nts-scratch/841/b/review-here-v4-summary.json`, SHA-256
`b135b0a1543b3fd8130181f6d288b5d46d2dc581a03aeab3d28f4d666bfcfc05`,
and `~/.cache/nts-scratch/841/b/review-here-v4-tooling.raw.log`, SHA-256
`01cba1814662eb15f1519651fbe72761c3bf8baca1960775d0cada2a46da4a28`.

Landing replay refused the original slice because both it and main inserted a
decision at the same workflow heading. The rebase onto
`5c00b70387d030955fda8352997ae863c9bb0ae6` preserves both the pending
whole-program rule and the temporary-lifetime rule. The range comparison keeps
all later slice patches unchanged; the scoped-runner fixture also retains
main's shared process-stat reader.

The rebased tree passed all 359 focused tests across thirteen files, strict
tooling types and the host audit. Raw output is
`~/.cache/nts-scratch/841/b/rebase-proof-v1.log`, SHA-256
`1179f05ecf1f302976f78b15a34942d82a3ac090b3d4c287609f71bdcbc37112`.
Inner passed formatting, Clippy, build and backend tests (476 seconds for the
tests). Raw output is `~/.cache/nts-scratch/841/b/rebase-inner-v1.log`, SHA-256
`1095d0dea70799a57470fe4594451af067f0c28fac659e1884085591886b3a57`.

Review found that flushing each retained file separately made red disposal
pay thousands of journal commits. The copy now closes every payload descriptor
and makes one `sync -f -- <stage>` infrastructure probe before flushing the
manifest and receipt. Publication still flushes both parent directories after
the rename. A failed filesystem barrier leaves the original temporary and an
unregistered disposable stage; retry publishes a fresh, complete copy.

The same 4,096-file referenced-artifact control ran once before and once after
in separate named, admitted units, on CPUs 16–31. Both revisions were committed
and verified before measurement. These are the selected test's wall times,
including fixture creation and cleanup, excluding admission wait.

| Revision | Selected test wall, s | Result |
| --- | ---: | --- |
| Before `362bb46a03899e7873fded4b7fd94d0868d26332` | 35.998406 | Pass; referenced artifact resolves ahead of scratch at the cap |
| After `d88d653857346ecbed2a4de37055f0a4aebbd750` | 0.781179 | Same control passes |

This paired sample reduces the control's time by about 46 times. Raw output is
`~/.cache/nts-scratch/841/b/stage-sync-before.log`, SHA-256
`e785cb966506d5d4c31fefd0241151bb8d9598d9babd13763a7b52a6e750fc1a`,
and `~/.cache/nts-scratch/841/b/stage-sync-after.log`, SHA-256
`59071ec84293d9283a1f5c3c7d9b40b82223f56871d2c33577cd3f0e23dd81f2`.

All 361 focused tests across thirteen files passed, along with strict tooling
types and the host audit. New controls verify that the single barrier sees
complete copied payloads before either manifest or receipt publication, and
that a failed barrier preserves the original and allows a complete retry.
The mode-000, referenced-path, interruption, holder, identity and real-unit
exit controls remain green. Raw output is
`~/.cache/nts-scratch/841/b/stage-sync-proof-v1.log`, SHA-256
`fb46aea33093aa942b3158b6ea7626e4bbb7aecab02afe8ceca11b6a0d29e27e`.
Inner passed formatting, Clippy, build and backend tests (430 seconds for the
tests). Raw output is `~/.cache/nts-scratch/841/b/stage-sync-inner-v1.log`, SHA-256
`51c87604c8c0f261d955f153c3ce8e106e645ece37a4610d6486ce6b6b6858c1`.

The queued landing exposed a launch boundary that the same-version local check
did not cover: main's pre-lifetime launcher had prepared the run's `tmp`
without a creation record. The candidate refused it before starting any step.
The refused run's output is copied to
`~/.cache/nts-scratch/841/b/adoption-refused-queued.log`, SHA-256
`14436f2fa9d2f91b2ce98a39c68e40328a3f851f42dddb0383c1bb4077a4f71b`.

The runner now explicitly adopts that prepared root before arming its normal
lifetime. It validates the expected path directly under this run, the owned
physical root and parent, and an empty population except for the owned, empty
canonical `oracle-resolution` directory. It logs adoption and forwards the
new token and parent identity in the canonical context; children borrow that
lifetime. Unknown contents, occupied setup, aliases, changed roots and a
different run path refuse adoption. Other callers still require creation
authority; historical roots receive no new discovery or deletion grant.

A separate named, admitted control copied main's actual `captureRunTemporary`
and candidate launcher through `copyModuleClosure`. Their bytes were checked
against the recorded main commit, which also stayed unchanged during copying.
The old preparer made the root, and the old launcher invoked the candidate's
real runner. The candidate logged adoption, passed its step, forwarded its
token, closed its receipt and removed that same device/inode.

| Preparer and launcher | Candidate implementation | Outcome |
| --- | --- | --- |
| Main `5c00b70387d030955fda8352997ae863c9bb0ae6` | `2f66cf6e0899ec8f1258181290c5d7ef634037e5` | PASS; exact prepared temporary absent and lifetime closed |

The procedure is `~/.cache/nts-scratch/841/b/old-service-control.mjs`, SHA-256
`be5bc234c86dd93edb0e8e332776e3696a4d7cf3ab94f17556766732f02675be`.
Raw output is `~/.cache/nts-scratch/841/b/adoption-old-service-v2.log`, SHA-256
`1de12d78e84444705f2683d86b72bf549fc7ba1ab639be61e297dcaed06fb28b`.
The structured result is
`~/.cache/nts-scratch/841/b/old-service-control-1795478647770/result.json`, SHA-256
`4f16c740b0c35f7191b4109218e85dec63c05fa44069333a97d921920ad46c2f`.

All 364 focused tests across thirteen files passed, along with strict tooling
types and the host audit. This includes the prepared-root real-unit control,
acceptance and refusal controls, the unchanged historical-root refusal, and
the existing identity, holder, diagnostics and forced-stop controls. Raw
output is `~/.cache/nts-scratch/841/b/adoption-proof-v2.log`, SHA-256
`e00bf66b0ff5790bcb16e320a39e1cb3a35fb0da8dbe07ba3c0a0e464d41ad4d`.
Inner passed formatting, Clippy, build and backend tests (907 seconds for the
tests, after a 328-second oracle-capture admission wait). Raw output is
`~/.cache/nts-scratch/841/b/adoption-inner-v1.log`, SHA-256
`ab18412a90c273e2de66a0af60ab72e90ddb27f5e8c46c469806af4c856980da`.

The subsequent local check completed in 2,246 seconds with two red steps.
The prepared-root fixture had inherited its enclosing gate context, contradicting
its assertion of the old service's independent launcher shape. The fixture now
always creates a nested harness, then passes only host tools and explicit owned
cache and memory packets to its independent launcher. Its exact legacy-shape
assertion remains. This exercises the same boundary in focused and full runs.

The records step also encountered accepted-main memory-census rows advancing
while the check ran. The branch was rebased onto the records update
`dc669ade6118337d888403188e4956bf095044b8`; no observations were deleted or
rewritten by this task. The red run's cleanup completed, removed 512,774,144
allocated bytes, left no temporary, and logged its 64 MiB diagnostic cap.

| Copied control | SHA-256 |
| --- | --- |
| `~/.cache/nts-scratch/841/b/adoption-here-v1-summary.json` | `db16f9143a6f95823fcd196ffb62da9a119673367f3b0261504e7c9ed52e3f86` |
| `~/.cache/nts-scratch/841/b/adoption-here-v1-tooling.raw.log` | `c2ec0a0fed33bcdaf55a6db7769e4f925c9c81f69401c8d81bdfff5b96bf5e96` |
| `~/.cache/nts-scratch/841/b/adoption-here-v1-records.log` | `b4e8089de45af911f07102ddaf767e2843f947b4deb273d7bd15b27b3c863834` |

After that rebase, all 364 focused tests passed, including the legacy-launcher
control under its mandatory nested harness. Strict tooling types, the host audit
and all 369 records also passed. Raw output is
`~/.cache/nts-scratch/841/b/adoption-rebased-proof-v1.log`, SHA-256
`2c6497222ad4792581567730dadf6b1274499505999d32c28fac29c4b1e69bbf`.

The separate old-service control was repeated against main
`dc669ade6118337d888403188e4956bf095044b8` and candidate
`59a99ee41616ad88c440d88697295a39053f9486`. It passed: the original prepared
device/inode was adopted, the step ran, its token reached the child, the receipt
closed, the temporary was absent and its backstop was inactive. Raw output is
`~/.cache/nts-scratch/841/b/adoption-rebased-old-service-v1.log`, SHA-256
`684f0d6ddb2c39dbe3fe570c199114fa83c08520920331fc6f36ce4093033f44`.
The structured result is
`~/.cache/nts-scratch/841/b/old-service-control-1795486461264/result.json`, SHA-256
`149fcc39f8a5b0b8d381870dfeee58d9cf55b747768f1c8e414103dad5ff932f`.

Fresh inner proof on that rebased implementation passed formatting, Clippy,
the compiler build and all backend tests. Tests took 656 seconds; the reported
Clippy and build phases include their admission waits. Raw output is
`~/.cache/nts-scratch/841/b/adoption-rebased-inner-v1.log`, SHA-256
`227ac098060b0c9b02b3ed22f04401de4a11f1986d036c5a7479283c5dd76490`.

Review of `a2e631418996fed7dee6ae38c89acaa6cc3321df` raised a possible
cross-version boundary: the verified controller's `pinnedGate` runs setup,
compiler preparation and `all.sh` before entering the candidate runner. The
earlier direct-launch control did not exercise those producers. A prepared
root containing harmless scratch would fail the reviewed content allowlist.
The later v11 control showed that this controller route does not hand that
prepared root to the adoption path: old setup disposes its temporary and the
candidate launcher creates a fresh lifetime. The landing service's direct
runner handoff is the demonstrated adopting route.

The coordinator ruled that adoption takes the whole directory by identity.
Its root must be the gate uid's physical `tmp` directly under this run, its
parent must be the run, and no lifetime receipt may exist. Contents no longer
decide adoption. Close retains the existing holder and unit checks, identity
rechecks and bounded diagnostic publication. Refusal controls now map each
root alias, foreign uid identity, wrong parent, wrong run, replaced inode or
existing receipt to an exact asserted diagnostic and preserve the refused path.

The adoption shim retires once the landing service uses the #841
lifetime-owning launcher and no active pre-lifetime landing service can hand
the direct runner a prepared root. The measured verified-controller route is
outside this condition because it creates a fresh candidate lifetime.
Follow-up [#1009](https://github.com/akisArou/nts/issues/1009) was created through
`tooling/tasks/new.ts` under #545 and remains held until the landing-service
condition is proved.

The first proof of identity-based adoption passed strict types, the host audit,
all 369 records and 363 of 364 focused tests. The expanded runner fixture had
created its populated `oracle-resolution` with mode 0755; the existing resolver
guard requires 0700 and refused it before adoption. Only the fixture mode was
corrected. All 26 lifetime controls then passed, including populated scratch,
the outside link sentinel, exact refusal messages and real-unit termination.
The initial proof is `~/.cache/nts-scratch/841/b/identity-adoption-proof-v1.log`,
SHA-256 `614ee8e1aaffd4e6c51e5ac234677b7ea25c57d2e614795b5be55e68b82f568d`.
The corrected-file proof is
`~/.cache/nts-scratch/841/b/identity-adoption-lifetime-v2.log`, SHA-256
`2a8e1003e586d93784505fb4b7e9dbecaf2ab36e26d4b0ee8c0e86ab47913da2`.

The identity-adoption inner proof passed formatting, Clippy, the fresh compiler
build and backend tests (717 seconds for tests). Raw output is
`~/.cache/nts-scratch/841/b/identity-adoption-inner-v1.log`, SHA-256
`b06761e1ea42484ac38b1f009980ce7b6b16471c4f71410e27d6613bc22c0f2b`.
The independent old-service queued-path control also passed against controller
`2017bf23a3de7f0d28da263d6403b519735517cd` and candidate
`aae372728f315321109a5afa23fb9d5ec4eb6e21`: its prepared temporary was adopted,
the step passed, and the original temporary was removed after green. Result:
`~/.cache/nts-scratch/841/b/old-service-control-1795497717788/result.json`, SHA-256
`8dd457de81840ab577004abc9e48c1b50190b134a4c3e087d2aa5843c7b463fd`.

The power cut interrupted `nts-841-identity-adoption-verified-controller-v7`
while it still waited for admission. It is **not measured**: its log has no
`CONTROL INPUT`, and no new control home, run or temporary was created.
No backstop cleanup is credited to that interruption. The read-only resume
audit found no Git index lock, pin build lock, pin tree lock or gate root
receipt. The task tree's persistent empty flock inodes had no kernel holders;
they were preserved. The pin tree's untracked TypeScript source was preserved.
Audit: `~/.cache/nts-scratch/841/b/power-cut-resume-audit.json`, SHA-256
`777581bf9ac785de8062f968725dbb7ebe0df35751d68681dd1f8b76a50abb10`.

The named, admitted v8 control used Node 26.13.0 and the canonical host
environment with the JDK, Android SDK and debuginfod URL. Its disk preflight
refused before compiler preparation: 47,629,881,344 free bytes, a
42,949,672,960-byte floor, and existing promises left -2,835,984,384 available
bytes against 4,682,612,736 bytes of compiler working headroom. This measured
capacity refusal is not a gate verdict. Only this task tree's authorized
30,224,384-byte incremental output was reclaimed; shared state was not deleted.
Raw output: `~/.cache/nts-scratch/841/b/identity-adoption-verified-controller-v8.log`,
SHA-256 `9be62e0d416fbaaf834d3197e1cdbf7cd422ffc3932c8733d3d82e5a939f1f8c`.

After the pool's authorized upkeep, v9 still refused before preparation:
53,363,941,376 free bytes and 2,898,075,648 available after the floor and live
promises, against the same 4,682,612,736-byte working headroom. Raw output is
`~/.cache/nts-scratch/841/b/identity-adoption-verified-controller-v9.log`, SHA-256
`fceafbbc0ba9cfa53da32d1ffaa35eef10209af2b45679c2c036038d7f7f46b8`.

The exact-commit local check at
`9823ec5b07f7f99f33d2887884b36ee5481d3213` passed all 360 tooling entries and
every selected step except records. The unchanged branch selector row differed
from a newer accepted-main refresh. The launch line said
`9823ec5b07f7, replayed onto main 10fe03ef3a99 when it lands`, while the local
check ran the branch tree and compared its older row with accepted main.
The coordinator filed this boundary as [#1018](https://github.com/akisArou/nts/issues/1018).
The branch was then rebased onto main without conflicts and its installation
catalog republished. No selector observations were deleted or rewritten here.

That red run completed scope cleanup and removed 512,823,296 allocated temporary
bytes. Its original `tmp/` is absent. Diagnostic publication retained 688 files
within the 64 MiB cap and logged the cap. Copied evidence remains in issue scratch:

| Path under `~/.cache/nts-scratch/841/b/` | SHA-256 |
| --- | --- |
| `identity-adoption-here-v2-summary.json` | `27f35ff5acbf8cdbcdece15b568c0615eafdf26d7b4e24ecb2463bbb1f3d4be6` |
| `identity-adoption-here-v2-records.log` | `636b880419b440edcf0e9a9be0e45df7f69701140c86ad1e7d7cd9af69f1c532` |
| `identity-adoption-here-v2-temporary.log` | `cc97d63d77cb1555c34cc7709c1f1bc001d87190b93c14497d920761d0913bb9` |
| `identity-adoption-here-v2-tooling-tests.raw.log` | `b133bb4a44b412c1ec2c3d84d7715eb4c13f102b58fb60f53d5ca73b4f4bb7a4` |

V10 again refused before preparation: 44,557,570,048 free bytes and
534,155,264 available against 4,682,612,736 bytes of working headroom. The
control's repeated source staging consumed space before its preflight. Its log
is `~/.cache/nts-scratch/841/b/identity-adoption-verified-controller-v10.log`,
SHA-256 `94bf839d987f87c1605a781017851c102f188a858645ac2eb2f2edc8ebf54a60`.

The coordinator authorized removing this task's regenerable failed-preflight
staging and reusing v10's inputs. Only `source/`, `controller/`,
`candidate-input/` and `controller.tar` where present in the following scratch
folders were removed. Actual run directories, logs, hashes and results stayed.
The manifest lists each individual removed path and allocated size; these are
staging footprints, not a claim of equal filesystem free-space gain.

| Folder under `~/.cache/nts-scratch/841/b/` | Removed allocated bytes |
| --- | ---: |
| `verified-controller-control-1795494509312` | 1,364,172,800 |
| `verified-controller-control-1795494844692` | 1,516,494,848 |
| `verified-controller-control-1795494978579` | 2,220,359,680 |
| `verified-controller-control-1795497347536` | 3,081,039,872 |
| `verified-controller-control-1795554434758` | 3,081,011,200 |
| `verified-controller-control-1795554599763` | 3,080,974,336 |

Manifest: `~/.cache/nts-scratch/841/b/removed-preflight-staging.json`, SHA-256
`5ca8a673ea2900debd3879b9b0de9190b74380722363f3a3f72d39434bff9d78`.

V11 reused v10's staging in `verified-controller-control-1795556520470`.
Before reuse it checked all tracked bytes against the original Git commits,
and separately checked and hashed the controller entry modules and candidate
runner, shell driver, build owner and temporary owner. Its preflight had
12,758,585,344 available bytes above the standing floor. The unchanged old
controller at `2017bf23a3de7f0d28da263d6403b519735517cd` then ran the real
`pinnedGate`, setup, release `prepare_compiler` and `all.sh` route at candidate
`e68e5c81cf64262b14377b3a524cfe22a8b80f73` through the warm pin owner.

**V11 observed no adoption.** Neither `temporary.log` nor the control or full
log contains `adopted pre-lifetime launcher temporary`. The full log's first
`gate tmp: removed after green` line precedes compiler preparation: old setup
disposed its temporary. The candidate launcher then created a fresh lifetime,
whose single receipt has its own creation token and the measurement scope as
creator. Its temporary log contains only the zero-byte removal pair. This
control proves fresh-lifetime disposal on that route; it does not prove a
verified controller handing prepared scratch to `run.mjs` for adoption.

The runner was green and `rustfmt` passed. `prepare.cpu` exists, the lifetime
receipt is closed, its backstop is inactive, `scope_cleanup` is complete,
`temporary.state` is `removed after green`, and the exact `tmp/` is absent.
The controller wrapper correctly returned **held** with
`the run was not in the canonical environment`. Explicit fixture observations
and caches make this a recorded experiment, never canonical landing evidence.
The scratch harness's original green-wrapper assertion was wrong and failed
before its adoption assertion could run. The separate read-only verification
omitted that adoption assertion. It asserted the held verdict and exact reason,
the exact experiment-variable population, and the fresh-lifetime facts above.
The result retains those variable names and receipt identities. It is not
adoption evidence. No product handoff fix was made for this expected
classification. A later read-only review records the absent adoption markers,
the setup removal before preparation and the fresh receipt in
`~/.cache/nts-scratch/841/b/v11-adoption-review.json`. SHA-256
`ae96d87d2b1783aa35289a882e3894c944cd59f02bd64ecbe96c153e67d0421e`.

| Path under `~/.cache/nts-scratch/841/b/` | SHA-256 |
| --- | --- |
| `verified-controller-reuse.mjs` | `db9e3facfb2aec49d8ae85796eb4bacefc4ccb4b5c1c6fa2b453e84e0513cffc` |
| `verified-controller-control-1795556520470/v11-staging-reuse.json` | `088a3ab6a07d2fe3cd816b6c48487ef61e8e24de85fb7dc230e80b43fa756783` |
| `identity-adoption-verified-controller-v11.log` | `0168e85f41053e620e1139f447b68cfa6bf0268590e1877f42c823aabe772bc1` |
| `verified-controller-control-1795556520470/v11-lifetime-result.json` | `f7e1afede43c2524591da513b5b5679016baec8047a7aec62a42b1ff98b3f93e` |

Review corrected the v11 route attribution and narrowed #1009's retirement
condition to the landing-service direct runner handoff. The workflow and code
comment state that condition; an appended decisions-log correction preserves
the earlier entry. Implementation behavior is unchanged. The repeated focused
proof passed all 26 lifetime controls, with no failures, cancellations or
skips. Raw output is `~/.cache/nts-scratch/841/b/review-correction-lifetime-v1.log`,
SHA-256 `e6141abaf2a6e8563ed256a73c2c83de70cef2e9900806e333d356a288f0270d`.
The branch then rebased without conflicts onto the accepted-main record refresh
`f12c78199d6d` and republished its installation catalog before the final local
check. No observations were deleted or rewritten by this correction.

## Target inventory slice (c)

`keep.json` now declares the cargo targets inside its rules' folders, each
with the tree whose builds write it: the landing check's `target` and
`tree/target`, the full check's `target`, `tree/target`, `bench/target` and
both records trees' targets, `nts-pins/target` and `nts-gate/target`. The pool
kind declares every slot's `target/`. `targetProfiles` in
`tooling/gate/disk-reclamation.ts` is the one obsolete-profile rule:
reclamation's candidate collection now calls it, and the hourly count judges
every declared target with it, each against its own tree's build generation.
Nothing is deleted by this slice.

The live inventory found that top-level `debug` still has a writer. The
copies in six attached task trees and in both service trees' `tree/target`
(113–140 MB each, the newest written on the day of the slice) hold only the
default-profile build of `nts-test262-protocol`. They are built by the
`cargo run` fallback the census tools and `all.sh` take when
`NTS_TEST262_PROTOCOL` is unset; the gate sets it. #1027 moves that command
into `nts-dev`; until then the rule's reason names the fallback. By the
coordinator's decision, an obsolete profile in a target whose tree is on a
task's branch is a notice, since only its worker can act on it and
reclamation never offers it; free pool slots, services and pins stay red.

| Live result | Count |
| --- | ---: |
| Declared targets | 22 |
| Absent (unbuilt pool slots), skipped | 3 |
| Red obsolete profiles (both service `tree/target/debug`) | 2 |
| Notices (attached task trees' `target/debug`) | 6 |
| Protected current markers | 18 |
| Protected without a marker (`records/core` nts-dev, `nts-gate` clippy) | 2 |

| Path under `~/.cache/nts-scratch/841/` | SHA-256 |
| --- | --- |
| `c-live-inventory.log` (every declared target and each profile's state and reason) | `5093e862c50b4495d2eb33d71c18c6aa19f4152efa95248e1b0b9af5fd9f3c54` |
| `c-live-count.log` (the count's full read-only output on the change) | `93b2a1651ec31c60f173a9546bada27529a9ce1d836fce916ac64a8dd3f5f244` |


## Enabled deletion policies slice (d)

The hourly raw-cost owner retains the newest three completed runs per declared
run root, and every red, held, unfinished or unknown run. It removes only an
older green run's `costs/`, after a known materialized cost summary with zero
reader errors and the normal physical/terminal/process/unit guards. The
collector mutex sits beside the run root, outside ordinary log-age pruning.
A durable device/inode/uid and summary-digest receipt resumes an interrupted
detachment. Inventory retains compact facts and digests, rather than parsed
case populations; final guards re-read and hash the terminal records.

The cost writer sets `partial` for exactly
`errors.length || missingChecks || checks.some(c => !c.complete)`. Missing
checks have no raw observation to recover, and incomplete checks retain their
ended phases in the summary. A known `partial` with `error_count: 0` and no
errors is therefore prunable; any reader/parse error retains raw evidence.
The owner approved this reading of the writer.

Every non-pool target declared by `keep.json` now feeds the existing obsolete
profile reclaimer, using its own tree's build generation. Pin targets also
take `pin.ts`'s existing writer mutex with zero wait, outside the pool
transaction. A held pin is a named keep. Pressure retains one compatible warm
free tree; ordinary idle upkeep retains two, per owner decision
`disk-warm-trees-20261125`. Compiler scratch and both dispatched and standalone
interop use declared roots `target/test-scratch` and `target/interop`. Only
clean free pool trees offer those roots. A bounded `legacy-scratch` migration
handles the explicit former compiler namespaces and `interop-*`; retire this
kind once no pool tree carries that layout and no legacy trash remains. Unknown siblings, held/service
scratch, active claims and live users remain protected. Source drift controls
cover compiler constructors and interop writer/reader defaults.

### Real core retention

The production owner was restricted to
`~/.cache/nts-full-check/runs/core-c7a228948f6f-20261125T001734Z`. The run was
completed green and older than the newest three completed runs in its root.
The run producer was `c7a228948f6f6cc0d0d52c14b7e1dc67577f781c`; the
collector implementation was `720f69081797caccf302aa4d6a0c1c577d734c63`.
The final lifecycle-digest strengthening is checked separately below.
No raw costs were copied. The before summary and log hashes, raw byte/inode
inventory and all observed run states were saved before removal.

| Phase | costs content bytes | costs allocated bytes | Raw files | Raw inodes | summary.json bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before retention | 552,704,866 | 704,290,816 | 66,196 | 66,197 | 214,314,722 |
| After retention | 0 | 0 | 0 | 0 | 214,314,722 |

The summary and logs are byte-identical. The summary's SHA-256, also that of
`~/.cache/nts-scratch/841/d/real-core-summary-before.json`, is
`9be2f6473a6d4b065e4180a51f41c17d6f9c81c3309cbc105a5c7b51b975a509`.
All 124 other observed runs' cost-directory identities and presence were
preserved, including the newest completed runs and every red, held or
unfinished run. The before/after snapshots list them individually. Allocated
bytes removed are not a claim about concurrent filesystem free-space change.

The summary's own size remains a footprint cost. Slices (e) and (f) include
`summary.json.case_costs` beside compressed raw streams in their measurement;
compression or slimming of that population is outside slice (d).

### Coverage retained by partial summaries

| Green core | Reader errors | Missing program checks | Incomplete checks |
| --- | ---: | ---: | ---: |
| 08e864d2bef3, 20261125T082738Z | 0 | 0 | 90 |
| 36edc25876c9, 20261125T022120Z | 0 | 0 | 90 |
| c7a228948f6f, 20261125T001734Z | 0 | 0 | 90 |
| f12c78199d6d, 20261124T224237Z | 0 | 0 | 90 |

Each has thirty incomplete checks in each TypeScript backend. The coordinator
filed this separate telemetry gap as #1034. Per-step coverage is retained in
the raw artifact below; this slice does not change telemetry collection.

### Controls and raw evidence

The focused suite passed 398 tests with no failures, cancellations or skips.
After matching normal completion to the writer's actual `interrupted: null`,
all 26 cost-retention controls passed again. Strict types passed all six
projects and 1,234 checked modules, with no diagnostic increase. The initial
host audit passed; the final landing check covers the completed source.

| Path under `~/.cache/nts-scratch/841/d/` | SHA-256 |
| --- | --- |
| `focused-v5.log` | `ddccc6347a03dc6785630954e0186e3e9e6e7e37f4ee11bf03398459bcdb382e` |
| `cost-focused-v6.log` | `6e514199ab0f3705a7481816d6d81d1848d03cd29b88ac4f6db264ece8e0022f` |
| `types-v4.log` | `0dafde3feb67e630b378dfd0c62cbdf9799c5f66f682b932c6cfafa5921db4aa` |
| `real-core-retention.mjs` | `ddc3332691044e1d8ea900f30a10e230a6d2dedcc3f4236830a893562f252e30` |
| `real-core-retention.log` | `bc1546ba4f2451c49cfb12bf8b49b1752062295f6621a2ca9768479dec15419f` |
| `real-core-before.json` | `2b25b6723bf615ef6248182b98ac80dd7b58e5f46fb02da936e9835bfdc24d89` |
| `real-core-after.json` | `1decfa8989a36257c3dda57871a6232fecc24dc2d7b9e7e939863c2a211fb960` |
| `real-core-retention-result.json` | `82701eaa9e54114bdae3645911493e30cb9e88b0b366c240d6a3732d5eae3d79` |
| `recent-core-coverage.json` | `608270cd7a8edafacd3d6ebf6e283f7a9761f01ee19c9a7dae450da384221019` |


Inner passed formatting, Clippy, the fresh compiler build and every selected
crate plus the backend/frontend tests. The test phase took 697 seconds; the
Clippy log includes its admission wait. The final post-inner focused cost and
count run passed 73 controls, including a changed but still closed lifecycle
and a changed measurement-state receipt. Summary, lifecycle and measurement
record digests are all rechecked at the final removal guard. The saved real
run's lifecycle was identical before and after removal (version 1, 58 events,
no running steps); its measurement was closed and unheld. That independent
fact check is retained below. No second shared deletion was performed.

### Compiled test inventory

All 2,063 identities in the initial warm binaries remain at exactly their
previous multiplicity in the fresh inner binaries. The fresh inventory has
2,121 identities across 27 binaries, with no losses or changed old
multiplicities. Its 58 additions each have a matching declaration already in
accepted base `ecbcd1e70866e3551925e72f5bd6ef69e295b222`. This is preservation
with accepted-base additions: the warm binaries were not a same-revision
baseline, so exact whole-inventory equality is not claimed. No Rust harness
or test declaration was added by this task.

Four of the accepted-base additions are in files whose scratch constructors
this task changed:

| Test path | Added accepted-base identity |
| --- | --- |
| `compiler/codegen/c/tests/published_consuming.rs` | `conditional_and_aliased_null_field_controls_do_not_leak_under_poison` |
| `compiler/codegen/c/tests/published_consuming.rs` | `current_phi_identities_meet_their_minima_under_poison_and_collection` |
| `compiler/codegen/c/tests/published_consuming.rs` | `open_towers_keeps_the_old_field_release_for_unknown_published_callers` |
| `compiler/codegen/llvm/tests/typed_release.rs` | `typed_releases_follow_the_proved_layout_graph` |

Every addition is listed by test path in the TSV below. The audit retains
its accepted-base declaration evidence. The initial exact-comparison failure
is preserved in `inventory-after.log`; it was not treated as exact equality.

| Path under `~/.cache/nts-scratch/841/d/` | SHA-256 |
| --- | --- |
| `inner-v2.log` | `937e7c3c63474d8cf59b443cd2885f3c62e7d0fbd8d9934ea9058deb2bb166c7` |
| `focused-final.log` | `da131821a163953629247b08eca2fe5f7676a9be4784cecef2c4430bb213f597` |
| `types-final.log` | `6177c3bda8677a93aa2dc4a1a889023432c3570de87be0ba9476d1fc26db707a` |
| `host-audit-final.log` | `9b8abefc2d374d67577efb4af5a2b6e3cdb6859f1a26e45ebf22582f7b93d103` |
| `terminal-facts-confirmation.json` | `e2d59e9d8d1034de293273821e68a5ce4cf8c4863c58c962034623ae869501d9` |
| `test-inventory-before.json` | `d685fd9aabf63aad6d24f47a1e9a04d4f07f91a1f98f6dbd0241535b44314b1a` |
| `test-inventory-after.json` | `912a38dc85e1f6e6fa5d4ef8d42bb56c1147b483fe896bc05bd83e18a09d6a2b` |
| `inventory-after.log` | `9ff682070f8b20f094a4d5e96cbed9a5dc941a4101fa0168b72594e19645cfb1` |
| `inventory-preservation-audit.py` | `ff37c70c3143bc60b1b11a756dc762a6f1f51175959fbe2ecf68902bda84ad58` |
| `inventory-preservation-audit.json` | `c292f73b70a85152c743238d5dfaf2cfff42f7a5efc2b28708c3c678d66518dc` |
| `inventory-base-additions.tsv` | `96ea3d5747a581a568a747607494b9da9e28207897c062de524df7d7f1dee4de` |

### Standalone interop proof

The `native-compression` standalone `build.sh` and direct `verify.ts` both
used `target/interop/native-compression`; the explicit output argument also
built and verified in issue scratch. Each arm ran 454 checks: 451 passed,
zero failed, and three declared skips. The compiler was the fresh inner
`nts-dev` build. No scenario logic changed.

| Path under `~/.cache/nts-scratch/841/d/` | SHA-256 |
| --- | --- |
| `interop-proof.sh` | `66962ef0246076b9977d5bafc604603c629224d14f88e8d2cb94447f31180ef3` |
| `interop-proof.log` | `434fe6aa0596207215647381b82104ea23262c12197c347ebb8dfe18a5363a50` |
| `interop-default-build.log` | `ca67522da49625de6cc4b94851c9ded3490877729da4d863745f1ff9276286ff` |
| `interop-default-reader.log` | `2948396c4589155c2dac60daeec48636c7cbacb7b958567b5695d273fe011909` |
| `interop-explicit.log` | `30b77b4e9c34b40a2bf70a8fa09499a48841bbc0ffbd0ef48c02d27849bf4106` |
| `interop-compiler.sha256` | `0c11e0fe1d78d30bacde9c95096495897ee4dcde9613c750b536697b91617b1f` |
| `interop-result.json` | `e629952179aeca3b44effefad6210a421a616fe476cbe5bed0ee2dd0e2a604eb` |
| `compiler-path-files.txt` | `169e86f51860efce0f114600deb4e1a46fe8a89786cf7cd87b95f20d1800df07` |

### Discovery declaration correction

The first exact-commit `--here` attempt, at
`5fbf9c386684fc624fb7dc5bb13c2bcc59466e2c`, refused during selection before
running any steps. A whole-directory inspection declaration entered an
existing `macos-pods` framework symlink as an owned source file. The guard now
uses the existing `directoryCandidates` owner, as gate environment capability
discovery does: shallow project membership and exact `build.sh`, `verify.ts`
and standalone `bench.sh` candidates. Runtime reads use those same declared
candidate names; no framework payload or broad directory authority is needed.
The reader-input owner and module-closure implementation are unchanged.

The corrected layout suite passed all ten controls. Its new graph control
proves project membership and writer/reader inputs while excluding framework
payloads; the drift fixture exercises both scripts in a newly discovered
project. Strict types again passed six projects and 1,234 modules with no
increase. The host audit passed 2,207 sources, 364 entry closures and 422 reads.
The compiler sources and standalone interop scenario remained unchanged from
the inner and three-arm standalone proof above.

| Path under `~/.cache/nts-scratch/841/d/` | SHA-256 |
| --- | --- |
| `here-v1.log` | `2eb2e2acb80420f3917e3ab79ea95dec30f22b6fdddbba2aecb0687569278880` |
| `discovery-focused.log` | `4709b530e07fd2bcc1eaf4d3c49a752f54258bc2e257a0b6da6cff4dd665cde6` |
| `discovery-types.log` | `0dafde3feb67e630b378dfd0c62cbdf9799c5f66f682b932c6cfafa5921db4aa` |
| `discovery-host-audit-v2.log` | `5d5bde205d5116b9863a2bca791070999e3361cfc09d1b8e08a7992151c3da48` |

### Pin lock owner boundary

The second exact-commit check reached the tooling suite. Its direct lock
import from `pin.ts` unnecessarily entered the entire builder: an emitted
runtime-owner test encountered the builder's legacy strict diagnostics, and
six full-check measurement fixtures collided with their own `link.sh` input.
The named unit was stopped after those observed failures and drained with a
held verdict. Its temporary is absent; its logs and terminal records are
preserved in the source manifest below. This attempt is not green evidence.

The coordinator approved a small shared lock owner. The existing mutex body
and holder-liveness helper now live in typed `pin-lock.ts`; `pin.ts` imports
and re-exports the same API, defaults and diagnostic. The reclaimer and the
`keep.json` lock declaration name that small owner. The held-lock control also
asserts function identity between the writer API and shared owner. Clock reads
use the existing `HostObservations.wallNow` capability: normal production uses
the same wall clock, and reclamation forwards its supplied observation. No
host-audit allowance or second mutex was introduced.

All 194 controls across reclamation, count, oracle-emission ownership and
full-check measurement passed after extraction. A final capability-wiring run
passed all 84 reclamation controls and pin's self-test (take, live-holder
refusal, release after return and throw). Strict types passed six projects and
1,235 modules with no increase, including zero diagnostics in the new module.
The final host audit passed 2,208 sources, 364 entry closures and 418 reads.
The compiler source remains the source proved by inner above.

| Path under `~/.cache/nts-scratch/841/d/` | SHA-256 |
| --- | --- |
| `here-v2.log` | `b488252151ee55561c1db6459b70a5402a6f63dd85429cf9892bfe0724fbc46e` |
| `here-v2-source/manifest.json` | `cfca186dcd3f61f0373db8092ec9dd5d7f5cdab72892a61fc77ca174cad6f838` |
| `pin-owner-focused-v2.log` | `b2f12217b34e280775abddc0205565cc6b975b9ea7fea101d9ec5f6077523f3b` |
| `pin-self-test-v4.log` | `64148be386e877c727c1bd2c04969fc3f7d4184e54087d9d5d796c125dd120ba` |
| `pin-clock-focused-v2.log` | `b65128befeedf769e76c037a1586ed75c176e21674821c74a2783679bf1a9ef6` |
| `pin-clock-types-v2.log` | `8c0bcab58b002e44a3f0657326000224356c3d7744ea8fccf40d63a8f2da165c` |
| `pin-clock-audit-v2.log` | `4960250042812b4e55dfcd4655454ac85504eca9faa20984139afa899fe1bdd3` |

### Script-member staging

The rebased `--here` attempt at `a61b901f82b1a07f0dbff7b5430ce65534d87e78`
passed Rust tests, types, gate-input placement and the other selected checks.
Tooling found six inner CLI fixtures whose staged tree lacked an unrelated
root membership child, `tests/interop/.gitignore`. The shallow directory
candidate declaration recorded all child names, beyond the scripts the drift
guard reads. The named unit was stopped after those observed fixture failures
and drained; its temporary is absent. This attempt is not green evidence.

The guard now uses the shared `moduleMembers` owner for `build.sh`, `verify.ts`
and `bench.sh`. Runtime discovery consumes those same member basenames and
excludes hidden paths and installed dependencies through that owner's rule.
It declares neither unrelated root membership nor framework payloads. No
reader-input, module-closure or fixture-copier implementation changed, and no
fixture was weakened or given a second input catalogue. This supersedes the
shallow candidate declaration above.

All 22 focused layout/inner tests passed, including the six staged CLI controls
and the graph control for member files without framework or root membership.
Strict types passed six projects and 1,235 modules with no increase; the host
audit passed 2,208 sources, 364 entry closures and 418 reads.

| Path under `~/.cache/nts-scratch/841/d/` | SHA-256 |
| --- | --- |
| `here-v4.log` | `d860f91afd3fe4e0d121576393ef12499d6232db27d1645a1eacb7a056912904` |
| `here-v4-source/manifest.json` | `552d7d2ce85970b1c10bdcd2681945872bbe23ef96484adc190f583f74e7033b` |
| `members-focused.log` | `428a1c38b7fc9566b0bcf45b527c7aef45190a019eea9de19842739eebfc6a4e` |
| `members-types.log` | `8c0bcab58b002e44a3f0657326000224356c3d7744ea8fccf40d63a8f2da165c` |
| `members-audit.log` | `4960250042812b4e55dfcd4655454ac85504eca9faa20984139afa899fe1bdd3` |


### Review: quiet roots and bounded inventory

Review of `bf9906ee3633ff8a3b60b951b38992bcc3c064e7` found that treating every
logs rule as a gate-run root produced routine noise, and whole-summary parsing
made the hourly inventory allocate gigabytes. Only `runs` rules and the explicit
`gateRunRoot` log declaration now supply roots. Files and absent summaries or
payloads are routine; locks, identity changes, terminal changes and reader
failures remain named refusals. A countOnce control proves a non-run file and a
summary-less directory log nothing while a held collector lock still logs.

The reader validates all JSON and UTF-8 in bounded chunks and stores only fixed
decision facts plus an original-byte digest. The final guard hashes bytes
without parsing again. A malformed ignored case population still refuses
removal; a synthetic ignored string larger than V8's whole-string ceiling is
validated without constructing that string. A run with neither costs nor a
detach receipt is skipped before summary access. Ranking remaining payloads
conservatively retains at least the newest three completed runs overall, so
skipped payload-less runs can only retain extra older evidence. The production
hourly count now reserves and records memory through the ledger.

Pin timeouts and unchanged pidless grace use monotonic observations, retaining
wall time for immediate recognition of old orphans. Fixed-wall controls prove
both paths. Fixtures freezing monotonic time must advance it or use wait zero.
Cargo's recreated `target/tmp` is metadata, excluded from the legacy scratch
migration and its retirement condition; a warm-tree control preserves it.

The focused review suite passed all 303 tests; strict types passed six projects
and 1,238 modules with no increase, including the new modules at zero diagnostics;
pin's self-test passed. The first focused attempt refused the new reader's
constructor parameter property in Node's strip-only mode; the corrected form
passed on the second attempt.

Before changing the owner, its committed production inventory was run read-only
with `onlyRun` outside every root, preventing any deletion. On the live cache it
reported 617 kept rows, 0 removed, 36.87 s wall, 24.36 s user plus 11.54 s system,
and 2,007,648 KiB maximum RSS. This includes the original overly broad roots.
No raw payload was copied or removed during this review measurement.

| Path under `~/.cache/nts-scratch/841/` | SHA-256 |
| --- | --- |
| `review/focused-v1.log` | `018be35f67d0224e2bcd6c336dba9ea70bcabb6584d4eb75ed630b18d70114e5` |
| `review/focused-v2.log` | `86f700e3f40cf69d1eb72a2105c89b892cc32062bbd8da4fcf53ae55a3fbdc3c` |
| `review/types-v1.log` | `05ecc49245add8653e33536764fb6735511a0d236b958fb9d3d0f9a945214561` |
| `review/pin-self-v1.log` | `64148be386e877c727c1bd2c04969fc3f7d4184e54087d9d5d796c125dd120ba` |
| `review/inventory-before.mjs` | `4fb583fa3a428277de71bb648d84069a4708a50fec7a1aba1bd76aab8002f421` |
| `review/inventory-before.log` | `7eb58275181b613d4a94abc8c7ed3bd123a514e5d8f1c2962f36f69b147d1c1e` |
| `review/inventory-before.time` | `b96d6df1332cfb68b91ab9a40bedc76d5ec49c82cd4fe259c11fe8bf66951279` |


The revised read-only inventory at
`9eb28cab72bd90e8034ea1d2644419f5a0eb210d` used the same outside-root candidate
restriction, returning 379 kept rows and zero removals from the three declared
roots. Its peak RSS was **168,060 KiB** (91.6% lower); CPU was **91.91 s user +
2.45 s system**, versus 35.90 s combined before. Wall time was **228.58 s**
with 41% CPU availability, versus 36.87 s before. Full streaming validation is
therefore a CPU tradeoff, not a wall-time improvement. These live-cache passes
had different declared root populations and shared-machine load; they are
inventory measurements rather than an isolated throughput benchmark. The
fixed-size chunk reader removes allocation proportional to case population,
including the whole-string ceiling, and the hourly owner now reserves memory.
After normal collection, summaries without payloads are skipped entirely.
The revised rows include 75 routine non-run/no-summary/no-payload entries,
16 summaries rejected by the interruption/cleanup check and six held
measurements. The old check included closed red runs: its message did not
establish that these runs were unfinished. The collector reported these
refusals at that revision; routine entries did not log. The review correction
below makes known red policy keeps routine too.
No additional real-run payload was deleted or copied.

| Path under `~/.cache/nts-scratch/841/` | SHA-256 |
| --- | --- |
| `review/inventory-after.mjs` | `acc49b250584f25da6a3d8189677645d3dd09bf20510f4087609c5211693d1c8` |
| `review/inventory-after.log` | `4420c5fbc21d2e3cc6f5f58e64279ae45f72c8985007aa211dbc35f93e19557e` |
| `review/inventory-after.time` | `3dea501ce6c39b66cc00d48da469bae5a602f87860c0666046c54151c9008e7c` |


Review inner proof passed in `nts-841-review-inner-v1` with Node 26.13.0 first
on PATH and the required Java/Android/debuginfod environment. `--no-agree`
passed formatting (3 s), Clippy (14 s), compiler build (3 s), and selected-crate
plus backend tests (660 s): 2127 passing tests, zero failures,
1 existing ignored case(s), across 32 reported test binaries/doc suites.
Its run's `tmp/` was absent after completion. Source remained unchanged.
Raw log `~/.cache/nts-scratch/841/review/inner-v1.log`, SHA-256
`0917d153e9b4b28f92c061b088ab8bc8bb2c2112c300d2e8b304479192a8e8c6`; compact proof `review/inner-v1-proof.json`, SHA-256
`0122aac0ee43033e2dbf29dec293469b4976aa27acfb46571390d34142339b61`.


The first review `--here` attempt at `a2d4651a1c7e09e9611f5642e75d9f31be919e49`
found one environment audit error in the count's new reservation: directly
spreading `process.env` outside its owner. Its named unit
`nts-841-review-here-v1` was stopped, cancelled and drained (225 s of gate
execution); lifecycle running was empty and `tmp/` absent. This was not a green
proof. Logs were archived in `review/here-v1-source/` with their manifest.

The reservation now reuses the service's existing `launcherEnvironment()`
owner packet before assigning its own target/history and full-check rank.
No audit allowance was added. Host audit passes 2,211 sources, 366 entry
closures and 418 reads; all 123 service controls and six strict type projects
(1,238 modules) pass. This is a TypeScript environment handoff correction;
compiler source is unchanged from the green review inner proof.

| Path under `~/.cache/nts-scratch/841/` | SHA-256 |
| --- | --- |
| `review/here-v1.log` | `b2eb6db82be186f9560e432272a98b4037dcfb436ee2f5e076e12266ef97f58d` |
| `review/here-v1-source/manifest.json` | `75471ece72e886a0b4aa69121b1261b873cf96e28886f72cf3938a26450e2036` |
| `review/environment-audit-v1.log` | `97f7197964c1cd10533f494543dcb26a6519654b179e67c570356635ec432181` |
| `review/environment-service-v1.log` | `84cd7a266c32b3f2512e959bb298a068af334624632080086a2067b3decf60ae` |
| `review/environment-types-v1.log` | `e2a8283c40989e4acbf782988f234508be06967808625614ba9c057b35359513` |


### Review: known red policy keeps

Review of `a5e9928b481c7da101e1fec37625277b27b2342e` found that the cleanup
check preceded verdict classification, so stopped or cleanup-failed red runs
were logged as if their terminal state were unknown. These are closed red
runs whose raw evidence policy already keeps, not unfinished runs. The review
observed 21 such payload-bearing red runs in the current roots; the earlier
inventory row's 16 interruption/cleanup refusals above was misdescribed.

The owner now validates the known verdict before requiring complete cleanup
and no interruption for green deletion candidates. Known red runs are routine
keeps regardless of interruption/cleanup state. A valid red timestamp still
participates in the same ordering; a red without one is routinely kept outside
it. Unknown/unreadable verdicts/schema, invalid green completion, and terminal
lifecycle/measurement/hold refusals remain nonroutine. Digest/identity guards,
receipts and deletion grants are unchanged. No production data deletion or
new before/after measurement is needed for this classification correction.

The all-count reservation remains intentional: its full-check rank can delay
pool upkeep, aged-scratch sweeping and stray-slice stopping behind higher-rank
work. Pressure reclamation remains independent in DiskCapacity.


The preceding revision's exact `--here` at
`a5e9928b481c7da101e1fec37625277b27b2342e` was green in 898 s, with all 21
selected rows passing, canonical environment, complete scope cleanup, empty
terminal running set and no `tmp/`. Its archived hand log is
`~/.cache/nts-scratch/841/review/here-v2.log`, SHA-256
`2317fa4cf74b3be77174625d3e5d1ee2edf3c2b9e7c9b3551560a5385b198028`;
the step log/summary manifest is `review/here-v2-source/manifest.json`, SHA-256
`28dcb8db03d8a76670273d3c8e93039e2402e39053493f0619e853ee32098cb7`.
These prove the preceding revision; new classification proof follows separately.


The review classification proof passed all 318 focused tests: the 13-arm
classification matrix keeps red interruption/cleanup routine while green,
unknown/read failures and lifecycle/hold cases remain visible; a valid red
timestamp still contributes to newest-three ordering. The countOnce control
keeps the stopped red run's raw bytes without a log and logs the equally
interrupted green cleanup failure. Strict types pass six projects/1,238 modules
with no increase; host audit passes 2,211 sources, 366 entry closures and 418
reads. The batch used named unit `nts-841-review2-focused-v1`, Node 26.13.0 and
the required environment; admission waits are preserved in its raw logs.

| Path under `~/.cache/nts-scratch/841/` | SHA-256 |
| --- | --- |
| `review2/focused-v1.log` | `f70841ad929234cf0392b518ca92d31a1e981d1b2088aea0979a9c404c561506` |
| `review2/types-v1.log` | `c9adac67402024ad3d9773fedf7d000ebe61f160affeeb1d7421f761c8993592` |
| `review2/audit-v1.log` | `4bc2f306cb1ef602d180781d27c9e41c5600e326aa477c84b929444124c7e161` |


Review classification inner proof passed in `nts-841-review2-inner-v1` on
`f5c5c211d83e50dd61307785b86877d1ee2d358e` with the required Node/environment and unit properties:
formatting 3 s, Clippy 3 s, compiler build 3 s, selected crates and backend
Rust tests 573 s. Reported suites: 32; 2127 passes,
zero failures and 1 existing ignored case(s). Its run's `tmp/`
was absent after completion. No source changes during proof.
Raw log `~/.cache/nts-scratch/841/review2/inner-v1.log`, SHA-256
`a3c2064786655c0df3d3257ffd9ae236f2fa510f98c118394ea4d210e3d5d812`; compact proof `review2/inner-v1-proof.json`, SHA-256
`5fd0f36eb01a2afb282e2092b07b586515cc0b4006825928173bc7bafaf4f5ae`.
