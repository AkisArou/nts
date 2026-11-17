# CPU ranks under contention: a landing beside two agents and the full check

Issue: #823. Before: main `9da4f58a26`. After: `898e2750f9` (this change).
Date: 2026-11-17.

## Cause

Every gate run's steps live in a root slice directly under `nts.slice`
(`nts-r*.slice`, bound to the run's unit). `nts.slice`'s
`cgroup.subtree_control` was `memory pids`, with no CPU controller, so the
steps of every run formed one flat CPU group. The only thing that ordered them
was each process's nice value, inherited from whoever launched the run:

- the landing service: 0 (`queue.ts` set no `Nice=`);
- the full check: 19 (`unit.ts`);
- an agent: 0, unless its launcher remembered 19.

The full check's `CPUWeight=20` sat on units in `app.slice`, which hold only
its controllers, not its steps. Builds and admitted jobs (`inner.ts`'s cargo,
`admit.ts` commands) ran in their launcher's unit under `app.slice`, which
splits the machine with all of `nts.slice` whatever the rank. One weighted
cgroup anywhere under `nts.slice` turns the controller on for all of it, and
from then on every unweighted root shares equally. The fix therefore has to
give every root its rank, and cannot leave any root out.

## The batch

One landing-priority `build tooling` run of the tree at its commit
(`runLanding`, `priority: "landing"`) ran beside synthetic CPU load: two
agents' groups of 24 spinning threads at nice 0, and one full-check group of
24 threads at nice 19. CPUs 4-5 were excluded throughout, and the landing
queue was empty at each start. Each load group was a root slice of its own
under `nts.slice`, as a gate run's root is.

- **Before.** The load groups carried no weight, and the driver's unit sat in
  `app.slice` at the default weight, as the landing service did.
- **After.** The load groups carried their rank's `CPUWeight` (agents 100, the
  full check 10). The driver's unit was placed as the landing service now
  places itself: under `nts.slice` at `CPUWeight=1000`.

Two pieces of real work ran beside the batch:

- **Before:** the full check's core run `core-3e4ffaf4759a` (unweighted).
- **After:** the full check's core run `core-19bee248e2b0` (verified code,
  unweighted, so weight 100), and #821's own `check.ts --here`
  (`here-97dd6506fbe6`, also unweighted).

