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
   found and reverted automatically, and its task's issue is reopened.
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
- **Streams hold groups; groups hold tasks.** A stream is a `kind:parent`
  GitHub issue named in [the plan](plan.md#streams). A foundation or coherent
  theme is a `kind:group` sub-issue of its stream: it names its governing
  design, acceptance rows or executable contract tests, and wanted parts.
  A task is a leaf under exactly one group, one independently landable
  change for one agent. Questions and unscoped wanted leaves also belong
  under a group. Priorities and stream order stay in `plan.md`; work's state
  lives on its issues. Chores, which no stream owns, are on signalbox's local
  board.
- **`task` means ready to take.** Its paths, completion test, fixtures and
  controls or instrument checks, and dependencies are concrete. A group or
  question never carries `task`. An unscoped, held, parked or needs-user leaf
  stays open without it, with its `state:` label when something holds it.
  A ready card has no placeholder, Parts checklist or unresolved dependency.
- **One spec where issues are made.** Every issue goes through
  `node tooling/tasks/new.ts`, in either its CLI or batch form; both validate
  actual parent roles read-only before writing. The browser forms use the
  same card headings.
  - Labels, from [`.github/labels.json`](../.github/labels.json): exactly one
    `area:`, exactly one `kind:`, at most one `state:`, and `task` only on a
    ready leaf. `node tooling/tasks/labels.ts sync --prune` keeps GitHub's
    label vocabulary equal to the file.
  - A ready task's card, in order: Goal, Why, Paths, Done when, Tests and rows,
    then the optional Depends on, Branch, provenance, Check first and Parent
    fields. Its Parent names its group, and agrees with the GitHub link.
  - A group's card names Goal, Why, Design, Parts, Done when, Tests and rows,
    and Parent. Benchmark membership belongs to the design page's canonical
    Rows declaration, read by the benchmark tools. Planned instruments are
    distinct from existing measured cases; a mechanism task waits for the
    instrument it needs. A contract-only group states why throughput rows
    do not apply and names its executable checks.
- **Check the hierarchy at coordinator checkpoints.** Run
  `node tooling/tasks/audit.ts` at sitting start, before dispatch, after a
  batch of landings or reverts or a design change, and before resuming a
  stream. It only reads: incomplete API data is an incomplete audit, never
  a clean result. It reports parent/card/label drift, cycles, open work under
  closed groups, missing rows and fixtures, dependencies and branch/ref
  problems. Ready work waiting without a branch is queue information, not
  abandonment. There is no periodic structural issue audit and no networked
  issue audit in the compiler's gate; the hourly machine count's minimum
  open-number lookup stays as it is.
- **A task's branch names its issue:** `<N>` or `<N>-<slug>`, by
  `tooling/tasks/branch.ts`. `node tooling/landing/pool.ts take --issue <N>`
  takes a tree on it, and the hourly count names a branch while its issue is
  open.
- **A landing closes its task, not its unfinished group.** A change from
  issue N's branch that does not name the issue lands with `Fixes #N` added
  to its last commit. A slice that leaves its task open says `Part of #N`;
  a change that names its issue either way keeps its own words
  (`tooling/tasks/links.ts`). A group stays open while any wanted part or
  child is unfinished.
- **Undone work stays visible.** Close only when its work is on main, it
  duplicates another issue whose destination retains every remaining part,
  or an adopted decision supersedes it. Name the main evidence, destination
  or decision. Age never closes an issue. A reverted task is reopened by the
  full check and is taken again.
- **Nothing valuable sits on a branch.** Unfinished work on a branch is
  either an open task's, or it is deleted. A commit a record cites by hash
  stays reachable through `refs/cited/<sha>`, a pointer at that commit alone,
  so deleting a branch never breaks a citation.

## Agents

- **Short-lived.** An agent is started for one task and ends when that task
  lands or is handed back as blocked. No agent owns an area for weeks, and
  nothing lives in handover folders.
- **As many as the work and the machine allow.** Areas that touch different
  paths run in parallel: for example two or three agents on the compiler,
  and others on `runtime/node`, Chromium, tooling or tests at the same time.
  The limit is the disk: the pool grows while it can host another tree, and
  each heavy job waits its turn for memory in the machine's one ledger.
- **One message per task:** landed, or blocked and why. No progress reports,
  no evidence packets. The landing check is the evidence.
- **Which agents** (Codex or Claude sessions, started by hand or by
  signalbox) is decided separately; this page does not depend on it.
- **The coordinator** keeps the issues: it makes and slices them with
  `tooling/tasks/new.ts`, and makes an issue of each task line the full
  check leaves. It agrees designs, reads the diffs of risky changes (the
  compiler's core, the gate, the landing and full-check tools) before they
  are queued, starts an agent for each task in the plan's order, and sees
  that an issue a revert reopened is taken again. It works in sittings: each
  starts from the repository, the issues and the two checks' status, and
  leaves nothing that only its transcript holds.

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
| the gate or the landing tools (`tooling/gate`, `tooling/landing`, `tooling/full-check`) | their own tests |
| tests only | the new or changed tests, on every backend |
| docs only | the tree checks, which take seconds |

A Chromium change never waits for the compiler's suites, and a compiler
change never runs Chromium's.

**Ten minutes or less.** A check that cannot fit moves to the full check.
The smoke sample is a few hundred TypeScript and test262 cases and the
examples, on C; the full suites, LLVM, the JVM and the wide steps run after
landing.

**Nothing waits for ever.** Every gate step has a time bound
([`tooling/gate/step-bound.ts`](../tooling/gate/step-bound.ts)): the one its
row states, else three times its recorded cost and the run's over their
slots, at least an hour; in a landing check, at most max(15 minutes, three
times the change's estimate). A step past its bound is stopped and held for
a person. A single case past its own bound, a compile past ten CPU minutes
or a compiled call past its allowance, is a `timeout`: a loud defect,
recorded like any other outcome, so a spinning compile is a finding, never a
stall.

**How it chooses.** Each gate step has a landing form in `LANDING` beside the
rules in `owed.mjs`: the tree checks, the build, lint, unit tests, tooling and
the test262 inventory run as they are; a fixture corpus's steps run when the
change touches that corpus; the TypeScript and test262 suites run as a
sample; everything else runs after landing. A change's landing steps are what
it owes, mapped through that table. An estimate from each step's measured
cost keeps them under ten minutes, moving the costliest deferrable ones to
the full check. `node tooling/landing/check.ts <commit> --dry-run` prints the
landing steps, the deferred ones and the estimate.

**One queue.** One service, `nts-landing-check`, checks changes
one at a time, each rebased onto the newest `main`. Green: `main`
fast-forwards and is pushed, the task's branch is deleted here and on
GitHub (on GitHub it stays while an open pull request is based on it, since
deleting a base closes the pull request), and its pool tree is reset. A
tree that a process still uses (its working directory, executable or an open
file is there; a shell or editor counts too), or one with uncommitted work,
stays on its branch, marked landed in the pool's status, and the pool's next
upkeep resets it once neither holds. Red: the change goes back to its agent
with the failing check's log.

**No per-landing approval.** A green landing check lands. The exceptions are
changes to the compiler's core, the gate and the landing tools: those wait for the
coordinator to read the diff. The coordinator never reviews evidence.

**Outside contributions land the same way.** Pull requests from other agents
(test families, benchmark ports) pass the same landing check; their records
are written by the full check.

## After landing: the full check

The full check is every step the gate has today, in two parts. Both run at
low priority, and reserve their memory at the full check's priority, below
landing checks' and agents', so those come first.

- **The core** (all suites on all three backends, about half an hour) runs
  on the newest `main` back to back, covering everything that landed since
  its last run.
- **The wide steps** (integrity, the profile, compile time, addons, interop,
  on-device and the rest, about an hour more) run on the newest `verified`
  commit a few times a day, and every night before the benchmarks.
- **Records, the benchmarks and the count run beside the parts,** each in a
  unit of its own, so neither part waits for them. A part's records run
  (below) records in `nts-full-check-records-<part>`, in that part's records
  tree, and the nightly benchmarks measure in `nts-full-check-bench`, in a
  bench tree, while the core goes on running on each new `main`; the hourly
  count runs from its own timer, `nts-full-check-count.timer`, whatever the
  parts are doing. The controller names a unit in its state before the unit
  starts, and a controller that restarts finds it by that name: it waits
  while the unit runs, lands what it made once it ends, and starts it once
  more, never beside a running one, when it ended without saying how.

What follows from a run:

- **Green core:** the commit is marked `verified` (a branch of that name,
  pushed). Recordings, benchmarks and anything that needs a known-good
  compiler use `verified`, not the tip of `main`.
- **Red:** the tip and the last green commit are measured again first, so a
  flaky or machine red reverts nothing. Then the culprit search finds the
  commit that broke it, among those since that part's last green run. The full check reverts that commit (the
  revert passes the landing check like any change), and re-landing it with a
  fix is a task again: the issue the commit names is reopened, with a comment
  that gives the red steps, their logs, the search and the revert. A commit
  that names no issue leaves a task line in the full check's status, for an
  issue. When that part goes green with the commit still in, it
  was no culprit: a revert of it still waiting to land is withdrawn.
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
  the record itself and lands that update. It records after the green run
  of the part whose checks hold that record, the core or the wide steps, and
  only what those checks listed: each pending case and accepted change, by
  the record its line names.
- **A records run lands by case.** It records at its green run's commit,
  which `main` has moved past by the time the rows land, so what it wrote is
  a delta, case by case, and `main`'s own `record-pending.ts --apply` merges
  it onto the newest `main`: a row goes in only where `main` left that case's
  row as it was and the case is still the one measured. Every other row is
  said, and waits for the next records run. A records commit the landing
  check refuses or holds is applied again on the newest `main`, a few times
  at most, and then is a task; while it waits, that part records nothing new.
- **An oracle past its own CPU or resident bound has a budget row,** with
  the phase, bound and observed stop, and no invented count. Checks retry it
  and print it loudly. A completed count is an improvement; replacing a count
  with a budget is red. The records pass refreshes a budget after a completed
  check requests it, or its case, Node, producer or bound identity changes.
  A refresh always measures afresh; it reuses no failed execution or count.
- **Getting worse is red.** A case that passed and now fails, or a refusal
  that became a wrong answer, makes the full check red, and the culprit is
  reverted.
- **Records list what does not pass,** by kind (refused, wrong answer,
  abort, timeout), not a transcript of every case. A passing case needs no row.

## Benchmarks

Benchmarks run nightly on `verified`, on the CPUs reserved for measurement
(4 and 5), and produce the report with every row and its ratios. A
regression becomes a task.

- **A measurement waits for CPU 4 with its sibling 5 idle, and for nothing
  else.** Gates, landing checks and agents' work run on the other CPUs and
  never hold it; every row records the machine's load and free memory beside
  it. `tooling/gate/with-lock.sh` admits a run, and nts-bench marks a row
  whose reserved core another program used.
- **Due from the nightly slot until they run.** The slot makes them due on
  the newest `verified`, whatever wide slots follow it, until they run or the
  next nightly slot replaces them; a slot that comes while a night's run
  measures waits for it. They never block a landing, start when the core has
  nothing to do, and measure in their own unit while the core goes on.
- **A session ends with its own outcome.** Its seven-and-a-half-hour observation
  budget includes admission. At the budget it stops its measurement unit,
  retains every completed row, names the cases not reached as `NOT_RUN`, and
  ends the night without restarting. The partial immutable run keeps its
  observations without replacing the newest complete run in `full.md`.
  The containing unit's eight-hour guard bounds a runaway, including finalization.
- **Only a record counts.** An attempt the measurement lock does not admit
  leaves them due, asked again later rather than waited for; a run whose unit
  stopped before it finished (stopped, killed, or past its eight-hour hang
  guard) is started once more, then the night is a task; only a run that kept
  a record counts as measured, and the full check's status says what stopped
  one.
- **A record lands on the newest `main`.** The run measures `verified`, which
  `main` has moved past by the time it ends, so its record is published on
  the newest `main` by `main`'s own renderer (`tooling/bench/run-record.ts
  publish`), and that results-only commit is followed as a records commit
  is: published again on the newest `main` after a refusal, a few times at
  most, and then a task. One night's run is in flight at a time: a night
  measures once the last run has landed or been given up.

## The machine

- **An elastic pool of worktrees.** A task takes a free tree at the newest
  `main`, warm first: its build folder is kept, so the build is incremental
  rather than cold. When every tree is held, the pool grows by one, unless
  the disk cannot hold another tree's target and the gate's 40 GB floor;
  then `take` says why and exits 75, so a scheduler waits and retries. A tree
  goes back warm when its task lands or is discarded, and the full check's
  hourly upkeep removes free trees idle over three days, keeping two warm.
  Agents do not make worktrees of their own. The shared checkout
  `~/Projects/nts` stays on `main`.
- **One branch per task, deleted when it lands.** A task works on one branch
  named after it. When the change lands, the landing check deletes the
  branch, on the machine and on GitHub, and resets the task's worktree to the
  newest `main` for the next task. An agent rewrites its one branch; it does
  not keep rounds of it (`-r2`, `-before`, `-fold`).
- **Where things live:** the pool is `~/.cache/nts-pool/<n>`
  (`node tooling/landing/pool.ts status`); the landing check keeps
  `~/.cache/nts-landing/{tree,target,runs}`; the full check, its controller
  `nts-full-check` running from a tree at `verified` beside its records and
  benchmarks units and the count's timer, keeps `~/.cache/nts-full-check/`: the controller's
  tree, the gate's tree and target, a records tree for each part, the bench
  tree, its state, the count's file and the runs. A tree's cargo target is its own: two trees
  sharing one run each other's compiled crates.
- **No evidence folders.** The landing check's and the full check's logs are
  the evidence; each keeps three days of them. A control or a bisect is a
  pinned compiler, not a tree: `node tooling/conformance/pin.ts <rev>` builds
  `~/.cache/nts-pins/<12 hex>/nts`.
- **The full check counts them.** Its hourly count
  (`tooling/full-check/count.ts`) is red when a branch is named by no open
  issue and not in [`plan.md`](plan.md), a worktree is outside the pool and no task names its
  path, or `~/.cache` holds an nts folder that `tooling/full-check/keep.json`
  does not name with its reason. Rules alone let 1,364 branches, 185
  worktrees and 120 GB of evidence folders pile up by 11-06; a red step does
  not.
- **The full check removes four kinds of leftover itself,** each hour before
  it counts: what a stopped run left in a tool's scratch root past that
  root's age in `keep.json`, with nothing inside it changed since; its own
  pins of commits that are neither `main` nor `verified`, a day old and named
  by no task; the logs of gates run by hand (`~/.cache/nts-gate/runs`)
  past three days, with nothing inside them changed for those three days;
  and an empty nts slice bound to no active unit, stopped by name.
  Everything else the count only reports.
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

## Decisions

- **This workflow** (11-06): the landing check, the full check after
  landing, tasks that land within a day, agents per task, and the fresh start
  ([log](records/notebooks/decisions-log.md#fresh-start-11-06)).
- **The full check sweeps four kinds of leftover** (11-08, 11-09, 11-10):
  stopped runs' scratch past its age by `keep.json`'s rule, its own pins of
  commits that are neither `main` nor `verified`, the logs of gates run by
  hand past three days, and an empty nts slice bound to no active unit and
  older than the count's hour, stopped by name; every other red line stays
  report-only
  ([log](records/notebooks/decisions-log.md#the-full-check-sweeps-11-08),
  [log](records/notebooks/decisions-log.md#hand-run-gate-logs-are-swept-11-09),
  [log](records/notebooks/decisions-log.md#the-full-check-stops-empty-unbound-nts-slices-11-10)).
- **Streams, groups and tasks** (11-10): a stream holds foundation and theme
  groups; a group names its design and rows or executable contracts and
  holds independently landable tasks. Only a ready leaf carries `task`.
  Creation checks the shared card and actual parent roles; the read-only
  hierarchy audit runs at coordinator checkpoints, never periodically.
  Undone work stays visible until main evidence, a retained duplicate scope
  or an adopted superseding decision accounts for it
  ([log](records/notebooks/decisions-log.md#streams-groups-and-tasks-11-10)).
- **Records and the count run beside the parts** (11-09): a part's records
  run records in a unit and a tree of its own while the core runs on each new
  `main`, and a restarted controller adopts it by name; the count runs hourly
  from its own timer and writes its own file
  ([log](records/notebooks/decisions-log.md#records-and-the-count-run-beside-the-parts-11-09)).
- **The nightly benchmarks run in a unit and land on the newest `main`**
  (11-09): nts-bench measures `verified` in a unit and a tree of its own,
  which a restarted controller adopts by name, and its record is published
  on the newest `main` by `main`'s own renderer and followed as records are
  ([log](records/notebooks/decisions-log.md#the-nightly-benchmarks-run-in-a-unit-and-land-on-the-newest-main-11-09)).
- **One memory ledger for the machine** (11-09): every heavy job reserves its
  peak in one queue, in priority order (the landing check, agents' work, the
  full check); a gate run holds one reservation that grows and shrinks with
  its steps; a job yields while one of higher priority waits; and no tool
  waits for the host's free memory itself
  ([log](records/notebooks/decisions-log.md#one-memory-ledger-for-the-machine-11-09)).
- **Measurement admission takes memory and CPUs together**: a measurement
  ticket retains priority and arrival without promising memory. Only a ticket
  ready to take the CPU mutex enters the memory queue; the ledger decision
  takes the mutex nonblocking and admits its memory together. Waiting for
  memory, another measurement or quiet CPUs holds neither. The wrapper is
  the entry point, without an outer memory admission. A measurement inside
  an ancestor's job shares its reservation
  ([log](records/notebooks/decisions-log.md#measurement-admission-takes-memory-and-cpus-together-11-10)).
- **Reservations are measured peaks** (11-09): a step or job reserves 1.25
  times the largest of its last five peaks, sampled on the ledger's own
  basis and kept in its tree's scheduling history. A step never measured
  there uses the largest of its kind, else its share of the machine. An
  unmeasured job is charged live use and margin until its first peak is
  recorded; it borrows no other job's forecast. Nothing declares a number;
  a step's census runs under twice its reservation, never below one
  worker's own cap, so a verdict never depends on the history
  ([log](records/notebooks/decisions-log.md#reservations-are-measured-peaks-11-09)).
- **Proof jobs have stable history keys**: `hir-compare`, `perf-count` and
  `test262-records` name the prepared-HIR corpus comparison, instruction
  counts and five test262 records. Issue numbers belong in labels and logs,
  so a fresh task can use the warm tree's observations
  ([log](records/notebooks/decisions-log.md#unmeasured-jobs-use-live-accounting-11-10)).
- **Reservations yield to a request that outranks them** (11-09): for a
  waiting request's decision, a reservation of lower priority counts as what
  its job uses and a margin, whatever holds it; a landing's build hands its
  reservation to its gate run, so nothing is admitted between them
  ([log](records/notebooks/decisions-log.md#reservations-yield-to-a-request-that-outranks-them-11-09)).
- **A reservation made inside another job's draws on it first** (11-10): a
  request from inside another job's reservation takes that one's unused part
  first and asks the ledger only for the rest, so a holder whose child needs
  memory never waits for itself
  ([log](records/notebooks/decisions-log.md#a-reservation-made-inside-another-jobs-draws-on-it-first-11-10)).
- **Memory limits guard against runaways only** (11-10): a step's slice has
  only a MemoryMax, about twice what the step was measured to hold and never
  below its grant and a margin, with no MemoryHigh and no swap, so nothing
  throttles a step to its grant; grants are the ledger's accounting, grown
  from the sampled charge; a step killed at its bound is memory pressure,
  never a FAIL; and if the machine itself runs out, the kernel kills the full
  check's work first, then agents', and a landing's last
  ([log](records/notebooks/decisions-log.md#memory-limits-guard-against-runaways-only-11-10)).
- **A landing closes its issue, and a revert reopens it** (11-09): the
  landing adds `Fixes #N` from the branch unless the change names its issue,
  and the full check comments on and reopens the issue a reverted commit
  names
  ([log](records/notebooks/decisions-log.md#a-landing-closes-its-issue-and-a-revert-reopens-it-11-09)).
- **Records are evidence, never instructions** (11-09): `docs/records/` is read
  when a page, an issue or a code comment links it, a page holds where the two
  disagree, and search tools skip it through `.ignore`
  ([log](records/notebooks/decisions-log.md#records-are-evidence-never-instructions-11-09)).
- **The landing check is its own tool** (11-07): `tooling/landing/` checks one
  change at a time against the newest `main`, and reuses the step runner, the
  path rules and the canonical environment; which platforms may stay unrun is
  standing policy in
  `tooling/gate/verdict-policy.ts`
  ([log](records/notebooks/decisions-log.md#the-switch-11-07)).
- **Counting is the full check's own hourly step** (11-07), never a gate step:
  the machine's state must not turn a landing red or start a culprit search
  with no culprit ([log](records/notebooks/decisions-log.md#the-switch-11-07)).
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
- **The full check's later additions** (10-28): native instruction counts
  gated per benchmark row against the noise band; a sanitized,
  reference-counted differential run over the corpus; the compile-time guard
  extended to code generation and link time. Not built yet.
- **No result caches** (11-10): the full check runs every case it owes and
  never reuses a verdict from an earlier run
  ([log](records/notebooks/decisions-log.md#the-compiler-is-made-fast-not-cached-11-10)).
- **Platforms:** Apple and Windows programs may stay unrun when their only
  refusals are platform skips. A red that only affects the JVM is recorded in
  `tooling/conformance/jvm-declines.known` and fixed afterwards.
