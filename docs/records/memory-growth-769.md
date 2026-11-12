# A stale queued memory growth request: #769

The supported #728 local check completed its running steps but retained a
queued growth computed before they drained. The captured state is in
[memory-growth-769.json](memory-growth-769.json), with the original admission
snapshot and run path. It has no running steps and zero used or withheld bytes.

| Bytes | Captured state |
| --- | ---: |
| Reserved | 10,737,418,240 |
| Current wanted | 11,781,799,936 |
| Queued growth | 11,811,160,064 |
| Current useful rounded growth | 1,073,741,824 |

The ledger had about 10.6 GiB of room. The old eleven-GiB ticket could not fit;
the current one-GiB request could. The run only withdrew a ticket when no growth
remained necessary, so a smaller positive gap kept the obsolete request alive.
No ledger or history file was edited. The local proof and its private slice
were stopped by their recorded unit names; the incomplete run is not proof.

The corrected owner rounds and caps demand once before inspecting its pending
ticket. It withdraws an excess, waits for the existing promise's finalizer, and
then schedules with fresh demand. A smaller useful request can still finish as
a partial grant. Replacing a ticket retains its admitted ancestor's rank/order.

The real-runner control supplies memory observations, a private ledger/history
and a private unit. Its first step holds ten GiB until an eleven-GiB growth
request queues, then ends. Its next step needs eleven GiB total. A mutation in
the staged before copy records the still-live excessive request and fails by
name; the corrected copy withdraws it and completes. No deadline decides either
arm. Controlled execution of the parsed production policy also covers a grant
racing cancellation, once-only replacement, and useful partial grants.

The focused scheduling, race, selection, report-consumer and timing proof passed
157 tests with zero failures. Host ownership and strict checking passed last.
The raw proof remains at
`~/.cache/nts-scratch/728/stale-growth-observation/focused.log`.
