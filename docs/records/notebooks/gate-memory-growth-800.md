# Gate memory growth settles (#800)

The gate runner retains running steps' pending memory wants when shrinking,
then re-enters scheduling on the next event-loop turn after a growth settles.
The reservation target, rather than a delay or a changed limit, prevents the
same memory from being returned and requested again. Capacity, priority,
verdict policy and step bounds are unchanged.

## Failure and cause

The first queued #761 correctness slice, 9829f0554fff-73f63757 at
9829f0554fff2f6fa464fcd640dbec0af54053ba, exposed this defect on main
d5fb8f001f9025097f5a550900c5017e999394a3. The adjustment code was identical
on both revisions. The last parent pool-state observation held 15 GiB with
15,951,986,688 bytes granted to tooling and no held or waiting tokens. Later
read-only samples of that exact reservation alternated between 17 and 19 GiB.

Shrink retained current use, withheld bytes and two blocks of slack, but omitted
pending step wants. Growth then immediately requested those wants again.
Completed growth called schedule directly from a fulfilled promise's finally;
schedule called adjustment again. This could repeat without yielding to the
sampling timer that would feed pending wants into the steps' grants. Child
exits and step-bound timers were starved as well.

The parent diagnostics stopped at 01:06:09 EET on 2026-11-16. Tooling's case
stream continued until 01:09:17; its command time file and final output were
written at 01:10:31 (371.10 wall s). A coordinator read-only observation reported over ten CPU minutes and tens of
gigabytes of I/O through millions of small reads and writes while the exited
command remained unreaped. This reported /proc reading is distinguished from
the retained native diagnostics and reservation samples.
The landing-build memory sampler eventually reported “sampler did not stop
within 60000 ms; terminating the unresponsive worker” at 01:49:29. This was
about 43 minutes after parent diagnostics froze and 39 minutes after the final
command output. That late supervision held the check; the blocked event loop
could not process the much earlier step-bound timer.

The queue entry was withdrawn, then its held state cleared; main remained at
d5fb8f00. No unit was stopped by this task. The failed service run is negative
evidence, not a completed verdict on #761. The correction lands separately
before #761 rebases and retries.

## Control and verification

The existing fixture executes adjustMemory's actual AST-extracted production
body with supplied observations and reservation transport. The replay uses
15 GiB initially reserved, 15,951,986,688 bytes in use and a supplied 4 GiB
pending want, larger than the two-block slack. The same fixture runs first
against main d5fb8f00's exact run.mjs text through a read-only loader, then
against the fix. The historical full runner is never launched by this control.

| Policy | Completed growths | Shrinks | Next-turn reschedules | Result |
| --- | ---: | ---: | ---: | --- |
| Main d5fb8f00 | 8 | 8 | 0 | Private operation guard refuses continued churn; 17 GiB retained at refusal |
| Fixed 503f54f79d65 | 1 | 0 | 1 | One 4 GiB growth; stable at 19 GiB |

The before grants are 4 GiB followed by seven 2 GiB grants. The fixed policy
performs no further ledger operation across twelve repeated adjustments while
the same want remains pending. Maximum simultaneous growth is one in both
arms. This is a deterministic operation-count comparison, not a host-time
performance claim. Additional proof-only output observation records the actual
fixture state; the ordinary after arm runs without that loader.

The main-policy suite has three passing existing cancellation/racing-grant
controls and two expected failures. The fixed suite passes all five. The
sampling/child-close control keeps a following growth pending while a real
sampler callback and a real Node child close both occur, then settles and drains
that transport. No duration threshold decides its result. The existing staged
handoff experiment retains its assertions; only its literal retention-expression
anchor follows the new production expression.

| Proof at 503f54f79d65 | Actual result |
| --- | --- |
| Main-policy counterfactual | 3 pass, 2 expected failures |
| Ordinary fixed policy controls | 5/5 |
| Strict, host, timing audits | All status 0 |
| Six-file memory and scheduling cohort | 110/110; zero skips/cancellations/TODO |
| Fresh inner | fmt 5 s, Clippy 11 s, build 29 s, tests 608 s; green |
| Supported --here | 19 summary PASS plus build; canonical, dirty 0, no experiments; complete cleanup and diagnostics |

The first broad-cohort proof driver supplied a write-only object instead of a
Writable stream and failed during collector setup. Its completed policy and
audit phases remain separately source-bound; the corrected driver used a real
file stream and completed all 110 controls. No production change followed that
driver correction.

Supported's runner wall was 665.099 s (the CLI reports 675 s including setup).
The coordinator reported that it overlapped the full check's wide run. The run
records 418.120 s of memory waiting; those observations are not an isolated
cost of #800 or a before/after speed comparison. Its normal resource history
contains one growth, one shrink and three withdrawn tickets, with no
above-reservation step or killed step.

The finite raw manifest is
/home/akisarou/.cache/nts-scratch/800/raw-evidence-v1.json, SHA-256
511fbf25404dc1f3f062b87475f3031a54e5246f3a4af99e225bff3d08d2de96.
It binds 127 selected artifacts (6,798,442 bytes) and 13 exact Git receipts,
including both source revisions and the triggering #761 run's runner source.
The verifier rehashes every artifact and exact Git blob. No compiled binary copy is
retained for this task. The count loaders and captured historical source,
ordinary controls, six-file cohort, audits, inner and supported receipts each
retain their own source and status.

The finite evidence also binds the withdrawn run's frozen diagnostics and
queue rows, exact reservation samples, its terminal supervision receipt and
cleared queue state. Exact final-tip readiness is recorded separately after
the Markdown-only commit. #761 remains open and its ALWAYS rule remains
unchanged by this fix.
