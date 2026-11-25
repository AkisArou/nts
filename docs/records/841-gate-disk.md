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
