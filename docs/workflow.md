# How we work

nts has no users yet, so the speed at which a change reaches `main` matters
more than proving every commit perfect before it lands. This page is the
workflow: how work is cut into tasks, how agents are run, what a change must
pass to land, what is checked after it lands, and how the machine is kept
clean. The bar for the code itself does not change: fix the cause, no
workarounds, every fix with a test, and a refusal is always better than a
wrong answer.

[`AGENTS.md`](../AGENTS.md) holds the short list of rules every agent
follows; this page is the why and the whole picture.

## The loop

1. A **task** is written: one change that can land within a day.
2. An **agent** takes it, works in a worktree from the pool starting at the
   newest `main`, and adds the tests that show the change.
3. The **landing check** runs: only the checks the change can affect, in ten
   minutes or less. Green: `main` moves to the change at once and is pushed.
4. The **full check** runs continuously on the newest `main`, after landing.
   Green: that commit is marked `verified`. Red: the commit that broke it is
   found and reverted automatically, and fixing it becomes a task.
5. The agent ends when its task lands, and its worktree goes back to the
   pool.

## Tasks

- **One task, one change, landed within a day.** A task names its goal, the
  paths it may touch, what "done" looks like, and the tests it adds. Work
  that takes longer is cut into slices of the final design, each of which
  lands on its own; a slice is never a temporary step that a later slice
  undoes.
- **A design first, when there is a design to make.** A short note says
  what will be built and why; the user or the coordinator agrees; then the
  slices are written as tasks.
- **One task list,** visible to the user. Until the signalbox app runs it
  (it takes tasks from GitHub issues and its own local list, assigns them to
  agents, and shows them on its dashboard), the list is
  [`plan.md`](plan.md): its Now section holds the active tasks and who has
  them, its Backlog the queued ones.
- **Nothing valuable sits on a branch.** Unfinished work on a branch is
  either a task in the list that names the branch, or it is deleted. Old
  branches are not kept "just in case": that is how work gets forgotten.
  A commit that a record cites by hash stays reachable through
  `refs/cited/<sha>`, a pointer at that commit alone, so deleting a branch
  never breaks a citation.

## Agents

- **Short-lived.** An agent is started for one task and ends when that task
  lands or is handed back as blocked. No agent owns an area for weeks, and
  nothing lives in handover folders.
- **As many as the work and the machine allow.** Areas that touch different
  paths run in parallel: for example two or three agents on the compiler,
  and others on `runtime/node`, Chromium, tooling or tests at the same time.
  The limit is the size of the worktree pool, which the machine's memory and
  disk set.
- **One message per task:** landed, or blocked and why. No progress reports,
  no evidence packets. The landing check is the evidence.
- **Which agents** (Codex or Claude sessions, started by hand or by
  signalbox) is decided separately; this page does not depend on it.
- **The coordinator** keeps the task list, writes and slices tasks, agrees
  designs, reads the diffs of risky changes (the compiler's core, the gate
  itself), watches the full check, and follows reverts up.

## Landing: the landing check

The landing check decides whether a change may go on `main`. It is small on
purpose: it guards the failures that would stop everyone (a build or a unit
test broken on `main`), and the checks that bear on what the change touched.

**It runs only what the change can affect.** The paths a change touches
decide its checks, as [`tooling/gate/owed.mjs`](../tooling/gate/owed.mjs)
already maps them. Examples:

| A change to | Runs |
|---|---|
| Chromium (`runtime/chromium`, `tooling/chromium`) | Chromium's own tests and binding checks |
| `runtime/node` | the node module tests and their conformance cases |
| the compiler (`compiler/`, `runtime/c`) | build, lint, the unit tests of the crates it touches and of the backends, and a smoke sample of the conformance suites on C |
| the gate or the lander (`tooling/gate`, `tooling/lanes`) | their own tests |
| tests only | the new or changed tests, on every backend |
| docs only | the tree checks, which take seconds |

A Chromium change never waits for the compiler's suites, and a compiler
change never runs Chromium's.

**Ten minutes or less.** A check that cannot fit moves to the full check.
The smoke sample is a few hundred TypeScript and test262 cases and the
examples, on C; the full suites, LLVM, the JVM and the wide steps run after
landing.

**One queue, no trains.** Changes are checked one at a time, each rebased
onto the newest `main`. Green: `main` fast-forwards and is pushed. Red: the
change goes back to its agent with the failing check's log.

**No per-landing approval.** A green landing check lands. The exceptions are
changes to the compiler's core, the gate and the lander: those wait for the
coordinator to read the diff. The coordinator never reviews evidence.

