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

The decisions log is append-only: dated entries go at its end, and a correction
or superseding decision adds a new entry referencing the old one. Its exact
`.gitattributes` rule uses Git's built-in union merge driver, so concurrent
appends keep both entries in landing order. Other documents use normal merges.

Placement follows declared readers: canonical step inputs, collected tests,
static module imports and module-relative `new URL("asset", import.meta.url)`
expressions. A literal containing only `.` and `..` segments is an anchor and
declares no input. A named asset declares the file it resolves to, or every
tracked file beneath it when it resolves to a directory. The census names
each directory declaration, its reader and its breadth. Conservative path
inference may add checks; it cannot place a path or remove its full fallback.
Canonical step directories declare tracked membership as data; their members
are not host modules to parse. The selector shares parsed module references
and input indexes only within one invocation, and reads fresh bytes next time.
Generated outputs use path operations from positional anchors instead of
declaring named module-relative input URLs.
A traced area with no gate reader has a settled rule naming its standalone
reader. An untraced path keeps the full fallback. `gate-inputs` holds the
tool-written inventory in `results/gate/full-gate.json`. Its unplaced fallback
set can only shrink: a newly unplaced path fails by name even if another leaves
in the same change. Full-by-policy paths are listed separately with their
rule names. Those rules govern their reach, and changing `owed.mjs` itself
owes the full gate. `node tooling/gate/owed.mjs --full-census --record` retires
fallback entries and refreshes the policy inventory; it never admits a new
fallback path.

**Ten minutes or less.** A check that cannot fit moves to the full check.
The smoke sample is a few hundred TypeScript and test262 cases and the
examples, on C; the full suites, LLVM, the JVM and the wide steps run after
landing.

