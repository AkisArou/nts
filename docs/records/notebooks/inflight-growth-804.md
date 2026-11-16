# In-flight growth past a blocked queue head (#804)

A non-fitting priority head could prevent already admitted work from completing.
The measured #797 run held 17 GiB between steps and asked for another 3 GiB.
The full check held its existing reservation and needed 2 GiB to finish started
work. Its request fit the 2,513,064,512 bytes of room, but the higher head did
not. Strict prefix admission blocked both. Returning the higher run's idle
surplus alone still left an exact 708,160,960-byte deficit. Stopping only the
owned supported unit released its reservation and let the full check proceed.
That stopped run remains interrupted instrument evidence, never a verdict.

| Supplied observation | Bytes |
| --- | ---: |
| Available room | 2,513,064,512 |
| Higher growth request | 3,221,225,472 |
| Started lower cohort's request | 2,147,483,648 |
| Remaining deficit after idle release alone | 708,160,960 |

## Admission and lifetime rule

The runner marks growth only when it serves its current running steps' sampled
wants or case-token requests. Pending steps and withheld capacity do not qualify.
While a higher waiter exists it starts no new step, but its already started,
finite cohort can keep requesting the memory needed to complete. A mixed
ordinary ticket is withdrawn and joined before a drain-only replacement.

One queue plan distinguishes ordinary prefix admissions from backfill. Behind
the first non-fitting head, fitting draining growth from admitted owners at
equal or lower priority can backfill, charging room once in the existing order.
Fresh admissions and ordinary growth remain behind the head. The marker is
eligibility, not debt: marked growth in the ordinary prefix creates no protected
bytes. Only an actual backfill adds outstanding drained bytes.

Higher-priority decisions count those outstanding promises in full and subtract
observed physical use once. Ordinary growth preserves them, shrink returns them
first, and fresh ancestor draws cannot turn them into an ordinary discounted
promise. Running work in the same reservation can use them. New steps see
reserved minus drained capacity, including for equal-rank owners that are not
outranked. A pending step asks for ordinary capacity for its own shortfall.

An empty running cohort returns its drain grant before starting the next cohort.
The return is one owned in-flight promise, published before shrink can change
local counters. Repeated scheduling and sampling cannot start work or shrink
again until the locked ledger rewrite completes; the successor runs on the next
event-loop turn. Non-fitting drain requests remain waits, preserving #800's
yielding and timer/child-reaping behavior. No memory floor, resource capacity,
parallelism or time bound changes.

## Mixed-reader cutover

A v2 reader would ignore an additive protected-byte field and could discount an
unknown promise. New readers therefore support v3, and publish an admitted
entry as v3 exactly while its drained amount is positive. Returning that amount
to zero publishes v2 again. An old-code admission that encounters v3 fails
loudly with FutureStateVersionError and NTS_FUTURE_STATE_VERSION, leaving the
entry untouched. This is an expected transient, not permission to ignore it.

The actual historical control loads main d8cb's exact committed ledger module
under a separate supplied URL against a private ledger. It observes v2 accepted,
v3 refused by both read and reserve without changing bytes, then v2 accepted
and a real old-reader admission successful after the protected grant returns.
New-reader future-state controls use v4 and retain read/update/release byte
preservation.

Old processes retain imported code until their lifetime ends. The landing
service restarts after its main-owned gate/landing code changes; an active check
retains its source. The full-check controller follows verified, while active
core/wide, records and benchmark units retain their own source trees. Older
agent pool trees need a rebase and relaunch. An already waiting admit wrapper
rereads the ledger on each poll and propagates the future-version refusal; it
cannot silently reinterpret v3. Existing work can continue within its grant.
The compatibility fence lasts only for an outstanding drain grant, rather than
wedging an old pinned controller after that promise has returned.

## Controls and retained failures

The unchanged supplied-state replay fails its desired-progress assertion under
main d8cb's byte-verified ledger module, while its fitting-alone control passes.
The production correction passes both. Real private-ledger controls cover lower
and equal priorities in both ticket orders, head progress after the cohort
releases, non-fitting drain cancellation, normal-prefix growth, ordinary growth
above debt, observed consumption, shrink clearing and both ancestor loan forms.
Production-AST runner controls cover running-only demand, mixed cancellation,
new-step exclusion after an equal-rank grant, unresolved return with repeated
schedule/adjust calls, and actual sampler and child close during ordinary and
draining waits. Host observations and ledgers are private to each fixture.

Four existing source-mutation anchors were updated to the current owner
expressions: excessive-growth cancellation's before/after arms, and the forced
handoff's before/after retention and need arms. Each keeps its sabotage and
assertion. The old priority-yield control required a resume log before final
case tokens could proceed. That encoded the deadlock-prone behavior. Under the
approved started-cohort Decision, eight final children instead require the
higher admission marker and write their receipts after observing it. Outcomes,
physical higher admission, shrink and no-new-step assertions remain.

