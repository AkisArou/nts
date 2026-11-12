# Case retirement investigation (#752)

The core run `core-e2decda5113e-20261112T142547Z` failed types after its
command completed successfully, and classified example-refusals as INSTRUMENT.
Both logs name `case memory: cannot retire owned scope: spawnSync bash ETIMEDOUT`.
The types exception escaped from case-spawn's finally, outside its instrument
catch. The summary records their step ends at 14:38:43.029 and 14:39:58.595 UTC.

The runner does not call watchPeak: its synchronous systemd-run belongs to
admit.ts's separate watcher. Actual runner blocking paths include ledger
cleanup on growth cancellation and StepScope's manager calls.

A source-owned measurement under the machine's existing load, with no added
load suite, observed load averages 50.58, 44.91 and 44.84. Six StepScope
creations stalled the event loop between 45.480 and 106.863 ms. The 64 manager
calls totaled 441.534 ms, with a maximum 23.398 ms. Holding a private ledger
lock made releaseLedgerEntries block its loop for 10002.643 ms, then report its
named fallback. This proves a blocking cleanup path; it does not establish
the exact historical thirty-second trigger. No retained PSI series was found
in the run root, summary or relevant user-unit journal window. Current PSI
counters cannot reconstruct that historical interval.

A once-only matched experiment held each broker reply for 31000 ms on Node
26.13.0. The old helper, captured from
`5cc86c497816dd1b1669b6ac25ff21f47f68ad6f`, exited 1 after 30170.636 ms with
ETIMEDOUT. The new helper exited 0 after 31097.780 ms and printed `retired`.
The timer belongs to this evidence experiment only. Routine controls use an
owned backstop clock and explicit socket/scope events.

The structured [capture](case-retirement-752.json) preserves every manager
call, the event-loop rows, source identity, matched outputs and node version.
The units were `nts-agent-752-stalls-2` and `nts-agent-752-delay-pair`.
