# Reusing landing verdicts in the full check's core

Design for #701, under #549. The user decided that the core should use the
landing check's green verdicts for the exact commit it checked, then execute
the work still owed. This replaces the workflow's previous prohibition on
reusing results. Implementation follows coordinator review of this note.

## What the current code establishes

The landing service rebases a submission and adds its issue-closing message
before checking it. `Result.tip` is the checked commit. `Result.sha` is the
submission, and `Result.commits` includes intermediate commits that were never
checked individually. Only `tip` can identify reusable evidence.

`landing/run.ts` returns the actual step outcomes, including the separate
build. `landing/service.ts` currently persists only the planned landing and
deferred step names. Its run logs are pruned after three days. Recovery after
advancing main can complete a landing without the original `Ran` object.

`full-check/measure.ts` launches the candidate's own gate. `service.ts` asks
it for every core step and moves `verified` after the result is green.
`culprit.ts` consumes observations supplied through the service's probe
function. A probe can compose a candidate with pending reverts, producing a
different commit. Wide runs and benchmark artifact builds also use `Gate.run`.

The two launchers already share `canonical-environment.ts` and standing
verdict policy. Landing uses the `nts-dev` compiler and test profile. The
full check prepares a release compiler and uses the test runner's default
development profile. These source-owned build choices need explicit treatment
when importing a verdict and when preparing artifacts for fresh checks.

## A durable receipt for the checked commit

The landing service writes a versioned receipt below
`~/.cache/nts-landing/verdicts/<full-commit>.json`. It uses `durableRecord`,
after obtaining the green result and before making the checked tip visible
on main. The receipt stands independently of the queue answer and run logs,
so the existing recovery path can finish publishing main without losing it.
Receipt publication failure is logged by name. A consumer then executes the
ordinary core through the missing-receipt path.

The receipt contains the following fields.

- The full checked commit, its tree object, the submission and landing ID,
  base, completion time and original run location.
- The canonical environment contract and its deterministic identity.
- Each actual step outcome, its acceptance and reason, CPU and wall cost,
  and its coverage. The selected plan and its deferred entries remain
  available for explaining what the landing did.
- Pending and accepted record notices grouped by the step that printed
  them, together with platform-unrun findings and their policy acceptance.
- The build profile and binary identities as execution provenance.

Only a completed green service check can publish this receipt. The reader
requires the exact full commit and tree, a recognized receipt version,
canonical execution without experiments, and successful outcomes. Older
queue records continue to work through the ordinary core path. A malformed,
unreadable or incompatible receipt names its rejection in the new run's log.

Coverage belongs to the actual executed step. A sample retains its own step
name. A narrowed interop or doctest selection cannot certify the full
corresponding step. Prerequisites retain their actual coverage too. A planned
name without a successful outcome supplies no evidence. The receipt writer
derives these facts from `Selection`, `RunOptions` and `Ran` together.

## One environment contract

Review of the live landing and full-check reports found that their launcher
PATHs differed in agent-added directories and order. The coordinator directed
the first implementation commit to construct the gate's PATH canonically,
using `toolchainDirectories` from `tooling/gate/toolchain.ts` and a fixed
system-directory list. Helper's #697 supplies that shared resolver. This
keeps strict PATH equality in the receipt contract. The implementation starts
after #697 lands and uses a control with two different launcher PATHs.

A shared gate helper produces a versioned, stable contract for both the
landing writer and the full-check reader. The candidate owns this helper,
as it owns its launcher, input linker, toolchain pin and verdict policy.
A historical candidate without the helper gets its ordinary measurement.

The contract records the canonical policy revision, fixed ambient settings,
the program-visible host capabilities, platform and architecture, the
selected Node version and toolchain identities. It anchors dependency inputs
to the committed lock, package-manager pin and oracle producer identity.
Linked external corpora carry their checkout identities. The same probe
constructs both arms. An unavailable identity prevents reuse and is logged.
The probe reads identities and performs bounded tool-version queries. It
performs no dependency capture and starts no case workers.

Normalization removes run-local allocation facts from this comparison.
These include temporary, checkout and target locations, oracle capture and
seal locations, process IDs, bus addresses, slice names, reservation tokens
and scheduling priority. The oracle capability contributes its stable input
and producer identities. Its serialized run-specific capability is retained
in the original environment report for diagnosis.

The contract explicitly recognizes the existing launcher-owned profiles as
implementations of the shared test contract. The receipt records which profile
actually supplied each result. This design accepts landing's `nts-dev` test
verdict for the core's workspace test obligation. The release compiler required
by fresh full-check steps is prepared at the measured commit through the
existing pinned build. Its preparation cost is recorded in the new run.
An imported build verdict grants no authority to use an existing target's
compiler without preparing it for that commit.