The before arm's load was set to stop after 2400 s. Its run waited 1775 s for
memory before its tooling step began (#824), so the load stopped after 570 s
of that step's 906 s. The after arm's load lasted the whole run. The after arm
was therefore measured under heavier contention.

| | Before (`9da4f58a26`) | After (`898e2750f9`) |
| --- | --- | --- |
| tooling verdict | **FAIL**: 1 failed, 27 cancelled, 1 file "hung" (idle guard) | **PASS**: 2883 pass, 2 todo, 0 failed |
| tooling wall (quiet history: 421 s) | 906 s (load present for the first 570 s) | 620 s (load throughout) |
| tooling CPU | 4128 s | 5490 s |
| wall against the real landing ceiling (1428 s) | 63% | 43% |
| landing root, average CPUs during its tooling step under load | 6.9 | 8.8 |
| landing root, CPUs in the bulk of the step | 6.9 (flat throughout) | 14-15 (09:57-10:02Z), its quiet demand |
| each agent load group, average CPUs | 10.3, 10.1 | 7.4, 7.4 (about 5 during the landing's bulk phase) |
| full-check load group, average CPUs | 1.6 (nice 19) | 4.0 (weight 10) |
| #821's `--here` (after only) | - | 11 CPUs before the landing's step, about 1 during it |
| memory wait before the step (#824) | 1775 s | 347 s |

The landing's quiet demand is 13.8 CPUs (5808 cpu-s over 421 s). Under the
ranks it got that demand during the bulk of its step. For its last few minutes
it ran at about 1.5 CPUs, the few long test files on its critical path. A
single-threaded file at full share still runs slower than when the machine is
quiet, because of SMT siblings and frequency at full load. Weight cannot buy
that back; the 1.47x wall is that tail.

A full-check-weighted group got more CPU relative to agents than it did under
the old flat nice 19 (4.0 against 1.6 CPUs). A cgroup weight of 10:100 is a 10x
ratio, where nice 19:0 is about 68x per thread. The full check stays last, and
it is never starved to zero.

## Wall-clock bounds (guard 1)

Headroom is given for the after arm's landing-ranked window (09:50-10:06Z), at
each work's own rank. In that window the full check ran only its core
measurement. The wide part was waiting for a landing, and the records and
benchmark units had already ended (09:09Z and 07:44Z).

| Bound | Owner | Clock | Headroom in the after window |
| --- | --- | --- | --- |
| Core measurement ceiling, max(15 min, 3x its last green wall) = 4412 s | `full-check/measure.ts` `fullCheckCeiling`, enforced by `measure-command.ts` | wall from launch, admission waits included | `core-19bee248e2b0` (09:05:03Z) had used 3688 s at the window's end, leaving 724 s. It was **held** at 10:18:35Z: "doctests: full check run exceeded its wall ceiling of 4412 s; audit: ...", for every step. Its root got 6 cpu-s in the landing's 616 s tooling window. It was not runnable: its log shows memory-ledger growth waits, the last "grew by 1.0 GiB to 3.5 GiB after 435 s", plus an initial "pinned release preparation ... waits for 2.5 GiB". At 10:08Z, admit.ts showed it waiting "grows by 1.0 GiB, waited 96 s", with room 0.0 MiB, behind #821's agent run holding 20.2 GiB. Its wall went to the memory queue, not to CPU weight. The ceiling counts that queue time, and the CPU lost to higher ranks with it: #825. |
| Wide measurement ceiling, the same function; the last green wide ran 2669 s, so 8008 s | the same | the same | not running in the window: waiting for a landing |
| The culprit probe's ceiling, the same function's 900 s floor | the same | the same | not running |
| A gate step's bound, max(floor, 3x(work/width + run cost/slots)) | `gate/step-bound.ts` | the execution allowance; a known admission wait spends none | full check: the core's steps never reached their bounds; the measurement ceiling ended them first. Agent rank, #821's `here-97dd6506` (green, 1852 s): `tests` 703 of 1427 s (49%), overlapping the window; `gate-inputs` 201 of 1427 s; `tooling` 438 of 1427 s (31%), after the window; every other step at 1% or less. Landing rank: the batch's tooling ran 620 s; the real landing ceiling is 1428 s (43%). |
| Records units (`nts-full-check-records-*`) | `full-check/background.ts` | no wall bound of their own beyond their gate steps' | not running in the window |
| Benchmarks unit, `RuntimeMaxSec=8h` | `full-check/service.ts` `BENCH_HANG_GUARD` | wall | not running in the window. It runs alone on CPU 4, which no weight touches. |
| The hourly count, `TimeoutStartSec=30min` | `full-check/unit.ts` | wall | not running in the window; light work |
| The tooling runner's idle guard, 5 min with no output, process-group CPU or busy thread | `gate/tooling-runner.ts` `TOOLING_IDLE_GUARD_MS` | wall, reset by any CPU progress | Landing rank: fired in the before arm on a starved test at nice 0; did not fire in the after arm. Full-check rank: no full-check tooling ran in the window. The full-check-weighted load never fell below 1.1 CPUs (24 threads), so a runnable full-check test keeps resetting the guard. |
| Wall timeouts inside tooling tests (for example `node-preloads.test.ts`, 101 s on 2026-11-17) | individual tests | wall | landing rank: none fired in the after arm; full-check rank: not exercised |
| The differential's compiled call | `differential/` | CPU time, plus a window with no CPU, output or completed call | the CPU bound is unaffected; the window is reset by any CPU |
| The per-case compile limit (10 CPU minutes) and the compiled call allowance | gate | CPU time | unaffected by weight |

The core ceiling was reached twice on 2026-11-17. `core-3e4ffaf4759a` was held
at 08:35:34Z: it ran 07:21-08:35Z, overlapped the before arm and the machine's
contention before any weights existed. `core-19bee248e2b0` was held at
10:18:35Z after waiting in the memory ledger. Both times the bound charged the
run for time it was not executing. A hang guard that counts admission and
contention as a hang is its own task, #825. Neither hold argues for a different
weight.

## Controls

- `tooling/gate/ranks.test.ts` contains:
  - the order of the rank table;
  - the placement arguments for each rank, nested and unnested;
  - root slice properties;
  - `rankedScopeArgs`, including its refusal outside the user manager;
  - the landing service's arguments;
  - a unit-property control: each rank's scope, and a unit carrying the
    landing service's own properties, hold their weight in the user manager;
  - `admit.ts --memory-max` from outside `nts.slice`: the command keeps its
    unit's main pid through systemd-run's move into its own scope, inside its
    run's slice, with `MemoryMax` of 1 GiB and no swap. The peak recorded for
    its key is within a quarter of the peak that scope's own meter saw.
- `agents.test.ts` checks the agent's unit's `CPUWeight`, and `unit.test.ts`
  checks the full check's.
- `inner.ts --no-agree` is green. Its cargo phases ran in `nts.slice` scopes at
  weight 100 with their `MemoryMax`.
- `check.ts --here` of `898e2750f9` is green in 901 s. It re-entered itself in
  an agent-ranked scope.

## Raw output

In kept scratch `~/.cache/nts-scratch/823/`:

| File | sha256 |
| --- | --- |
| `batch.ts` (the driver; the before arm ran it with the load's duration at 2400 s) | `bbf82d50f5fb40d06c482adf306f73cdfdcefc9dc692684865036bd9ed3df5da` |
| `spin.mjs` | `b0b4987b15d9ab6cdf8634c2062160886a8b2302e407cdb5f78f1af0923a3ef0` |
| `batch-before/samples.json` | `db97edeff2be9e70581912c9b242caa3a5bef88c046cd6e1940fa4462c63286c` |
| `batch-before/landing/summary.json` | `75be5d0208a1bffd951365172532bbd0721941f6cf1e9adb7697b8effc9d7491` |
| `batch-after/samples.json` | `5ad3dfdffbf77a0c0e3f394573e91c56bceaf782ca97e914e211a21c8bcfdac3` |
| `batch-after/landing/summary.json` | `537932b1adea44fd146f8ee7c3431e5f58c50dbd64e80872aa50abb47e06666e` |
| `batch-after/observe/` | the full check's and the landing's status JSON, each minute |

## Rollout

A unit runs with the properties it started with. The landing service moves
under `nts.slice` at the landing's weight when it next starts from `main`; it
stops whenever its queue drains. The full check's controller and units take
the full check's weight when they next start from `verified`. Until then,
their roots carry no weight and tie with agents' runs.

## Follow-up

- #824: the landing-priority memory wait (1775 s, then 347 s).
- #825: the full check's measurement ceiling is a plain wall deadline that
  counts memory-ledger waits and CPU lost to higher ranks
  (`core-19bee248e2b0`'s log and hold, above); it becomes a progress bound.