**Outside contributions land the same way.** Pull requests from other agents
(test families, benchmark ports) pass the same landing check; their records
are written by the full check.

## After landing: the full check

The full check is every step the gate has today, in two parts. Both run at
low priority and within their own memory share, so agents' landing checks
come first.

- **The core** (all suites on all three backends, about half an hour) runs
  on the newest `main` back to back, covering everything that landed since
  its last run.
- **The wide steps** (integrity, the profile, compile time, addons, interop,
  on-device and the rest, about an hour more) run on the newest `verified`
  commit a few times a day, and every night before the benchmarks.

What follows from a run:

- **Green core:** the commit is marked `verified` (a branch of that name,
  pushed). Recordings, benchmarks and anything that needs a known-good
  compiler use `verified`, not the tip of `main`.
- **Red:** the culprit search finds the commit that broke it, among those
  since that part's last green run. The lander reverts that commit (the
  revert passes the landing check like any change), and re-landing it with a
  fix becomes a task.
- **What can be wrong on `main`, and for how long:** only a heavy suite's
  result, and only until the full check finds it: within about an hour for
  the core, within the day for a wide step. A build or unit test that a
  change can affect is never broken on `main`, because the landing check
  runs it.

## Records

The records say how each test case fares on each backend today. They change
in two ways:

- **The full check writes them.** Nobody records by hand. When a case gets
  better (wrong answer to refusal, refusal to pass), the full check updates
  the record itself and lands that update.
- **Getting worse is red.** A case that passed and now fails, or a refusal
  that became a wrong answer, makes the full check red, and the culprit is
  reverted.
- **Records list what does not pass,** by kind (refused, wrong answer,
  abort), not a transcript of every case. A passing case needs no row.

## Benchmarks

Benchmarks run nightly on `verified`, on the CPUs reserved for measurement
(4 and 5), and produce the report with every row and its ratios. A
regression becomes a task. Benchmarks never block a landing.

## The machine

- **A fixed pool of worktrees,** one for each agent that can work at once,
  each with its own build folder kept warm. A task takes a free one at the
  newest `main` and gives it back when it lands, so the next task's build is
  incremental rather than cold, and the disk holds the pool and nothing
  else. Agents do not make worktrees of their own. The shared checkout
  `~/Projects/nts` stays on `main`.
- **One branch per task, deleted when it lands.** A task works on one branch
  named after it. When the change lands, the landing check deletes the
  branch, on the machine and on GitHub, and resets the task's worktree to the
  newest `main` for the next task. An agent rewrites its one branch; it does
  not keep rounds of it (`-r2`, `-before`, `-fold`).
- **No evidence folders.** The landing check's and the full check's logs are
  the evidence; the lander keeps three days of them.
- **The full check counts them.** One of its steps is red when a branch is
  named by no task in [`plan.md`](plan.md), a worktree is outside the pool,
  or `~/.cache` holds an nts folder other than the pool's, the lander's last
  three days, the pins `main` uses, the inputs and the Chromium caches. Rules
  alone let 1,364 branches, 185 worktrees and 120 GB of evidence folders pile
  up by 11-06; a red step does not.
- **Kept on purpose:** the Chromium build caches, because rebuilding them is
  slow.
- **CPUs 4 and 5 stay reserved for measurement;** heavy work runs at low
  priority; a process is stopped by its systemd unit, never by a PID found
  in `ps`.

## Node

`runtime/node` targets Node 26 only; Node 24 is dropped. The node work in
progress lands on `main` as it is: `runtime/node` was never fully working,
and the full check and the task list shape it from there. The one known
defect that hurts the machine (the TypeScript oracle prepares every case's
snapshot before running the first, holding about 17 GB of disk at once) is
the first node task.

## What changes from the old workflow

| Old | New |
|---|---|
| The full gate (7–33 min) before every landing, one train at a time | a landing check of ten minutes or less, then the full check after landing |
| Agents prove a change for hours or days before submitting | agents add tests and submit; the checks are the proof |
| Records recorded by hand, twice, on a pinned compiler | the full check writes records |
| Lanes owning areas for weeks (`tooling/lanes/lanes.json`); multi-day branches | tasks that land within a day; agents per task; a change's checks follow the files it touches, not who touched them |
| Coordinator approval and evidence packets per landing | design agreement before work; risky diffs read |
| Benchmarks and landings competing for the machine | benchmarks nightly on `verified` |
| A separate path for tests-only and docs-only changes | one landing check, which is seconds for them |
| Branches, worktrees and evidence folders that piled up | one branch and one pool worktree per task, deleted on landing, and counted by the full check |

