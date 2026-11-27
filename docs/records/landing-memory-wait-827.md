# Landing waits behind running lower-rank steps

Issue #827, measured through 2026-11-27 at 19:21 UTC. No admission rule
changed. Revisit the comparison after #1074 and #1101.

## Coverage and method

The 636 landing results span 20.36 days from November 7. Of the 610 results
that name a run, 97 retain a landing gate log and summary, from November 22
onward. Their total gate reservation waits have a median of 767 s and a
maximum of 1,207 s. Those totals include the landing's own pending
promises, replacement growth tickets and requests that could not fit even
if all admitted jobs finished. At least one sample of that last kind
appears in 87 runs.

For each initial ticket sample, compute the shortage as the requested
growth or initial reservation plus pending promises and the system floor,
less available memory. Keep a sample if the ticket could fit, had nobody
ahead, and the ledgered resident charge in lower-rank gate scopes covered
its positive shortage with 0.25 GiB to spare. The slack absorbs display
rounding and differences in when the two observations were read. Exclude
nested fixture lines. This yields 185 initial ticket samples from 62
landings. Of these tickets, 131 have a logged admission, with a median
of 13 s and a maximum of 409 s. There were 38 admitted tickets of at least
60 s across 28 landings. A ticket's duration can include other causes.

Match the original submission SHA to the last completed Signalbox
queue effect before the selected run directory was assigned. Keep
separate submissions of the same SHA separate. This covers 79 of the 97
service runs and 142 of the 185 samples. Manual and recorder submissions
without a queue receipt remain unknown. Match census identities to
retained lower-run scopes and their step lifetimes. For partly overlapping
cohorts, cap the possible post-arrival resident charge by the sum of the
steps' recorded peaks. Even this optimistic replay cannot tell how much
memory the ledger could have promised at a historical lower step's start.

| Post-arrival charge in the replay | Initial ticket samples |
| --- | ---: |
| Enough from known cohorts whose steps all started after arrival | 42 |
| Could be enough if known late steps in mixed cohorts reached their peaks together | 16 |
| Insufficient resident charge even when missing holders are treated as late | 49 |
| Missing holder lifetimes could change the answer | 35 |
| Queue arrival unavailable | 43 |

The 29 resolved tickets in the first row total 1,647 s. If a queue forecast
prevented every such wait in the observed history, it could save up to
566 ticket seconds per week over the full results interval. Adding the
mixed cohorts raises the optimistic ceiling to 869 s/week. The resident
test does not measure which pending promises would also have changed.
These are ceilings on observed ticket wait, without extrapolating pruned
logs or attributing the same amount to landing completion time.

## Four sustained waits

The following tickets had the same lower holder at qualifying samples
separated by at least 300 s. The census samples a live wait every 300 s,
so the endpoints do not prove continuous causation.

| Landing | Sample span / admission | Replay |
| --- | --- | --- |
| #1026, `2592b89c1188-38f771b2` | 300 s / 398 s | Queued at 03:53:51Z. The full-check cohort started at 03:55:47–51, the agent cohort at 03:59:00–11, and the landing runner at 03:59:39. The full-check cohort alone held 2.4 and 3.2 GiB resident against gaps of 2.0 and 2.1 GiB. This is the identified opportunity for earlier admission protection. The full ticket represents at most 137 s/week. |
| #972, `2439ec9f6c47-5a0db9bc` | 301 s / 405 s | Queued at 06:59:38Z. Agent tooling and gate-inputs started at 07:02:27 and 07:03:07, and held 2.7 then 1.4 GiB against gaps of 2.6 then 1.9 GiB. The wide run was already present in a 06:25 landing. It supplied 0.76 and 0.75 GiB at the two samples. The records do not show when the wide run admitted the cases it held then or how much unused promise each holder accounted for. |
| #977, `446c05700ede-abfe20b2` | 300 s / 409 s | Queued at 00:06:45Z. The agent tooling step that started after arrival held 0.41 GiB initially and was absent at the repeat. Gaps were 3.9 and 6.3 GiB. The culprit-search run supplying 7.4 and 9.9 GiB has no retained holder trace. |
| `694f7e10291f-542e45bd` | 601 s / ticket replaced | The records commit is at 07:58:35Z and the selected run directory at 08:02:21. The wide cohort started at 08:01:55, about 46 s before the landing runner. The automatic submission has no queue receipt. The wide run logged a 1,218 s yield across the landing's growth requests. |

