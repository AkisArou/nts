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
  check leaves, or answers it with a named reason. Task lines remain open
  until `node tooling/full-check/service.ts --answer <id> --issue <N>` or
  `--answer <id> --reason <text>` records that acknowledgement. It agrees designs, reads the diffs of risky changes (the
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
each directory declaration, its reader and its breadth. Module text, including
printed commands and fixture paths, grants no reader reach. Conservative shell
and Python path inference may add checks; it cannot place a path or remove its
full fallback.
`dataDirectory(new URL("directory/", import.meta.url))`, from
`tooling/gate/reader-inputs/main.ts`, declares a data directory: its tracked members
are inputs, not host modules to parse. Entry modules, imports and unbranded
URL assets retain their own production bytes even inside a data directory.
`fileInput(new URL("file", import.meta.url))` declares exact immutable bytes
read as text or data. It retains byte ownership without entering the file's
imports or launches. Only entered modules take part in host-reference traversal;
data members and exact file inputs keep their input obligations without making
their strings or imports into readers. A later real import enters a file even
if an earlier reader reached it as data or exact bytes.
`inspectionDirectory(new URL("population/", import.meta.url))` declares immutable
bytes that a guard inspects. It retains byte-reader obligations for current,
added and deleted members, but inspection alone never places a member or
removes its full fallback. The canonical snapshot keeps placement separate
from byte ownership and module traversal; independent module, file, data and
project declarations retain their placement in either discovery order.
Inspection-owned bytes cannot be substituted by a fixture data grant. The
census reports each directory's role. Declared byte readers survive both prose
precision and explicit execution-reader overrides.
`optionalFile(new URL("candidate", import.meta.url))` declares immutable regular
bytes when present and the exact negative dependency when absent. It grants no
placement or substitution. `directoryMembership(new URL("directory/",
import.meta.url))` declares immediate physical child names and types, including
untracked children. It owns metadata only: it neither copies child bytes nor
places them. Unsupported filesystem types refuse by name. These explicit
metadata readers may name the repository root; ordinary dot-only URL anchors
remain non-readers. The shared graph retains each reader's fixture context.
The copier stages genuine inputs before verifying metadata, refuses symlink
ancestors and validates absent candidates without creating them. A private data
grant changes membership only within that already declared namespace and never
substitutes immutable bytes. Selection compares complete before/after child
membership, including first or last descendants and batched renames, before
prose or records shortcuts. Parsed runner handovers propagate these obligations
alongside byte readers.
The `jvm-members` step owns generated JVM catalogue freshness and reserved-name
exclusivity. Its strict tooling operation scans its declared compiler, JVM
runtime and tooling populations; synthetic controls exercise that same operation.
Rust tests retain member semantics without launching this repository-wide audit.
`projectInput(new URL("entry.ts", import.meta.url))` declares an entry compiled
under its owning TypeScript project. Its runtime descriptor is accepted by the
shared closure copier too. `OracleFilesystem.projectFor` owns discovery and the
pinned parser supplies the actual config reads, inherited configs, project
references and roots. Configs remain leaf bytes; roots enter the module graph.
Discovery runs only for project declarations and is fresh for each graph.
`projectConfig(new URL("tsconfig.solution.json", import.meta.url))` selects the
config named by a compiler command directly, through that same parser.
The parser's filesystem callbacks retain their actual typed answers, including
negative lookups, followed directory entries, real paths and stat mode, size
and Date timestamp. Metadata facts grant no placement or content-open
authority. Captured file reads retain immutable bytes; existence and stat alone
never copy a child. Callback provenance retains the actual link chain and
followed target facts without changing the original answer. Followed parser
entries and physical `directoryMembership` retain their distinct semantics.
Presence and type facts ignore content-only edits, while file reads and file
stats retain byte sensitivity. Structural dependencies survive prose and
records shortcuts and the runner's parsed output handovers.
The graph distinguishes compiled module roots from host-entered modules in
each fixture context. Erased type imports remain source inputs; later host
reach promotes a module and its nested fixtures without losing either role.
An actual Node invocation owner may select the explicit Node 26 package-scope
recipe for host entries, retaining logical and physical scope candidates. This
recipe supplies no Bun resolution authority. The graph shares parsed source
and successful source-file ownership checks only within its own lifetime;
captured filesystem operations remain fresh.
The copier validates original observations before staging and replays them in
the destination after genuine inputs and fixture manifests are staged. A
non-portable stat or other answer refuses with both values and its context;
copying bytes does not certify the source timestamp on the destination. Typed
observations carry no data substitution authority, even under a private
namespace prefix that overlaps immutable inputs.
`moduleMembers(new URL("population/", import.meta.url), "nts.config.ts")`
selects recursively discovered modules with that literal basename, excluding
hidden and dependency paths. The runtime walker consumes the same descriptor.
Its current members enter imports; additions and deletions match only that
basename. An explicit `{data:true}` also retains the population's data and
metadata membership without treating other members as host modules.
`fixtureInput(new URL("entry.ts", import.meta.url), {dataNamespaces: {...}})`
carries a fixture's actual private data grants to both selection and staging.
Only that child's declared data directories may be granted. The graph tracks
module plus namespace context, so independent production reach retains its
production inputs regardless of traversal order. Entries, imports, exact
file inputs and selected module members remain immutable production bytes.
The declaration rows are independent of source language; other reader adapters
can supply the same module and data edges. A shell or Python launch into
JavaScript continues through the parsed module graph. An inferred launch adds
reach without gaining authority to place unknown inputs.
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

Generated-output provenance owns a freshness check, not execution of the
generator by the suites consuming its output. `unicode-freshness` checks the
URL-host transcription with the pinned Node oracle. Its source URL, hash and
version belong to `tooling/inputs/pinned-inputs.json`. Bootstrap explicitly
acquires that input; `node tooling/inputs/pinned-inputs.ts --acquire unicode-idna-17`
does the same on an existing machine. Consumers verify the actual cached bytes
offline on every read. A missing or damaged input is a named setup failure;
it never starts a network request from the gate. An explicit `--data-dir`
still verifies the same source identity. Fixture consumers receive the cache
as a declared content capability or create their own private cache.

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

The JVM verification step compiles its Java driver once into the run's
temporary storage, shared by its sequential runtime and outcomes commands.
Each project still runs in its own JVM with full verification. Reuse keys
include the emitted artifacts, driver source and compiled classes, javac
identity and flags, and the verifier's JDK and execution policy.

Only complete verifier facts enter the artifact baseline store. An existing
baseline that fails the same completeness validation is treated as absent
and pruned under a repair lock before fresh evidence replaces it. A future
format is left untouched. Infrastructure failures remain in the run's logs;
they cannot poison the reusable baseline for unchanged artifacts.

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

When the controller must adopt a newer `verified`, restart takes precedence
over scheduling. It checks at the cycle boundary and immediately before every
core, wide or culprit-probe launch. A busy controller-tree lock leaves the
status at `restarting for verified <sha>` and starts no run. A run already in
flight finishes normally; background units remain adoptable after restart.
A restart request is neither a held run nor evidence against a commit.

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
- **Red:** first, the failed steps are measured freshly on newest main as
  it is, with no pending culprits taken out. Green records the deciding
  commit and probe as fixed forward; nothing is reverted or reopened, and
  the next core checks newest main. A partial fix leaves only the still-red
  steps for the search. The red tip and the last green commit are measured
  again, so a flaky or machine red reverts nothing. The culprit search finds
  the commit that broke the remaining steps among those since the last green
  run. Before any automatic or hand-revert decision, its main probe must
  still cover the current inputs: both endpoint owed rules over subsequent
  changes, including wide reach, decide this. Unrelated commits keep the
  probe valid. Within one search, historical observations are retained per
  step. The same red-step set reuses its search, while a remaining step
  without an established culprit gets its own search. This memo ends with
  the search; newest-main probes always execute freshly.
  Changed inputs get at most two re-probes, then a named hold;
  unknown reach also holds. A false green defers a defect to the next core,
  a cheaper error than reverting a change already fixed forward.
  The full check reverts a still-red culprit (the
  revert passes the landing check like any change), and re-landing it with a
  fix is a task again: the issue the commit names is reopened, with a comment
  that gives the red steps, their logs, the search and the revert. A commit
  that names no issue leaves a task line in the full check's status, for an
  issue. When that part goes green with the commit still in, it
  was no culprit: a revert of it still waiting to land is withdrawn.
- **Task lines stay open until answered.** Status names each unanswered task
  by its stable ID. An issue number or a named reason closes it; the same
  acknowledgement is idempotent, and a conflicting answer is refused. Open
  tasks have no age or count ceiling. Answered rows remain in state history
  for thirty days, with retention decided from the cycle's supplied clock.
  Answer writes share the state file's lock with controller publications,
  which preserve answers received during a run. A retained publication
  sequence distinguishes expired reports from new unpublished ones, so a
  snapshot taken before an answer cannot reopen it after its history expires.
  The controller imports the
  old state only before its versioned state path exists; older processes
  keep writing their old path. The answer command refuses until the new
  controller has published that state, so it cannot freeze an incomplete
  migration while an older run is still in flight.
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
  Before a green run starts recording new rows, the controller refreshes the
  previous records commit's landing answer. A commit that landed or was
  withdrawn during the run settles in that cycle, through the same rules
  used at cycle entry.
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

The fast `records` check classifies the oracle record's identity inputs.
It checks source existence, a source digest wherever the row carries one,
and the normalized workload declaration against the current tree. Explanatory
reasons and formatting do not change that declaration. A changed input makes
the retained record red: the change deletes its fixture record, which makes
it pending for fresh recording. A measured row carries no body-only digest,
so a function-body edit alone keeps its population promise. The check names
the remaining identity inputs that require native plans instead of claiming
to have validated them. Budget provenance separately schedules refreshes.
Missing fixture records appear in the shared pending format, so the controller
starts the core recorder even when no other suite requests those fixtures.

Benchmark run updates are independent by case. The recorder publishes each
completed pending row and accepted update before reporting another case's
failure or incomplete observation. A recorded regression keeps its old row,
an unmeasured case stays pending, and the batch keeps its red or held result.
The controller publishes audited delta rows even when a recorder exits with
a problem; one recorder cannot discard another's evidence.

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
rustdoc respectively. Contributors use `node tooling/gate/inner.ts --no-agree`.
It seals the canonical oracle environment, builds a fresh compiler, sets
`NTS_BIN`, installs the per-binary scratch runner and admits its heavy phases.
It selects the touched crates plus all three backend crates. `inner.ts`, the
shell frontend step, the workspace replay and the doctest step call the same
invocation owner. An executing inner invocation without those prepared
capabilities refuses before Cargo starts and names the contributor command.
Compile-only `--no-run` invocations need no runtime preparation.
The complete seal verifier is a node-only leaf, `differential/oracle-seal/main.ts`,
so checking preparation adds no launcher dependencies to the Rust test steps.

The profile is `nts-dev`: no debug info, incremental compilation, overflow
checks and debug assertions. The owner validates the manifest, refuses
conflicting arguments or environment, fixes one checker per test process,
and keeps `--no-fail-fast`. Cargo's actual compiler-artifact reports must name
files below the selected profile and test artifacts must have no debug info.
A successful command without artifact evidence is an instrument failure.
The shared source audit rejects direct Cargo test calls in other tooling,
including shell calls; isolated cache-pruning controls are classified separately
because they manufacture obsolete artifacts intentionally.

The local Rust input census uses
`node tooling/landing/check.ts <commit> --here --trace-rust-inputs`.
Cargo's artifact report binds each executable to its target source. Temporary
doctest executables run during the original Cargo/rustdoc lifetime; only
profile-owned binaries are recorded for the workspace replay.

The observer records attempted filesystem operations with fresh task image,
cwd and process birth facts. Continuing a notification establishes neither its
result nor a successful exec. Raw and attributed records keep outcomes unknown.
Doctest runtime ownership requires an actual image observation bound to the
recorded process identity. An input-free canceled exit may remain an explicitly
unattributed terminal fact; it grants no image or input. Simultaneously live
byte facts have independent bounded storage through serialization.

The attributed index groups every attempt's original pathname and descriptor
subjects with its notification identity, scalar arguments and actual cwd.
Pathnames retain their unnormalized spelling and pathname/dirfd argument
positions; lexical normalization cannot replace kernel component order through
symlinks. A cwd change updates subsequent anchors while preserving the source
already bound to that invocation. Actual image or argv changes remain distinct
observations, and an entered doctest is not entered again after a chdir.

The index footer identifies the compressed raw artifact by digest and length.
The prepared observer receipt identifies its executable, source digest and ELF
ABI. A coverage consumer authenticates both receipts against retained evidence
before interpreting platform flags. Missing or unsupported ABI evidence keeps
the interpretation unknown. Scalar open/openat flags describe only the requested
access; openat2's uncaptured structure remains unknown. Path-only and
directory-only descriptor requests grant neither a later enumeration nor a
content read, and temporary-file creation retains its write role. A legacy
normalized index must be rederived from raw records rather than treated as
anchored evidence.

Raw artifacts and attributed line records are compressed and published after
their output owners finish. Consumers stream bounded records and accept an
index only after checking its version, attribution, completion counts, native
drain and compressed-stream completion. Partial artifacts describe an
incomplete census. An observation failure is INSTRUMENT and cannot erase a
completed failed Rust assertion or Cargo's failed compile or doctest outcome.
The census keeps the existing product and step bounds.

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
It alone installs process signal handlers. Process-lifetime resources register
named closers through `registerCommandCloser`; explicit scoped owners still
close and await their resources before removing a report namespace. Cancellation
stops acquisition first, while transports remain available for workers' final
replies. Destruction follows reverse acquisition order and joins each resource's
completion even if starting its close throws. Signals, normal return and loop
drain share one terminal cleanup and one wedged-drain guard. A signal keeps its
conventional status; cleanup failures are named and cannot turn a failed command
green. An unsettled main drains its resources and retains exit 13 only if it is
still unsettled at actual exit. Explicit output completion drains resources
before flushing their final reports. A resource-owning command uses
`exitCommand(code)` for an explicit terminal transfer; it unwinds before the
same drain and flush. Its catches first rethrow `isCommandExit(error)`, so they
cannot classify that transfer as an ordinary failure. Resource-free immediate
exits retain their immediate behavior. A gate runner holds its tree lock and
publishes its terminal summary after broker, worker and reservation completion;
a cleanup failure is a non-green `scope_cleanup` result. The source audit checks
listener aliases and dynamic event names against the single entry owner, and
rejects resource owners that bypass the drain or swallow a terminal transfer.
Asynchronous fixture setup belongs in a test hook. Pure command entry scripts
outside Worker closures may use top-level await.
A leaf that an oracle preload reaches lives in its own directory with a one-file
`tsconfig.json`, so importing it never compiles an unrelated aggregate project.
Oracle producers derive emitted runtime modules from stripped imports and
re-exports. Both child bootstrap and completed-result publication use the same
closure compiler; result readers load no preparation or parser dependencies.
Each publication reads fresh source bytes, bounds its module map and releases
one parser lease before visiting another module. Canonical relative module
names and their hashes belong to the authenticated snapshot or result root;
the pinned bootstrap checks the bytes it supplies before a module body runs.


- **An elastic pool of worktrees.** A task takes a free tree at the newest
  `main`, warm first: its build folder is kept, so the build is incremental
  rather than cold. When every tree is held, the pool grows by one, unless
  the disk cannot hold its remaining measured build promise and the gate's floor;
  then `take` says why and exits 75, so a scheduler waits and retries. A tree
  goes back warm when its task lands or is discarded, and the full check's
  hourly upkeep removes free trees idle over three days, keeping two warm.
  Agents do not make worktrees of their own. The shared checkout
  `~/Projects/nts` stays on `main`.
- **One disk capacity owner.** `tooling/gate/disk-capacity.ts` keeps the
  temporary hard floor free beside active build promises. A free checkout
  promises nothing. Taking a cold tree checks and creates its Git lease under
  the capacity lock; landing or giving it back ends that promise. The forecast
  comes from `results/builds/cold-inner.json`, recorded by
  `tooling/gate/build-footprint.ts`: the independently sampled peaks of
  `target/nts-dev` and `target/clippy`, summed and rounded once. Allocated bytes
  in those declared outputs consume the promise as a partial build proceeds.
  Evidence, scratch, obsolete profiles and unrelated target contents never size
  it. The full workspace test owner and Clippy owner record completed profile
  generations; a directory alone and a selected-crate test build do not prove
  completion. Profile values and the pinned toolchain define compatibility.
  Non-pool test and Clippy builds hold claims for their selected outputs in the
  same owner, with process birth identity and dead-owner reclamation. Claims
  for one target merge with its pool promise. Temporary admission reads that
  same remaining promise before admitting an allocation. Fixtures carry a
  private `NTS_DISK_CAPACITY` namespace with their resource capability; an
  absent grant never discovers the account's pool.
- **Git observers preserve the owner's index.** Git arguments run through
  `tooling/gate/git-arguments/main.ts`, which prepends `--no-optional-locks` for
  observations and mutations alike. Required mutation locks remain enabled.
  The shared source-facts audit checks literal or constant-bound Git command
  positions: a call's first argument, an argv vector's first element, a
  probe's command property, and shell command words. Shell and Python argv
  carry the literal option. Selected generated launch sources are checked
  through the same facts. `results/git-observations/unprotected.json` records
  remaining exact source sites; a different unprotected site cannot consume
  a retired site's allowance. `git-observations.ts --record` writes only
  decreases, under its owner lock.
- **Owner locks publish complete identities.** The landing service, its
  observers, disk capacity and cache upkeep share `tooling/landing/lock.ts`.
  A private complete boot/PID/start file is linked atomically to the lock
  path. Normal ownership holds no inherited descriptor. Dead-owner reclamation
  takes a short sibling flock, rereads the identity, and removes only the same
  still-dead owner; its sibling inode remains in place. It also removes
  unpublished candidates whose embedded PID is dead; a reused live PID delays
  collection. Acquisition visits those candidates even when no public owner
  exists. Empty or malformed
  bytes fail by path and contents, with instructions to establish that no
  named process is alive before removing the corrupt file. A process never
  takes over an incompletely published or unparseable owner.
- **One Clippy cache.** Contributors run `node tooling/gate/clippy.ts`. The
  gate and inner route use that same owner with an explicitly selected cache.
  `clippyTarget` declares `target/clippy`; no current test or Clippy route
  builds the obsolete root `target/debug` profile. The cold inner measurement
  covers both compiler/test artifacts and Clippy metadata.
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
  At a step boundary, a run retains the larger of its next known demand and
  its active grants, withheld memory and slack before giving bytes back.
  It never releases the promise before publishing growth, so a later
  neighbour cannot enter between those two operations.
  A pending growth ticket cannot exceed the current rounded, capacity-limited
  gap. If work drains, an excessive ticket is withdrawn before a replacement
  is scheduled. A smaller useful ticket may finish as a partial grant. A grant
  racing cancellation is counted once, and surplus bytes are returned normally.
- **Future state versions are read-only.** Every shared versioned state owner
  checks a recognizable newer numeric version before validating its schema.
  A history gives a named empty view and records nothing; operational state
  refuses by name. A future landing receipt executes the requested checks
  instead of reusing it. Publication and deletion recheck the existing version
  under the owner's same lock, so a stale reader cannot downgrade a newer
  writer's file. Missing and malformed files retain their separate recovery
  paths. Ledger release starts synchronously; `closed` includes its locked
  deletion. Contention waits asynchronously on the parent's retained lock fd.
  A bounded acquisition failure names the failure and leaves the entry for
  dead-owner reclamation.
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
- **Census phase CPU explains the retained step total.** TypeScript and
  test262 backend steps publish disjoint materialization, native capture and
  checking, lowering and preparation, emission, host compilation and linking,
  execution, and comparison observations. Check and emit commands share one
  compiler phase recorder. Worker self CPU comes through `HostObservations`;
  each external tool's CPU comes from its waited-child rusage. Summed worker
  wall is not step wall because workers overlap. The summary retains a signed
  unattributed difference against scope CPU, with its quantization tolerance;
  missing frames or compiler records stay unmeasured. These observations never
  alter program verdicts or replace the step's cgroup accounting. Fixtures
  supply self CPU explicitly, fixed or live; `ownMemory` defaults to fixed zero.
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
- **Case retirement has an owned lifetime.** Worker `close()` starts once;
  `closed` settles after the broker acknowledges the last peak and the owned
  worker scope is removed. The parent run stays until all its workers close.
  Token completion sends done and FIN only after this drain. Command owners,
  serial re-entry and process shutdown await it before returning or removing
  state. A slow live broker delays cleanup; a departed broker or a five-minute
  wedged-peer backstop is a named `tooling-cleanup` instrument failure carrying
  the lease and group. It is never a case outcome. Ledger lock contention
  yields the runner's event loop so it can continue serving these peers.
- **Runner stalls have recorded observations.** `diagnostics.jsonl` retains
  timestamped CPU, memory and IO PSI `some`/`full` avg10 and cumulative
  microsecond counters for the machine, runner cgroup and worker accounting
  root. Cgroup device/inode identity and monotonic counters bind each endpoint;
  missing observations or resets fail the instrument. The worker window starts
  when that root attaches, with no observation claimed before it exists.
  `HostObservations` also owns the wall anchor and native event-loop meters.
  Run, minute and active-step histograms report their own max and p99, with
  count zero and unavailable percentiles for an empty histogram. Minute windows
  close on the first sample after the minute, retaining their actual duration;
  a blocked loop can delay that sample. Delay maxima above one second log their
  detection time and sample window. Shared pressure endpoint deltas on steps
  overlap and are exposure, not additive causal charges. Meters drain before
  terminal publication and scope removal. Imported step diagnostics stay under
  `origin` with their original source run, never as fresh measurements.
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
  Inspectors share `source-facts.ts`'s structural index for each parsed module:
  bindings, scopes, parents, calls, imports and selected generated sources.
  Parse batches hold at most sixteen leases or two MiB of source; a larger
  module is inspected alone, and each lease is released after its inspection.
  Shell command and redirection facts come from the shared shell parser.
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
  Tooling-file guards own their clock and idle scheduler together. The shared
  test entry yields before each case to give queued reports a serialization
  opportunity before a following synchronous body blocks the worker. Its
  scheduler is captured before fixture clocks are installed; the turn changes no deadline.
  Benchmark session controls supply a budget event after child readiness, then observe
  the real named-unit stop and retained record.
  A real sampling control declares a live monotonic clock: a fixed or file
  clock does not advance while its child sleeps. A manually driven bridge
  control advances its supplied clock explicitly after readiness.
  Timer and connection-deadline tests deliver captured scheduler events rather
  than sleeping until a short timeout should have fired. A supplied scheduler
  is borrowed and stays open when its consumer closes; a default scheduler is
  owned by that consumer. Real socket and TLS controls wait on connection and
  completion events, with only a wedged-fixture hang guard.
  Compiled-call supervision supplies its Rust `Probe` with the clock and
  process observations together. After killing an owned group, cleanup waits
  for observed exit under a generous wedged-instrument backstop. Expiry names
  the group and surviving process identities; it never becomes a case verdict.
  The first cleanup result is final: later close and drop calls return it
  without observing again or spending another guard interval.
- **Test children receive an owned environment.** `fixtureEnvironment` in
  `tooling/gate/test-environment.ts` gives each test fixture private HOME, XDG,
  temporary and Git state, reused by its children and removed with the fixture.
  Tools and named run, oracle and resource capabilities are allowlisted;
  unknown shell variables never reach a child. Declared Node, JDK and rustup
  directories precede version-manager shims that consult HOME. Shared
  content-addressed caches are explicit named capabilities from
  `tooling/gate/cache-environment.ts`, including native dependencies, pinned Node inputs, hash-pinned source files, C
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

- **Stall diagnostics preserve scope and time.** Native histograms retain real
  percentiles per window, and PSI retains each scope's identity and cumulative
  counters. Shared exposure is distinct from a causal step charge; all meters
  close before the terminal record
  ([log](records/notebooks/decisions-log.md#runner-delay-and-pressure-11-14)).

- **Derived reader facts preserve the operation and context.** Project callbacks
  and explicitly selected Node scope discovery retain typed non-placing facts,
  alias provenance and immutable byte reads in the canonical graph. Selection
  respects byte, presence and type semantics; staging validates the source and
  refuses non-portable destination answers
  ([log](records/notebooks/decisions-log.md#derived-reader-facts-keep-their-operation-11-13)).
- **Rust input observations separate attempts from outcomes.** Cargo supplies
  source identity; the observer reads fresh task facts and joins native drain
  and stream publication before accepting coverage. Notification continuation
  proves neither a successful read nor exec
  ([log](records/notebooks/decisions-log.md#rust-input-observations-keep-unknown-outcomes-11-13)).
- **Runtime attempts keep their original anchors and ABI evidence.** Grouped
  subjects retain cwd, process identity, scalar arguments and argument positions.
  Cwd changes preserve the bound invocation source. Platform flag interpretation
  requires authenticated raw and observer receipts; missing evidence stays unknown
  ([log](records/notebooks/decisions-log.md#runtime-attempts-retain-their-own-anchors-and-abi-evidence-11-14)).

- **Test event transport gets a turn before each case.** Queued child reports
  get a serialization opportunity before later synchronous work. Completion
  still requires the parent's actual test events. The shared test entry owns
  that boundary, keeping fixture clocks separate from transport and preserving
  the existing idle guard.
  ([log](records/notebooks/decisions-log.md#test-reports-precede-synchronous-work-11-13)).

- **Tests supply scheduling decisions:** firing and cancellation are events
  supplied to the existing scheduling owner; real-process controls prove wiring
  behind readiness. This keeps a loaded machine from changing an assertion's
  meaning and makes borrowed scheduler lifetime explicit
  ([log](records/notebooks/decisions-log.md#test-scheduling-is-supplied-11-13)).

- **Oracle-preload leaves own one-file projects:** shared pure helpers reached by
  an oracle preload live in their own directory with a one-file `tsconfig.json`.
  Their callers use the same source bytes without pulling an unrelated tooling
  project into the public TypeScript compilation.

- **Every Git invocation disables optional index refresh.** One argv owner
  protects command positions without a classification of which subcommands
  only observe. Required mutation locks still work. Existing unprotected
  source sites have a tool-written ceiling that only falls
  ([log](records/notebooks/decisions-log.md#git-observers-never-refresh-another-trees-index-11-12)).

- **Owner publication and reclamation are separate atomic operations.** A
  complete hard-link publication prevents an empty owner becoming visible;
  a short reclamation flock prevents a stale dead-owner read deleting a new
  live owner. Normal ownership retains the existing process birth identity
  and old-format compatibility
  ([log](records/notebooks/decisions-log.md#owner-locks-publish-before-they-can-be-read-11-12)).

- **Controller adoption precedes scheduling.** A pending move to newer verified
  prevents new runs even while the controller waits for its tree lock. The
  restarted controller adopts independent background units; completed runs
  keep their measured verdicts.

- **Verifier setup belongs to the run.** Compiling the driver is shared
  preparation; verification stays isolated by project. A reusable baseline
  requires complete facts on both admission and read, so an infrastructure
  failure cannot permanently prevent reuse after the instrument is repaired.
  ([record](records/notebooks/759-jvm-verifier.md)).

- **Oracle publication owns its emitted module closure.** A runtime import may
  add a nested leaf without editing a second module list. Parsing belongs to
  the producer; SDK-free readers consume canonical, hash-bound JavaScript
  through the pinned bootstrap.

- **Contributor proof uses the prepared inner loop.** `inner.ts` prepares the
  oracle seal, builds the compiler and owns the per-binary runner before
  invoking the shared Cargo owner with the touched crates and all backends
  ([log](records/notebooks/decisions-log.md#contributor-proof-uses-the-prepared-inner-loop-11-12)).

- **A revert requires a fresh as-is main probe.** A historical red can already
  be fixed forward. Search only steps still red on newest main, carry its
  probe only across changes that cannot reach those steps, and bound changed-
  input retries. The deciding commit and run stay with the finding.

- **Count bands are empirical per column:** the calibration owner writes the
  samples, observed ranges and cohort provenance into results. Native
  repeatability stays an instrument check; JIT tiering spread is reported,
  while supplied observations prove its classification. A finite empirical
  range cannot make two real JIT draws a deterministic landing verdict.
  ([log](records/notebooks/decisions-log.md#count-bands-are-empirical-per-column-11-12)).

- **Disk promises belong to active builders** (11-12): Git leases and
  live build claims share the floor and measured declared-output forecast.
  Free trees promise nothing; partial outputs consume their promise and
  compatible completed builds release it. The same owner supplies temporary
  admission. Clippy has one declared cache on every route.
  ([log](records/notebooks/decisions-log.md#active-build-disk-promises-11-12)).

- **Compiled cleanup follows observed ownership.** Inactivity and CPU decisions
  consume supplied observations; real-child controls use readiness barriers.
  Post-kill cleanup has a minutes-scale wedged-instrument guard, rather than
  treating ordinary scheduling delay as failed cleanup
  ([log](records/notebooks/decisions-log.md#compiled-cleanup-follows-observed-ownership-11-12)).

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
- **Generated provenance owes offline freshness:** one input catalog owns
  source URL, hash and version. Explicit acquisition publishes verified bytes;
  every consumer rechecks the payload without network access. Generated bytes
  are compared with the pinned oracle instead of treating a provenance string
  as execution reach
  ([log](records/notebooks/decisions-log.md#pinned-generator-inputs-are-offline-11-13)).
- **Inspection does not establish placement:** `inspectionDirectory` keeps
  immutable byte reads and their precision obligations while the shared graph
  derives placing membership from independent module, file, data and project
  declarations. Repository-wide JVM member checks belong to their declared
  tooling step, with synthetic controls of the same operation
  ([log](records/notebooks/decisions-log.md#inspection-does-not-place-inputs-11-13)).
- **Negative candidates and membership retain their own roles:** optional
  immutable bytes and immediate names/types share the canonical reader graph
  and fixture context without granting placement. Structural changes remain
  owed through prose shortcuts and runner handovers; the copier verifies
  metadata after genuine input staging
  ([log](records/notebooks/decisions-log.md#metadata-readers-keep-structural-obligations-11-13)).
- **Byte ownership and module traversal are separate:** an exact `fileInput`
  keeps production bytes without entering their graph. Data-directory members
  and exact byte inputs enter that graph only when an independent module edge
  reaches them
  ([log](records/notebooks/decisions-log.md#exact-input-bytes-do-not-enter-modules-11-13)).
- **Fixture contexts and discovered members are explicit:** `fixtureInput`
  carries the copier's private data grants into selection. `moduleMembers`
  shares its literal basename with runtime discovery and future path matching;
  a directly selected config uses `projectConfig`. Module text cannot infer
  dependencies, and every module context retains its immutable inputs
  ([log](records/notebooks/decisions-log.md#reader-contexts-replace-module-text-inference-11-13)).
- **Compiled entries declare their project context:** selection and staging
  consume the same `projectInput` descriptor. Discovery uses the oracle's
  existing owner and parsed inputs, with no guessed neighbouring config or
  separate copier option
  ([log](records/notebooks/decisions-log.md#compiled-entry-projects-are-declared-11-13)).
- **Unknown reach and explicit full policies have separate inventories:** only
  the unplaced fallback set is ratcheted. Full-by-policy paths name their
  governing rules, and a rule change owes the full gate
  ([log](records/notebooks/decisions-log.md#unknown-reach-is-separate-from-full-policy-11-12)).

- **Step CPU is versioned cgroup accounting:** final counters include descendants
  killed without reaping. GNU time stays a named comparison. CPU histories and
  trends never compare unlike measures, memory histories remain valid, and
  receipt reuse preserves the original CPU basis
  ([log](records/notebooks/decisions-log.md#step-cpu-is-versioned-cgroup-accounting-11-12)).

- **Census phases account for work before a cheaper design is chosen:**
  compiler commands share one recorder, child CPU is waited rusage, and a
  signed unattributed remainder reconciles known phases to scope CPU.
  Missing observations remain unknown, while worker wall stays separate
  from step wall
  ([log](records/notebooks/decisions-log.md#census-phases-explain-scope-cpu-11-12)).

- **Commands share one signal and shutdown owner:** resources lend named
  closers to the entry, cancellation preserves retirement transports, and
  terminal reports follow actual cleanup. One total wedge guard bounds a
  drain; original failures and signal statuses survive cleanup failures
  ([log](records/notebooks/decisions-log.md#one-command-owner-drains-process-resources-11-13)).

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
- **Task lines require an acknowledgement:** a stable identity and an issue
  or named reason account for each report. Unanswered rows never age out;
  the controller preserves concurrent answers and only answered history
  expires ([log](records/notebooks/decisions-log.md#task-lines-stay-open-until-answered-11-13)).
- **Records refresh their landing answer before new recording:** the answer
  read before a long core or wide run cannot hold back rows after the previous
  commit has landed or been withdrawn. Both checks use one settlement owner
  ([log](records/notebooks/decisions-log.md#records-settle-before-new-recording-11-13)).
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
  and named assets. A fixture that compiles TypeScript supplies the same
  `projectInput` or `projectConfig` descriptor as its compiling reader. The
  shared project owner supplies inherited configs, references and roots;
  nearest-entry discovery remains with `OracleFilesystem.projectFor`.
  Private mutations follow staging. A fixture may grant its own populated
  namespace only at an exact declared data directory. The copier refuses an
  undeclared namespace or any replacement of module-owned bytes, and publishes
  `.nts-fixture-inputs.json` with the relative directory, declaring readers and
  fixture owner. Without a grant it stages the complete declared data input.
  Grants contain owners, never source paths or dependency lists; symlinks may
  name only exact production module inputs, never private data. Package
  installations and shell entry scripts remain explicit inputs. The source audit rejects
  selected dependency lists, manual tails and ad-hoc import discovery, including
  in shared helpers. Complete discovered namespace mirrors and byte-only
  identity fixtures are classified separately; a standalone-entry exclusion is
  checked to have no relative dependency. Supplied oracle test contexts must
  already be sealed with `sealOracleRun`, so captures retain the run's holder
  ownership ([log](records/notebooks/decisions-log.md#fixture-tooling-follows-declared-closures-11-12)).
  Data ownership is separate from module membership, so a synthetic corpus
  cannot hide a new runtime dependency
  ([log](records/notebooks/decisions-log.md#fixtures-own-only-declared-data-namespaces-11-12)).

- **Source inspectors share structural facts.** One bounded parse batch feeds
  the host, publication, fixture-copy, profile and module-lifecycle inspectors.
  A module's structural index and selected generated sources are reused rather
  than traversed separately by each rule. The complete finding inventory stays
  identical when the audit engine changes
  ([log](records/notebooks/decisions-log.md#source-inspectors-share-structural-facts-11-12)).
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
- **Case retirement is asynchronous cleanup.** A worker retains its scope
  until its final peak reaches the broker, and its parent retains the worker.
  `close()` starts the drain; owners await `closed` before teardown and token
  completion. A departed or wedged broker reports an instrument failure by
  lease and group. Contended ledger deletion waits outside the broker loop
  ([log](records/notebooks/decisions-log.md#case-retirement-has-an-owned-lifetime-11-12)).
- **Sampler services have an explicit lifecycle.** A reservation's release
  takes its final reading, records the peak and starts memory release
  synchronously; contended locked deletion is part of `closed`.
  Its sampler starts and stops by message, replies with its final sample and
  exits itself. A scoped owner awaits `closed` before tearing down any state
  its sampler or reporter can use; process-lifetime jobs drain at `beforeExit`.
  A failed sampler still waits for the reservation's locked deletion before
  `closed` rejects. Its named failure is retained, together with any cleanup
  failure; a fixture consumes expected failures before teardown.
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
- **Pinned preparation owns only its build.** `pinned.sh` runs its initial
  release Cargo command through `admit.ts` with the whole-job `pinned-build`
  key and the selected target's scheduling history. That command's process
  ends before gate entry; the runner's normal admission retires the exited
  owner and reserves for itself. No reservation spans both phases, and the
  shell never passes the build handle to the gate. Preparation rusage starts
  after admission, so its duration excludes time waiting for memory
  ([log](records/notebooks/decisions-log.md#pinned-preparation-owns-only-its-build-11-13)).
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
- **A step handoff retains the next demand.** The give-back calculation keeps
  the larger of the next known demand and active grants, withheld memory and
  slack until growth is published. Otherwise a later neighbour can be admitted
  in the release-before-growth gap, before queue order can protect the running
  job. Higher-rank yield still returns everything except live use and its
  margin
  ([log](records/notebooks/decisions-log.md#step-handoffs-retain-the-next-demand-11-12)).
- **Pending growth follows current demand.** The runner withdraws an oversized
  ticket when running work drains, then recomputes its replacement after the
  old request settles. Useful partial grants keep their place; cancellation
  cannot duplicate a grant. Otherwise a fitting next step can wait forever
  behind a stale request that needs more memory than the machine can provide
  ([log](records/notebooks/decisions-log.md#pending-growth-follows-current-demand-11-13)).
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

- **Oracle records own their identity inputs.** The fast records check
  validates the inputs available from the tree and explicitly names those
  requiring native planning. A source-owned population change deletes the
  stale fixture record. Independent completed benchmark updates survive
  another case's incomplete measurement without hiding that failure.