**Nothing waits for ever.** Every gate step has a time bound
([`tooling/gate/step-bound.ts`](../tooling/gate/step-bound.ts)): the one its
row states, else three times its recorded cost and the run's over their
slots, at least an hour; in a landing check, at most max(15 minutes, three
times the change's estimate). A tokened step spends this execution allowance
while a case runs or its script works; a known admission wait with no case
running spends none. This includes memory, priority, slots and frontend
admission. The log and summary name these waits. A landing's ceiling always
bounds wall time, including waits. A full-check measurement has an independent
wall ceiling of three times its last canonical green run, with a fifteen-minute
floor. Without that run, its longest measured step supplies the baseline.
The controller owns the ceiling, including for historical runners, and stops
the measurement's whole slice when it expires. The named hold overrides a
summary written before the ceiling. A step past its bound is stopped and held
for a person. A single case past its own bound, a compile past ten CPU minutes
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

- **The core** covers all suites on all three backends on the newest `main`,
  covering everything that landed since its last run. For the exact commit
  checked green by the landing service, it takes that landing's complete
  step verdicts under the same canonical environment contract and executes
  the remaining core steps. A missing or incompatible receipt executes the
  complete core.
- **The wide steps** (integrity, the profile, compile time, addons, interop,
  on-device and the rest, about an hour more) run on the newest `verified`
  commit when it has advanced since their last run and at least four hours
  have passed since that run started. They start only while no landing is
  queued or running and no higher-priority memory request waits. Changes
  coalesce onto the newest verified; skipped opportunities consume no start.
  The nightly run, at 03:00 by default, can cross the gap and repeat an
  unchanged commit before new benchmarks start. It waits for idleness for
  at most two hours after the nightly slot, then enters normal full-check
  admission even while higher-priority work waits. Ledger priorities still
  put landings and agents first. Daytime runs remain idle-only.
  A core already running finishes first. There are no daytime clock slots.
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

The landing receipt names the checked commit and tree, actual outcomes and
coverage, environment identity, producer profile and binary identities.
It is durable before main advances and survives pruning of the original
logs. Samples and narrowed selections leave the full corresponding step
owed. The core's own summary combines imported and fresh results, preserving
their origins and the pending or accepted record notices. Its CPU accounting
separates newly executed work from the original cost of imported outcomes.

The canonical PATH comes from the shared toolchain-directory resolver and
the fixed system directories. The gate selects the pinned Node and declared
toolchain directories before system commands. Launcher-added directories
are discarded. A required command available only through a launcher's PATH
is a missing host capability, named by the check.

The landing and core build tests through the same `nts-dev` profile, so an
exact landing workspace test verdict satisfies the core's test obligation.
The environment contract names that sole test profile and the receipt retains
its producer profile. Fresh consumers and records pins prepare the release
compiler at their measured commit.

Culprit probes look up evidence for the actual measured commit, including
any pending reverts applied to it. Imported outcomes are that commit's own
observations. Fresh confirmation of failing steps still executes those
steps. The core's wall backstop follows a compatible executed plan, so a
short reused run cannot supply the allowance for a later complete run.

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
  the core, and at the next eligible idle run for a wide step. A build or unit test that a
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

**Rows belong to foundation groups.** Each foundation page's `Rows` section
is the canonical declaration, naming case names and never numbers.
`nts-bench --group <name>` measures exactly one group's rows, and
`results/benchmarks/full.md` shows each group together with its standing
against the bar (node and Bun JIT at 0.8x, Bun AOT and ScriptC tied or
beaten). A row no page names is listed as ungrouped. A foundation task's
review covers its whole group, not one row: a part that speeds one row and
slows another in its group is seen in the same sitting.

**Counting compares before and after without the lock.**
`nts-bench --count [case ...]` (also `--count --group <name>`) prints each
selected row's net instruction counts per column. One shared count driver
chooses fixed work from an instruction-count probe, warms the empty and work
processes by that same count, and subtracts the matching empty bracket.
Neither the chosen repetitions nor the subtraction depends on wall time.
The counter runs on any CPU outside 4–5.
It takes no measurement lock and publishes no run record, so agents count
in parallel. The header reads each column's observed repeat range from
`results/benchmarks/count-bands.json`, written by
`tooling/bench/count-bands.ts` from a complete cohort with its provenance.
A move inside that range is unresolved. A JIT's tiering can move outside a
previous cohort's range, so its spread is informational in the real wiring
test; native columns still have a tight repeatability check. Supplied-count
tests prove the classification without making a landing depend on load.
Count claims use the native nts columns; a JIT column's range describes its
cohort, not a limit for before-and-after claims.
Timed rows still come from a
locked session on CPU 4 and keep the wall-time floor below.

- **A measurement waits for CPU 4 with its sibling 5 idle, and for nothing
  else.** Gates, landing checks and agents' work run on the other CPUs and
  never hold it; every row records the machine's load and free memory beside
  it. `tooling/gate/with-lock.sh` admits a run, and nts-bench marks a row
  whose reserved core another program used.
- **Due from the nightly slot until they run.** The slot makes them due on
  the newest `verified`, regardless of daytime wide runs, until they run or the
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

### Rust test builds

`tooling/gate/test-profile.ts` constructs and executes every Cargo test build.
Its `workspace`, `inner`, `frontend` and `doctests` routes select the complete
workspace, explicit crates, the frontend's ignored native invariants, and
rustdoc respectively. Contributors use `node tooling/gate/test-profile.ts inner
-p <crate> ...`, through the normal heavy-job admission. `inner.ts`, the shell
frontend step, the workspace replay and the doctest step call the same owner.

The profile is `nts-dev`: no debug info, incremental compilation, overflow
checks and debug assertions. The owner validates the manifest, refuses
conflicting arguments or environment, fixes one checker per test process,
and keeps `--no-fail-fast`. Cargo's actual compiler-artifact reports must name
files below the selected profile and test artifacts must have no debug info.
A successful command without artifact evidence is an instrument failure.
The shared source audit rejects direct Cargo test calls in other tooling,
including shell calls; isolated cache-pruning controls are classified separately
because they manufacture obsolete artifacts intentionally.

## The machine

Every `.ts` and `.mjs` module under `tooling/` belongs to the single strict
project `tooling/tsconfig.json`. The gate's `tooling-types` step validates its
strict settings and compares its file list with the modules on disk before
checking them. New modules start without diagnostics. The remaining legacy
diagnostics are recorded per module in `results/tooling-types/diagnostics.json`;
counts may only fall. `node tooling/gate/tooling-types.ts --record` writes those
improvements and refuses a rise. The fixture base excludes its own tooling
subtree, while each child fixture still discovers its own sources. Imported
compiler and runtime sources retain their own projects and diagnostic policy.

Imported tooling modules evaluate synchronously. The test-host audit rejects
top-level await in runtime-imported modules and Worker entry closures; a
type-only import does not evaluate its target. A module that is also a command
uses `runAsCommand(import.meta.url, main)` from `tooling/differential/command-entry/main.ts`.
The shared entry owner starts its command only at entry, retains command-owned
diagnostics and statuses, and gives unhandled errors one stderr/exit policy.
Asynchronous fixture setup belongs in a test hook. Pure command entry scripts
outside Worker closures may use top-level await.


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
- **Admitted work keeps its place within its priority.** Growth of an admitted
  job precedes later arrivals of equal rank. A borrower follows its live
  admitted ancestor chain for rank and admission order, and draws on unused
  ancestor bytes before asking for more. The same owner governs admission,
  yield decisions, status and child handoffs. A higher-rank landing still
  preempts an admitted agent job and its borrowers: only live work and its
  margin remain promised to that landing. Independent new jobs retain FIFO.
- **Future state versions are read-only.** Every shared versioned state owner
  checks a recognizable newer numeric version before validating its schema.
  A history gives a named empty view and records nothing; operational state
  refuses by name. A future landing receipt executes the requested checks
  instead of reusing it. Publication and deletion recheck the existing version
  under the owner's same lock, so a stale reader cannot downgrade a newer
  writer's file. Missing and malformed files retain their separate recovery
  paths. Ledger release remains synchronous: if its bounded lock attempt fails,
  it names the failure and leaves the entry for dead-owner reclamation.
- **A job key keeps one measurement basis.** First use binds whole-job or
  worker sizing under the history's flock before admission. `--workers`, even
  a width of one, declares worker sizing; omission declares a whole job.
  A mismatch refuses by name, and publication rechecks the basis under the
  same lock. Samples retain the whole peak and measured width; worker
  forecasts normalize each sample by that width. `steps-v5.json` imports its
  predecessor only while absent. Step rows survive; legacy job observations
  without a recoverable basis and width are rejected with a named count and
  measured again through live accounting. Historical writers retain their
  old namespace.
- **Step CPU includes its complete retained cgroup.** After its processes exit
  and before its scope is deleted, the runner reads `cpu.stat` through
  `HostObservations`. A missing counter fails the instrument. The authoritative
  measure is `cgroup-v2-scope-v1`; the explicitly named `wait4-rusage-v1`
  comparison remains beside it. Step `.time` files are versioned JSON;
  `.gnu-time` retains the raw comparison. Scheduling history retains memory
  peaks across a CPU measure change and starts CPU history afresh. The baseline
  table names each CPU measure, and trends compare only like measures. Landing
  receipts preserve both bases; imported work records zero executed CPU and
  keeps its original measurement in `origin`. Combined summaries partition
  totals by basis. Separate build preparation still names its rusage basis.
- **Pooled cases own their memory admission.** One case lease follows the
  stable step, backend and source path; compiler and content identities do
  not erase its measured peaks. A known case reserves its own peak with the
  ledger's margin. An unknown case is charged live use and that margin.
  Active case promises and fixed steps share the run's admitted reservation;
  a case that needs more asks for admitted growth before starting. The hard
  case cap is separate from this forecast. Before entry, the common worker
  owner raises the worker subtree to hold its admitted case caps; nested
  work cannot enlarge a real enclosing case cap. Each lease keeps its token
  until its final peak is retained and its workers have drained. A kill by
  an ancestor limit names that cgroup, its cap and the case cap, rather than
  claiming host-wide memory pressure.
- **Resource observations belong to the run.** `HostObservations`
  (`tooling/gate/host-observations.ts`) is the resource-reading boundary for
  admission, oracle dependency capture, temporary pruning, the memory ledger,
  step scheduling and the census's degraded-machine decision. Production
  uses the live adapter. A fixture supplies one complete capability through
  `gateEnvironment`'s owned `NTS_HOST_OBSERVATIONS`, together with its own
  memory ledger and scheduling history (`ownMemory` in
  `tooling/gate/test-memory.ts`). Children and peak samplers retain the same
  capability. It supplies disk bytes and inodes, machine memory and paging,
  process and cgroup resident charge, cgroup CPU counters, per-descriptor scope
  peak meters, machine width, load and a monotonic
  clock. A missing observation is a named failure; no field falls back to the
  host. Pure decisions use supplied observations. A kernel wiring control
  explicitly selects live sampling and waits for readiness in its own unit.
- **The gate checks test host ownership.** The `test-host` step audits every
  tooling tests and each entry's dependency and launch closure, including
  generated scripts, shell payloads and Rust fixture constructors. Only named
  adapter modules may read the machine. No reporting exemption is implicit.
  Existing reads outside those owners have a module-and-kind migration count
  that can only fall (`node tooling/gate/test-host-audit.ts --record` writes
  improvements and refuses rises); a fixture environment copy is forbidden regardless of
  that count. Test entry workers start with a complete synthetic
  resource packet. Poisoned launcher inputs pass through the allowlist before
  grants enter the worker; canonical execution flags keep their identity. Child environments must
  come from the allowlist owner. A fixture missing its resource packet fails
  before the production adapter can run.
  Generated child JSON records publish through `durableRecord`
  (`tooling/gate/durable-record.ts`), so existence means complete bytes.
  `test-readiness.ts` checks parsed source reaching script-file or Node eval
  sinks. Exported source factories declare the boundary with the pure
  `generatedJavaScript` brand; arbitrary data and synchronous parent setup
  are outside this rule. The sealed output-oracle driver has one inline
  `publishOracleTerminal` writer using builtins, a unique sibling temporary
  and rename. The audit verifies its complete atomic shape; no other inline
  publisher is exempt.
- **Infrastructure probes are synchronous questions.**
  `tooling/gate/infrastructure-probe.ts` owns their invocation, stdin and
  output limits. One minutes-long wedged-probe guard allows slow healthy
  tools to answer under load. A timeout, signal, spawn error or missing exit
  status is a named tooling-setup instrument failure, never a case outcome
  or a reason to silently fall back. Each caller declares which ordinary
  exit codes it classifies. Fixtures replace the runner with supplied results.
- **Command supervision consumes observations.** `CommandLiveness` in
  `tooling/gate/command-liveness.ts` decides from output, CPU counters,
  busy/sleep state and monotonic time. `active-process.ts` owns the process
  group and pipes and supplies one complete `CommandObservations` capability:
  clock, CPU frequency, initial CPU baseline, activity watch and bounded-entry
  readiness. Startup has its own wedged-launcher guard; execution inactivity
  begins only after the worker enters its kernel boundary. Startup exhaustion
  is a tooling-setup failure with no measured case outcome. A pre-entry failure
  retains its actual launcher diagnostic. An injected
  capability supplies every field; none falls back to the live sampler. Group
  birth identity remains a live safety check. Decision tests replay fixed
  sequences without children. Real-process controls prove sampling, pipes and
  exit wiring behind readiness/release barriers, without asserting how quickly
  the scheduler runs them. Own-process and per-process CPU timeouts, group
  runaway and inactivity retain their distinct outcomes and precedence.
  Tooling-file guards own their clock and idle scheduler together. Benchmark
  session controls supply a budget event after child readiness, then observe
  the real named-unit stop and retained record.
  A real sampling control declares a live monotonic clock: a fixed or file
  clock does not advance while its child sleeps. A manually driven bridge
  control advances its supplied clock explicitly after readiness.
- **Test children receive an owned environment.** `fixtureEnvironment` in
  `tooling/gate/test-environment.ts` gives each test fixture private HOME, XDG,
  temporary and Git state, reused by its children and removed with the fixture.
  Tools and named run, oracle and resource capabilities are allowlisted;
  unknown shell variables never reach a child. Declared Node, JDK and rustup
  directories precede version-manager shims that consult HOME. Shared
  content-addressed caches are explicit named capabilities from
  `tooling/gate/cache-environment.ts`, including native dependencies, pinned Node inputs, C
  objects, case roots, JVM CDS and Node compile caches. A fixture marker travels
  with the declared bundle. Nested fixtures inherit only declared caches; a
  missing cache fails by name before its production resolver runs. Node compile
  caches resolve lazily. Caches are never discovered through the
  fixture's private HOME. A fixture testing cache behavior declares its own
  cache capability. A generated shim declares any additional protocol fields
  or descriptors it forwards.
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

- **Count bands are empirical per column:** the calibration owner writes the
  samples, observed ranges and cohort provenance into results. Native
  repeatability stays an instrument check; JIT tiering spread is reported,
  while supplied observations prove its classification. A finite empirical
  range cannot make two real JIT draws a deterministic landing verdict.
  ([log](records/notebooks/decisions-log.md#count-bands-are-empirical-per-column-11-12)).

- **Every Rust test route uses one profile owner.** The shared Cargo invocation
  uses incremental `nts-dev` without debug info; the manifest, invocation and
  emitted artifact paths are checked. Inner, frontend, workspace and doctest
  routes have the same contract, and landing verdict reuse requires it
  ([log](records/notebooks/decisions-log.md#one-owner-for-rust-test-builds-11-12)).

- **Pooled cases carry their own measured memory**: stable per-case history
  governs admission, while independent hard caps bound workers. Registration
  verifies the kernel boundary before entry, and completion retains the
  token through final observation and worker drain
  ([log](records/notebooks/decisions-log.md#pooled-cases-own-memory-admission-11-12)).

- **Declared readers place inputs; inference only adds reach:** module assets
  use parsed imports and named module-relative URLs. Anchors do not claim
  trees, directory claims are visible, settled areas name their external
  readers, and an unplaced-input inventory refuses silent expansion
  ([log](records/notebooks/decisions-log.md#declared-readers-place-gate-inputs-11-12)).
- **Unknown reach and explicit full policies have separate inventories:** only
  the unplaced fallback set is ratcheted. Full-by-policy paths name their
  governing rules, and a rule change owes the full gate
  ([log](records/notebooks/decisions-log.md#unknown-reach-is-separate-from-full-policy-11-12)).

- **Step CPU is versioned cgroup accounting:** final counters include descendants
  killed without reaping. GNU time stays a named comparison. CPU histories and
  trends never compare unlike measures, memory histories remain valid, and
  receipt reuse preserves the original CPU basis
  ([log](records/notebooks/decisions-log.md#step-cpu-is-versioned-cgroup-accounting-11-12)).

- **Imported modules evaluate synchronously:** commands share one entry owner
  without top-level await, and fixture initialization runs in test hooks.
  Runtime imports and Worker closures are checked from parsed syntax, while
  type-only imports do not evaluate their targets
  ([log](records/notebooks/decisions-log.md#imported-tooling-modules-evaluate-synchronously-11-12)).
- **One strict project checks every tooling module:** the gate validates the
  project flags and complete module inventory, and a tool-written per-module
  diagnostic ceiling accepts improvements while refusing increases
  ([log](records/notebooks/decisions-log.md#one-strict-project-for-all-tooling-11-12)).

- **Wide runs follow verified during idle time**: changed verified can start
  a wide run after a four-hour gap, when no landing is queued or running and
  no higher-priority memory waiter exists. The nightly attempt overrides
  the gap and unchanged-commit check before new benchmarks. After two hours
  past its slot it enters full-check admission without waiting for idle;
  daytime runs remain idle-only. Records and running benchmark units keep their independent
  lifecycle
  ([log](records/notebooks/decisions-log.md#wide-runs-follow-verified-during-idle-time-11-12)).
- **Step budgets count execution and expose admission waits**: an elastic
  step with no active case suspends its execution budget only for the
  runner's known memory, priority, slot or frontend wait. Token transitions
  account for short cases between polls. Case supervisors keep their own
  clocks, fixed steps keep their wall bounds, and a landing's independent
  ceiling includes all waits. The full check's independent run ceiling
  includes those waits too and holds the measurement when it expires
  ([log](records/notebooks/decisions-log.md#step-budgets-exclude-idle-admission-waits-11-10)).
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
  waits for the host's free memory itself. Resource reads go through the
  run's `HostObservations` capability, including dependencies and samplers
  ([log](records/notebooks/decisions-log.md#one-memory-ledger-for-the-machine-11-09)).
- **Tests own their view of the host**: one complete resource capability
  reaches admission, dependency startup, the ledger, scheduling and census
  reporting. Omission fails by name. Decision fixtures supply observations;
  kernel wiring controls opt into live sampling and use readiness barriers.
  Test children receive an allowlisted environment with private state per
  fixture; shared content-addressed caches are declared by name
  ([log](records/notebooks/decisions-log.md#tests-own-their-view-of-the-host-11-11)).
  Command liveness is a pure decision over a complete supplied activity/clock
  capability; kernel group identity and readiness-based wiring stay separate.
  Bounded launch and execution are separate phases: readiness arms inactivity,
  and an exhausted startup guard fails the instrument rather than a case
  ([log](records/notebooks/decisions-log.md#bounded-entry-precedes-execution-inactivity-11-12)).
  The gate checks ownership across dependencies and generated launches, and
  runs tooling entries with strict fixture observations and ambient poison.

- **Fixture tooling comes from its declared closure.** A private test repository
  stages command entries through `copyModuleClosure`, including their imports
  and named assets. A fixture that compiles TypeScript uses its owning-project
  mode: `OracleFilesystem.projectFor` discovers the project, and the pinned
  parser supplies its inherited config files and declared roots, unchanged.
  Private mutations follow staging. Package installations,
  data and shell entry scripts remain explicit inputs. The source audit rejects
  selected dependency lists, manual tails and ad-hoc import discovery, including
  in shared helpers. Complete discovered namespace mirrors and byte-only
  identity fixtures are classified separately; a standalone-entry exclusion is
  checked to have no relative dependency. Supplied oracle test contexts must
  already be sealed with `sealOracleRun`, so captures retain the run's holder
  ownership ([log](records/notebooks/decisions-log.md#fixture-tooling-follows-declared-closures-11-12)).

- **Child records publish atomically.** Generated producers use the same
  durable record owner as their parents. The source audit follows actual
  script and eval inputs and explicit source-factory brands; it rejects raw
  JSON writes. The sealed oracle's checked inline writer preserves its loader
  boundary without an inherited record pipe
  ([log](records/notebooks/decisions-log.md#child-records-publish-atomically-11-12)).
- **Infrastructure probes have one wedged-tool guard.** Short synchronous
  questions to tools use one owner, with a minutes-long bound and named
  instrument failures. They preserve synchronous selection and artifact-key
  APIs. Fixtures supply runner results; per-case product bounds stay separate
  ([log](records/notebooks/decisions-log.md#infrastructure-probes-have-one-owner-11-12)).

- **Measurement admission takes memory and CPUs together**: a measurement
  ticket retains priority and arrival without promising memory. Only a ticket
  ready to take the CPU mutex enters the memory queue; the ledger decision
  takes the mutex nonblocking and admits its memory together. Waiting for
  memory, another measurement or quiet CPUs holds neither. The wrapper is
  the entry point, without an outer memory admission. A measurement inside
  an ancestor's job shares its reservation
  ([log](records/notebooks/decisions-log.md#measurement-admission-takes-memory-and-cpus-together-11-10)).
- **Sampler services have an explicit lifecycle.** A reservation's release
  takes its final reading, records the peak and returns memory synchronously.
  Its sampler starts and stops by message, replies with its final sample and
  exits itself. A scoped owner awaits `closed` before tearing down any state
  its sampler or reporter can use; process-lifetime jobs drain at `beforeExit`.
  A valid final reply also certifies a reservation that ended by handover.
  The exec CLI's watcher samples in a collected sibling scope under the run's
  tooling slice, outside the command service. At command end it moves itself
  into a fresh bounded flush scope before writing history. Failure to create
  the sampling scope refuses before command execution; a final write failure
  names the job and its cause.
  `closed` certifies that shutdown; a missing reply or a wedged
  drain is named, and forced termination is only the bounded fallback. Worker
  entries and their module closures contain no top-level await; command bodies
  belong behind main() entry guards. The test-host source audit checks this
  contract ([evidence](records/notebooks/worker-termination-2026-11-12.md)).
- **Older code never rewrites newer state.** Histories return named read-only
  views, operational state refuses, and incompatible receipts fall back to
  execution. Every update or deletion verifies the version again under the
  same owner lock; exclusive-create and immutable link publication preserve
  existing entries. Missing and malformed state remain separate cases
  ([log](records/notebooks/decisions-log.md#future-state-versions-are-read-only-11-12)).
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
- **Job history keys bind their sizing basis.** A key's first caller declares
  whole-job or worker meaning before admission, and every writer preserves
  it. Each observation keeps its whole peak and measured width. The versioned
  history path retains compatible step observations and names discarded
  ambiguous job observations, without exposing new state to older writers
  ([log](records/notebooks/decisions-log.md#job-keys-keep-their-measurement-basis-11-12)).
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
- **Admitted work grows at its reservation's rank and order:** growth keeps
  an admitted job's place before later arrivals of equal rank, and borrowers
  inherit their live ancestor's rank and place. A landing's higher rank still
  preempts an admitted agent job, so precedence lasts only for that job's
  lifetime and never blocks a landing. Live entry order is unique, including
  when the queue was empty at admission
  ([log](records/notebooks/decisions-log.md#admitted-work-keeps-its-rank-and-place-11-12)).
- **Memory limits guard against runaways only.** A step's supervisor and
  workers have separate sibling boundaries, each with only a MemoryMax,
  about twice what the step was measured to hold and never
  below its grant and a margin, with no MemoryHigh and no swap, so nothing
  throttles a step to its grant. Grants are the ledger's accounting, grown
  from the sampled charge. A step killed at its bound records memory pressure.
  If the machine itself runs out, the kernel kills the full
  check's work first, then agents', and a landing's last
  ([log](records/notebooks/decisions-log.md#memory-limits-guard-against-runaways-only-11-10)).
- **Worker pressure preserves its supervisor.** The retained step root accounts
  for both sibling subtrees. A worker group has `memory.oom.group` enabled,
  so its process family is killed together. The supervisor stays outside
  the workers' cap and records the outcome. Active commands, instruction
  counters and tooling-test workers use the same worker boundary
  ([log](records/notebooks/decisions-log.md#worker-supervisors-outside-case-pressure-11-11)).

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
- **Landing verdict reuse** (11-11): the core accepts complete landing
  verdicts for the exact checked commit and canonical environment, then
  executes its remaining obligations. The combined result keeps each
  outcome's origin. The wide part executes its full plan on verified.
  ([log](records/notebooks/decisions-log.md#landing-verdict-reuse-11-11)).
- **Platforms:** Apple and Windows programs may stay unrun when their only
  refusals are platform skips. A red that only affects the JVM is recorded in
  `tooling/conformance/jvm-declines.known` and fixed afterwards.
