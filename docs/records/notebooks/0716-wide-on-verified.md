# Wide runs follow verified

Design for #716, before implementation. The governing specification will
be `docs/workflow.md`, After landing: the full check and its Decisions.

## Trigger and cost bound

Replace the three daytime clock slots with a four-hour minimum between
wide-run starts. At a controller cycle, run wide on the newest verified
when its commit differs from the last wide run, the gap has elapsed, no
landing is queued or running, and no higher-priority memory request waits.
The existing minute idle poll is
the only additional delay when the controller is free. A core run already
in progress finishes first: the controller and its gate tree remain serial.
Later landing arrivals retain their existing higher memory priority.

The gap is a source-owned policy constant. It is measured from an actual
wide attempt's start (`wide.last_run.at`), never from a skipped eligibility
check. Missing verified, busy higher-priority work or an unelapsed gap consumes no
opportunity. New verified commits coalesce while waiting; no backlog is
replayed. An unchanged verified does not schedule another daytime run.

Four hours bounds regular work to about six runs per day, roughly 40
CPU-hours at the observed per-run cost, while using eligible idle periods
rather than waiting for fixed slots. A nightly exception can add one start
in a rolling day; its cost is reported separately. Actual work is lower when
verified does not advance or higher-priority work waits. These are policy
projections, not measured after-change daily totals.

## Nightly and background work

Keep the local nightly time, 03:00 by default. A due nightly wide attempt
overrides the daytime gap and the changed-commit requirement. It still
waits for queued/running landings and higher-priority memory requests.
A completed attempt whose start is on or
after the latest nightly slot satisfies that night; restarting the
controller does not duplicate it. A missed night is coalesced into the
latest night, as the current benchmark schedule already does.

The nightly benchmark request remains independently durable. A new
benchmark unit cannot start while that night's wide attempt is outstanding.
Its existing policy for a failed wide result is unchanged: this change
orders the attempt before benchmarks without introducing a new green-wide
requirement. An already-running benchmark continues and is adopted by name.
Its session budget and outer guard are unchanged. A daytime wide run never
makes benchmarks due.

Records still run in their per-part units and trees. The controller first
collects ended units and follows their submitted results, then schedules
wide/core as today. An active records unit does not hold the controller;
a new wide run cannot start a second recorder beside an existing recorder
or unresolved records submission. Record publication remains through the
landing queue. No live unit is stopped, restarted or reinstalled here.

## Interfaces and migration

`schedule.ts` owns the pure eligibility decision, with an explicit now,
verified, last wide result and busy input. The queue adapter
exposes queued and checking entries; held entries alone do not block a run.
The ledger's existing public observation supplies live landing/agent waiters.
Later arrivals are handled by ledger priority. Tests
give that input directly and never inspect the host's queue or clock.

Remove the daytime clock list from the current Schedule and generated unit.
Continue accepting the old installed unit's `--wide-at=...` argument as an
ignored, named migration option, without using its times. This lets the
controller pick up verified code before the coordinator updates the live
unit. `--nightly-at` stays. Existing wide slot state is historical data and
does not postpone new eligibility; actual `last_run.at` is the start record.
The status explains a blocked eligible run and the next gap boundary.

No new general scheduler, worktree or unit is introduced. The gate, records,
benchmark and culprit lifecycle stays in its existing owner.

## Proof

Pure schedule tests own all dates and show verified movement, exact gap
boundary, unchanged verified, initial run, landing deferral without consumed
eligibility, nightly exception, missed-night coalescing and restart.
Service fixtures exercise newest-verified selection, deferred nightly
benchmarks, the unchanged background units and records lifecycle. Queue
adapter tests use a private queue; parser/unit tests cover old arguments
and the new generated definition. Real gate tests retain their private host
observations, ledger, scheduling history and named unit.

Run the host audit and full tooling through the gate. Use the original
schedule as a control for the new verified-trigger fixture. No compiler
proof is owed because no compiler or runtime behavior changes.

For cost, retain the actual before-run summary inputs and report their sum:
the four wide starts on 2026-11-11 UTC consumed 26.8128 CPU-hours in their
18 step families (preliminary setup excluded). The first three walls were
30–36 minutes; the last was 61.3 minutes under that night's contention.
Replay a fixed 24-hour sequence of verified arrivals and landing activity
through both pure schedule policies, reporting eligible starts and costs
projected from those measured per-run inputs separately from observations.
After landing, the same summary reader will report the first complete
24-hour after window when it exists. A replay cannot honestly be labelled
an observed after-change CPU/day measurement. The design review must agree
that distinction before implementation.