The earlier [#824 reconstruction](memory-holders-824.md) covers the
separate 1,775 s #823 wait. Its lower-rank agent tests step held 8.9 GiB
of 11.6 GiB, with full-check test262 steps beside it.

## Forecast cost and retained memory

Across the 79 matched runs, the median submission-to-gate interval was
354 s, and the union of the intervals covered 67,812 s. Of 4,321 observed
lower step starts, 103 across 36 runs began within an interval and were
still running at its gate boundary. Deferring all 103 just to that boundary
adds 18,294 step-seconds and 44.4 slot-hours of start-delay exposure.
Using the maximum granted landing peak of the preceding five completed
landings as a forecast proxy and the lower step's recorded reservation,
29 of those starts exceed even the theoretical room available with that
forecast on the 29.04 GiB post-floor machine. This assumes those steps
would overlap the demand and uses observed peak occupancy for elastic
steps. Delaying those 29 to the boundary would add 5,166 step-seconds and
18.2 slot-hours. A deferral discards no CPU. These exposure sums do not
measure lower job completion or how much other work would fill the slots.

At the sustained samples, the wide run beside `694f7e10291f` reserved
about 13.7–15.0 GiB gross and held 7.4–8.7 GiB resident. The #1026 core
run retained 4.71 GiB against 2.4–3.2 GiB resident, and its agent showed
about 3.7–4.0 GiB reserved near the initial 1.0 GiB charge. The late
agent beside #977 retained 0.69–0.70 GiB near its 0.41 GiB charge.
The main culprit-search holder beside #977 and the #972 holders lack
retained reservation traces for the matching windows.

The ledger already discounts ordinary unused lower-rank promises, and
protects draining grants. The wait line's pending figure includes the
landing itself. Subtracting the landing's unspent promise estimated
from the visible census leaves about 1.7–2.1 GiB of aggregate pending
beside `694f7e10291f` and about 0.7–1.0 GiB beside #972, including its
small outside-the-slice runner charge. Both estimates depend on rounding
and census coverage. They cannot assign bytes to #1074 or #1101. Even
removing the estimated 1.7 GiB of other pending in the last
`694f7e10291f` sample leaves about 5 GiB of shortage while the wide
run holds 8.7 GiB resident.

## Policy cost

The four sustained sampled spans total 1,502 ticket seconds, or
516 s/week over the full results interval. If a stop-and-requeue rule
had reacted in 30 s and each span remained actionable throughout, it
could save at most 1,382 of those seconds, or 475 s/week. Allowing the
queue forecast the #1026 span leaves up to 382 s/week over the three
unresolved spans. Separately, the 37 resolved tickets with insufficient
post-arrival resident charge have 1,331 s after a hypothetical 30 s
response, or 458 s/week. That ceiling does not separate accounting
effects and changes in available memory. The replay identified no
sustained ticket whose shortfall was both attributable to a known
already-running holder and beyond a queue forecast's reach.

A standing reserve sized to the 23 GiB maximum observed landing grant
would leave at most 6 GiB for lower work before unledgered use. Reclaim
pressure cannot guarantee return of the resident charge. The existing
kernel control used a 64 MiB high threshold on a 256 MiB anonymous
allocation with no swap and observed the busy worker in D state.
Its 193 ms includes lifting the threshold so the worker could finish.
[Linux cgroup v2 memory controls](https://docs.kernel.org/admin-guide/cgroup-v2.html)

The observed ceilings and unresolved attribution do not justify
enforcing either queue forecasting or preemption. Keep the queue
timestamps with future landing answers so the replay can be repeated
without inferring submission time.

## Kept evidence

- `~/.cache/nts-scratch/827/signalbox-queue-arrival-query-nov27.tsv`
  SHA-256 `d36d43fc08dd70906dfb3db1bd0c59b6b88cc3b59b2d9d7cd67fceadfeb81122`.
- `~/.cache/nts-scratch/827/four-sustained-waits.txt` SHA-256
  `6df815446335c4308dc1eefb0e19376a9172c9a8210adeeade74bf9b64f20419`.