Remove this profile equivalence when every test route uses the one named
profile from helper's test-route consolidation. At that point the contract
requires that profile. `nts-dev` currently retains overflow checks and debug
assertions, which is the basis for accepting its workspace test verdict here.

Step selectors describe coverage separately. A changed verdict policy,
toolchain, dependency input or program-visible capability invalidates the
contract. Private fixture ledgers, memory readings and scheduling histories
remain properties of their own runs.

## Core planning and its own combined result

Core measurements opt into reuse explicitly. `Gate.run` retains fresh execution
as its default, which preserves wide runs, benchmark builds and other callers.
The service passes the reuse option for core runs and core probes.

The candidate's own step list remains authoritative. For a valid matching
receipt, `measure.ts` partitions the requested steps into fully covered passes
and steps to execute. Missing or incompatible receipts execute the complete
requested set. A normal core requests the whole core. A culprit probe retains
its existing requested failing-step subset.

`measure.ts` creates a new run directory and combined summary for the measured
commit. Its summary names every requested step and records each result's
origin. Imported rows retain the landing ID, checked commit, contract identity
and original outcome. Fresh rows retain their own outcome. Any fresh failure
or hold contributes to the combined verdict in the usual way.

The new run preserves the imported record notices and platform findings
beside its fresh logs. `listedIn` and the records launcher therefore see the
same pending and accepted rows after reuse. Release artifact preparation
still occurs before a records pin is made. An entirely covered core is a
valid combined measurement. It never passes an empty selector to the runner,
where an empty selector means every step.

The summary separates CPU spent by this run from the original CPU associated
with imported outcomes. Reused CPU is credited once as saved work and never
added to the controller's executed CPU. It also records the requested and
executed plans, the receipt used, and rejection reasons when fallback occurs.

The wall backstop sizes the work being executed. A short reused core cannot
become the historical allowance for a later complete core. Reuse-aware
history is used only for a compatible execution plan. Otherwise the existing
measured step baseline and fifteen-minute floor supply the bound.

## Culprit search and recovery

The service looks up evidence for the actual commit a probe measures after
applying pending reverts. A base commit's receipt cannot cover a composed
commit. The combined measurement is that actual commit's observation, so
`culprit.ts` can use its normal PASS, FAIL and HELD decisions.

The existing fresh tip, last-green and culprit confirmations still execute
the requested failing steps. A green landing receipt cannot supply a failing
step in a valid combined core. Fresh confirmation remains the independent
control for the failure being investigated. Ordinary bisection probes may
use matching landing passes. Cached probes retain their origin and contract
identity, and imported entries are revalidated before use after a restart.

Receipt selection, composition and result combination live at the measurement
boundary. The bisection algorithm keeps its existing search rules. Its tests
receive combined observations through the same `Measure` interface.

## Proof and implementation order

1. Add the portable contract, receipt schema and their validation tests.
   Write actual evidence from the landing service before its main advance.
   Cover crash recovery and log pruning with durable receipt controls.
2. Add explicit core reuse, combined summaries and record notices, preserving
   fresh wide and artifact callers. Cover an entirely reused core and artifact
   preparation for its records, as well as compatible wall-backstop history.
3. Exercise service and culprit search over real fixture commit histories.
   Cover missing and malformed receipts, wrong commit, tree and environment,
   partial coverage, new core steps, composed reverts, restart, and a fresh
   deferred failure beside imported passes.
4. Run a representative real core measurement on one fixed commit with the
   ordinary complete plan, then run its receipt-covered and deferred plan.
   Keep executed step counts and process-tree CPU for both arms, including
   artifact preparation. The report gives executed and reused CPU separately.
   Use named units, admission and the real machine ledger for this proof.
5. Run the gate's tooling checks. Every test that starts a real runner has its
   own fixed memory reading, ledger, scheduling history and named unit, with
   completion driven by observed state. Pure planning and service tests use
   injected receipts and the existing fake gate.
6. Update `docs/workflow.md`'s full-check contract and Decisions section and
   append the user's decision to `decisions-log.md`. Send the implementation
   diff and measured before/after CPU to the coordinator before queueing.

The implementation adds the receipt and contract beside their existing gate
and landing owners. The full-check changes remain in measurement and service
integration, with focused tests. Helper's #697 owns environment-only edits in
the shared full-check fixtures. Concrete overlapping additions will be
coordinated before editing those paths.
