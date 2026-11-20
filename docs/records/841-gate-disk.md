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
