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