V1 stopped at strict checking. V2 was stopped only through its own named unit
after a private ledger setup omitted its reduced-memory observation; it is
interrupted instrument evidence. V3 fully drained red with stale mutation anchors
and the branch's initial incorrect protection of ordinary-prefix growth, caught
before landing. V4 fully drained
red only on the old resume-log expectation. V5 stopped before its cutover body
because the external virtual-module loader lacked a resolve hook. These runs
remain retained as negative or setup evidence. V6 at b4282 passed strict, both
audits, the main/fixed replay, historical cutover and all 140 focused controls.
Its helper joined and its green temporary was removed.

The rebase onto landed #803 at 8221c103 preserves all five own code blobs
byte-identically; only the two independent workflow Decision insertions
conflicted, and both were kept. The fresh inner at that source passed formatting, Clippy, build and 664 backend
cases, with zero failures or ignored cases. Its test phase took 546 seconds
while other machine work was active. The only subsequent change before full
tooling was the tool-written selector record: all 57 target roles remain
byte-identical, with just the ledger and runner byte facts, their aggregate and
the enclosing key refreshed. None of the 308 actual native dep-info files lists
that generated record, so it invalidates no native input.


## Final supported result

The final supported run at `8725340da5121a2dad4385e7d815d7335956c08f`
passed all 19 selected gate steps and the separate compiler build. Native tests
passed 3,078 cases, failed none and kept eight ignored cases. All seven frontend
files passed, with no unavailable execution. Both the independent full-tooling
run and supported tooling passed 2,756 tests, failed none and kept the two
existing TODOs. Their source audit and strict checking passed.

| Validation | Outcome | Wall seconds |
| --- | --- | ---: |
| Focused memory and scheduling cohort | 140 passed, no failures | 33.059 |
| Fresh inner test phase | 664 passed, no failures or ignored cases | 546 |
| Independent full tooling step | 2,756 passed, zero failed, two TODOs | 430.080 |
| Supported runner | 19 PASS, separate build passed | 708.321 |
| Supported tooling step | 2,756 passed, zero failed, two TODOs | 338.379 |

The supported CLI including selection and setup took 770.815 seconds. Its actual
summary's tooling ceiling was 1,206 seconds, with 338.379 used; the independent
one-step run had a derived 3,600-second bound. The earlier commentary comparison
with 900 seconds carried a previous run's value and is not the final bound.
No bound code or policy was changed. Records and gate-inputs took 293.420 and
277.546 seconds, including their independent live derivations of the unaccepted
candidate record. The existing range endpoint transport still supplies the base
catalog to the tip, so this recipe edit selects conservatively as
`catalog-stale-live`. That is the assigned follow-up #761 endpoint correction,
not a reason to skip a check here.

The run was canonical with no experiments or interruption. Scope cleanup and
diagnostics completed, its green temporary was removed and the unit was
inactive/dead-success with a clean tree. It grew seven times, shrank once,
withdrew no growth and killed no step. Records and gate-inputs exceeded their
learned memory forecasts; those observations are retained. The full check's
core and benchmark work and the peer's inner overlapped these validations, so
the wall times are loaded proof results, not an isolated cost comparison. The
private supplied-state controls, rather than a forced machine-wide queue,
prove the backfill and protected-byte cases.

## Finite evidence

Proof source: `8725340da5121a2dad4385e7d815d7335956c08f`, based on
`49eda462362d9cf9d705d3c69836acdd71454ba2`. The record is the only subsequent
change. Cited refs retain the pre-#797 and pre-#803 proof sources. Raw output
remains under `/home/akisarou/.cache/nts-scratch/804` and the supported run
`/home/akisarou/.cache/nts-landing/runs/here-8725340da512-1794807773363`.

The manifest is `/home/akisarou/.cache/nts-scratch/804/raw-evidence-v1.json`,
SHA-256 `bd88857fe0d0c8e93f482f1716478fc54fc9d79d09ad37487e1415b45df0a751`.
It binds 266 selected artifacts, 14,629,681 bytes and 64 exact Git receipts.
`verify-evidence-v1.py` rereads both files and immutable blobs independently;
its result has no errors. The original #797 ledger and diagnostics, its owned
stop receipt and diagnosis-only model are included. No green is inferred from
an interrupted run or a setup failure. The historical substitution is external
proof instrumentation; no production flag, hook or fixture-only admission path
was added.

Direct bindings:

- Supported `summary.json`: SHA-256 `0f739a4a81d3c7d6652fb8e0cb42c59b9aa8a13b4720614a51fe2c5579893447`.
- `/home/akisarou/.cache/nts-scratch/804/supported-v1/terminal.json`: SHA-256 `9bc21573c907ecbaef245246d7e632195305bdafe6c300b663e0f0ab19df3972`.
- `/home/akisarou/.cache/nts-scratch/804/focused-v6/cutover/result.json`: SHA-256 `33a94ddf4690f867d810809cb5132735d935e01eed413a2d097458c1667e4644`.

Readiness and the independent peer authentication bind the subsequent
Markdown-only tip. Production ALWAYS and the deferred #761 retirement decision
are unchanged.