## Getting there

1. **Fresh start.** Agents are on hold with their work committed. The
   branch list, on the machine and on GitHub, is cut to `main` and the
   branches tasks name; worktrees to the shared checkout; agents' evidence
   folders, old pins and run folders are deleted. Every unmerged branch is
   read first: landed or obsolete work goes, and anything still worth doing
   becomes a task naming the branch.
2. **The landing check:** the path-scoped check of ten minutes or less, and
   direct landing from it, which deletes the task's branch and resets its
   worktree. The old lander goes, and the lane machinery with it:
   `tooling/lanes/lanes.json`, the lane view in `lane.ts`, `branches.ts`,
   `cleanup.ts`, `archive.ts` and its table. The one setting `lanes.json`
   holds beyond lanes, which platforms may stay unrun, moves to
   `tooling/gate/verdict-policy.ts`.
3. **The full check after landing:** run continuously, the `verified` marker,
   the automatic revert through the culprit search, and the step that counts
   branches, worktrees and cache folders.
4. **Records written by the full check,** and the worktree pool.
5. **Restart** with agents on the first tasks, as many as the task list
   holds work for in different areas.

Until a part is built, the old lander keeps doing that part's job.

## Until the switch is built

- **Landing:** `node tooling/lanes/land.ts <commit> --dry-run` says what a
  change owes; `node tooling/lanes/land.ts <commit>`, run in the background,
  gates it and lands it.
- **Documentation and test fixtures** go straight to `main`: the coordinator
  commits them holding the landing lock (`~/.cache/nts-land.lock`) while no
  landing runs, after the tree checks (`land.ts <commit> --dry-run`). A
  fixture comes with its records, made twice on main's official pin.
- **A control or a bisect** is a pinned compiler, not a tree:
  `node tooling/conformance/pin.ts <rev>` builds
  `~/.cache/nts-pins/<12 hex>/nts`.
- **What is going on:** `node tooling/lanes/lane.ts status`.
- **A tree's cargo target is its own `target/`:** two trees sharing one run
  each other's compiled crates.

## Decisions

- **This workflow** (11-06): the landing check, the full check after
  landing, tasks that land within a day, agents per task, and the fresh start
  ([log](records/notebooks/decisions-log.md#fresh-start-11-06)). It replaces
  the lane model of record 0355.
- **A cloud agent works through pull requests** under
  [cloud-agents.md](contributing/cloud-agents.md) (10-28,
  [log](records/notebooks/decisions-log.md#contributors-and-packages-10-28)).
- **Reporting:** every benchmark result is shown as it is produced, with its
  ratios against node and Bun, the machine's conditions and the verdict
  (regression, improvement or noise), losing rows included. A fix that adds a
  run-time cost is read for what the compiler could prove instead
  ([log](records/notebooks/decisions-log.md#the-bar)).
- **Measuring** (10-28,
  [log](records/notebooks/decisions-log.md#performance-and-process-10-28)):
  rounds of before, after and before again, over at least 5 processes;
  instruction counts decide regressions; wall time has a floor of max(3%,
  twice the spread); where a row's layout range exceeds the effect, the
  layout-interval instrument decides: at least 20 independent code and heap
  layouts per arm, A/B/A brackets in each, and a 99% bootstrap interval over
  the layouts. An interval wholly below zero is an improvement, wholly above
  zero a regression, and one containing zero is noise
  ([how to run it](../tooling/bench/README.md#layout-intervals)). Every
  comparator's version is pinned (node, Bun, the JDK and clang), and every
  report records the machine's load.
- **Every benchmark run is kept** (10-29,
  [log](records/notebooks/decisions-log.md#the-bar)): each run writes one
  record under `results/benchmarks/runs/`, never edited afterwards, with
  every cell (time, spread, checksum, status), the bar's verdict per
  comparator, and the run's metadata. `results/benchmarks/full.md` is
  rendered from the newest complete run, with nts's best result per row
  beside it, so a row slower than nts's own best shows as a regression.
- **The full check's later additions** (10-28): a weekly run with result
  caches off; native instruction counts gated per benchmark row against the
  noise band; a sanitized, reference-counted differential run over the
  corpus; the compile-time guard extended to code generation and link time;
  result caches keyed on the schema, compiler and runtime digests. Not built
  yet.
- **Platforms:** Apple and Windows programs may stay unrun when their only
  refusals are platform skips. A red that only affects the JVM is recorded in
  `tooling/conformance/jvm-declines.known` and fixed afterwards.
