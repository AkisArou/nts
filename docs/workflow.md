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
`acceptedRevisionData(new URL("path", import.meta.url))`, from
`tooling/gate/accepted-revision-data.ts`, declares data read only
from captured accepted-main blobs. Its opaque value can be consumed only by
`acceptedRevision(repo).show` or `.grep`; that owner resolves `refs/heads/main`
once, exposes its read-only revision and always passes that commit to Git.
It returns content or a named unavailable observation.
The source audit refuses every other use of the descriptor. These reads create
no candidate-tree byte, membership, placement or staging obligation. Independent
working-tree readers of the same path retain all their own obligations.
`inspectionDirectory(new URL("population/", import.meta.url))` declares immutable
bytes that a guard inspects. It retains byte-reader obligations for current,
added and deleted members, but inspection alone never places a member or
removes its full fallback. The canonical snapshot keeps placement separate
from byte ownership and module traversal; independent module, file, data and
project declarations retain their placement in either discovery order.
Inspection-owned bytes cannot be substituted by a fixture data grant. The
census reports each directory's role. Declared byte readers survive both prose
precision and explicit execution-reader overrides.
`conservativeDirectory(new URL("types/", import.meta.url))` declares a
deliberately wider dependency while a reader lacks a precise model. Its row
keeps the conservative role and reader context. It owns immutable current
regular bytes and recursive presence/type facts, including absent roots, but
grants neither executable placement nor private data substitution. Symbolic or
unsupported traversal refuses by name. The census lists tracked paths under
these roots with their readers and steps, separately from full-gate fallback.
An intersecting path can also have a precise reader. A conservative namespace
never replaces an exact component kind/link check during runtime assessment.
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
`optionalModule(new URL("driver.mjs", import.meta.url))` uses the same exact
presence owner, then enters a present module's real imports under its enclosing
host/context role. Rust command declarations retain their Cargo module
authority; compiled-only visits cannot become host entries accidentally.
`directoryCandidates(new URL("cases/", import.meta.url), candidates)` retains
physical shallow membership and each child's followed directory test. Literal
candidate rows keep optional bytes, followed path existence, regular-file tests
and directory tests distinct. An empty list retains only the enumerator and its
directory filter. These metadata reads supply no module placement.
The `jvm-members` step owns generated JVM catalogue freshness and reserved-name
exclusivity. Its strict tooling operation scans its declared compiler, JVM
runtime and tooling populations; synthetic controls exercise that same operation.
Rust tests retain member semantics without launching this repository-wide audit.
`projectConfig(new URL("tsconfig.solution.json", import.meta.url))` selects the
config named by a compiler command. The pinned parser supplies its actual reads,
inherited configs, project references and roots. Configs remain leaf bytes;
roots enter the module graph.
The graph acquires one project API lazily and owns its close. Each request
still gets a fresh filesystem transaction and full Program with the declared
config's original options. The pinned Program owns per-usage import/require
conditions, package goals, explicit resolution-mode attributes, ambient roots and actual source
edges. Authenticated installed SDK observations remain capabilities, separate
from repository ownership.
Each Program transaction produces its context-free reader identities and pin
facts once. A compiled-program request also captures the emitter's nearest-config
lookups; other project roles keep their declared config semantics. Snapshots
compose these detached facts under their own reader and namespace context,
unioning causes and refusing conflicting answers. Composition performs no new
physical identity capture. Projecting consumers retain their compact roles as
each target arrives. The batch retains distinct replay answers and authority
descriptors instead of complete target snapshots. Scope-end validation still
replays every distinct answer under each authority and checks project matches,
source ownership and populations before returning any projection. Failed scopes
release their validation state. Full-snapshot callers retain independent mutable
results. A later scope constructs fresh Programs and captures fresh identities.
Only a declared config or generated Program can retain an absent `node_modules`
on a strict ancestor of the source root as a host-environment observation.
Its descriptor names the request, config and Program's unresolved imports and
explicit types; it does not attribute a callback to one import. Every replay
checks the exact negative answer and physical absence. These facts remain keyed
but contribute no repository reach. Present external paths and ambient or
untagged external observations refuse.
`generatedProject(configURL, directory, include)` first honors a supplied case
config; its fallback uses the declared extends file and exact directory or
TypeScript-tree include recipe at a real private ConfigDir. Only the prepared
config's known private facts are derived; other callbacks retain their original
repository or SDK provenance. Cleanup preserves read and cleanup failures.
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
each fixture context. Clause-level type imports are erased runtime edges; explicit compiler projects
own their type inputs. Named type-specifier lists retain their side-effect
imports under Node stripping. Later host
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
The config audit builds its workspace project in the run temporary. One input
list combines its workspace data namespace with the exact external declaration
files the project reads, and serves both discovery and staging. Staging copies
current tracked bytes, including working edits, in repository-relative layout;
ignored build output stays out. The compiler observes the private tree afresh.
An external reference missing from that declaration fails the private build
instead of silently reading outside the step's selected inputs. Diagnostics are
captured inside the staged lifetime; staging and cleanup failures remain errors.
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
admission. Nor does CPU that other work takes from the step: the runner
samples the step slice's `cpu.stat` and `cpu.pressure` `full` (time it had
runnable tasks and none of them ran) every 500 ms, and that lost time spends
nothing. `some` is not read, because a step whose threads outnumber its CPUs
would excuse itself. The excuse is a lower bound on the CPU taken: the kernel
averages a cgroup's stall over the CPUs it was busy on, so only a step on one
CPU is excused exactly, and the step's launch (its scope's creation and entry
check, before its own work is in its slice) is not excused at all. Each sample
is one observation: the counters and the moment they describe. A sleeping or
hung step spends its bound at wall rate. A CPU bound backs it: the bound times the slots the step may hold, which
stops a step whose threads outrun its width. The log and summary name the
waits, the lost CPU and the CPU it ran. A landing's ceiling always bounds wall
time, including waits.

**A full-check run is held when it stops progressing, never because higher
ranks slowed it.** Its bound
([`tooling/full-check/measure-command.ts`](../tooling/full-check/measure-command.ts))
is spent by the same owner as a step's (`ProgressBound`). Every second it reads:

- the run slice's CPU (`cpu.stat`);
- the time its tasks were runnable while the CPUs ran other work
  (`cpu.pressure`);
- its waits in the memory ledger (`ledgerWait`);
- its runner's step lifecycle ([`run-lifecycle.ts`](../tooling/gate/run-lifecycle.ts)).

Its ledger waits and CPU lost to other work spend nothing. A ledger wait is
its own request that could fit were every admitted job to end, or a yield to
higher-ranked requests that the ledger's own decision would not admit even
were the run's reservations and requests to end, because they wait on other
work's memory (a small request queued behind a blocked head included). A yield to a request that
waits on the run's own memory is no wait: a hung holder would excuse itself
for ever. Nor is a request that could never fit, which waits for memory nobody
reserved. IO and memory pressure are not progress. A temporary's disk wait is
named, never excused: [`TemporaryAdmission.acquire`](../tooling/gate/admission.ts)
is its one waiting loop. It records the request in the disk capacity's waits
for as long as it waits, with the build promises and temporary claims that
hold the disk, and reports its refusal and its admission once each. The bound
reads the wait whose owner runs in the run's slice. A held reason says how
much of the stall it took and names those holders. What holds the disk, an
idle task tree's build promise among them, may never end on its own, so the
wait spends the stall bound. The run is held when any of these is reached:

- **Stall bound.** It has *stalled* (neither run, been runnable nor waited) for
  three times its last canonical green run's wall, at least fifteen minutes;
  without that run, three times its longest measured step.
- **Lifecycle bound.** No step has run, started or finished for its stall
  bound, at least forty-five minutes so that a cold release build fits,
  counting neither its own waits nor CPU that higher ranks take. This catches a spinner outside every step's own bound:
  in setup, in the release build, or after the last step. A runner older than
  its lifecycle publishes none and has no such bound.
- **CPU bound.** It has used three times that green run's measured CPU, at
  least fifteen minutes of the whole machine; without it, three times its
  steps' baseline CPU. This is the backstop a slowed run cannot reach. A run
  with a step that has no baseline and no green run behind it has no CPU bound.

The bounds start when the run's command is in its slice: its scope reports
that with a readiness byte before it becomes the command, so the
measurement's own setup (its slice, and the scope it asks the user manager
for) is not the run's. That setup has its own hang bound, and a setup that
ends without the run holds it, naming the stage it reached.

There is no wall bound: every wait it excuses ends when the admitted work it
waits on ends, and that work has its own bound. The run
folder's `measurement-progress.json` is kept up to date while the run lasts.
`service.ts --status` shows from it what the run has run, lost and stalled
against its bounds, and its ledger wait (its own request with what is queued
ahead of it, or the request it yields to) and since when, so a wait that never ends is seen while it lasts. The held
reason names the bound and the measured progress. The controller owns this bound, including for
historical runners, and stops the measurement's whole slice when it expires. Tooling and measurement slices
are created explicitly before their first member, with `BindsTo` and `After`
naming the creating process's user-manager scope or service. The same transient
creator owns gate roots and step slices. An empty start and a live nested child
retain their owner; ending that owner unit stops its whole hierarchy even after
SIGKILL. Explicit cleanup remains the normal path. An unbindable shell gets a
named setup refusal with the exact `systemd-run --user --scope` rerun command;
no slice is created unbound. The named hold overrides a
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

**Choosing is heavy work, and it is ledgered.** Evaluating the rules at both
endpoints holds a few GiB, so every selection reserves through the memory
ledger under one key, `landing-selection`, sized from that key's measured
history in the tree it selects for, at the rank its caller's code names
(`tooling/landing/selection-memory.ts`): the service's is a landing's,
`--here`'s and `--dry-run`'s an agent's. A dry run therefore waits its turn
like any agent job, says what it waits for as it starts waiting, and yields
to a landing. The service and `--here` hand the selection's reservation on
to the run it chose: the build's reservation takes it over, or, with nothing
to build, the gate run's first request does, so nothing is admitted between
choosing the steps and running them.

**Installed packages are current before a step runs.** The landing service's
tree preparation links each tip with its own linker, which republishes the
tree's installation catalog. `check.ts <commit> --here` runs in an agent's
tree as it stands, so it reads that tree's catalog through its owner
(`installationCatalogState` in `tooling/inputs/dependency-inputs.ts`) before it
selects anything. A missing catalog, or one whose pins no longer match the tree
(after a rebase, say), is a refusal naming the
`node tooling/inputs/linker.ts work` command that republishes it. A tree with
no package graph owes no catalog.

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

The full check is every step the gate has today, in two parts. Runs normally
reserve their memory at the full check's rank, below landing checks and
agents. Culprit probes and core runs advancing stale `verified` use the
existing `culprit-search` rank, below landings and above agents, as specified
in [The machine](#the-machine).

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
  queued or running and no higher-priority memory request waits. Wide work
  and its culprit probes also wait while the controller's benchmarks measure,
  as reported by retained ownership or the actual benchmark unit. An unreadable
  unit observation refuses by name. Changes coalesce onto the newest verified;
  skipped opportunities consume no start.
  The nightly run, at 03:00 by default, can cross the gap before new benchmarks
  start, unless a missed benchmark night gives benchmarks the next start. A wide run of the current verified commit answers that night when it
  starts at or after the latest nightly slot, whatever its verdict, or ends
  at or after the slot with green or red. A held straddling run leaves one
  rerun due; that rerun's post-slot start answers the night even if held again.
  Missing or invalid completion evidence uses the start rule alone.
  The start time still owns the four-hour gap;
  verified advancement retains its existing eligibility. The nightly run waits for idleness for
  at most two hours after the nightly slot, then enters normal full-check
  admission even while higher-priority work waits. Ledger priorities still
  put landings and agents first. That deadline never overrides the benchmark
  exclusion. Daytime runs remain idle-only.
  A due core eligible for the stale-verified rank goes before a due wide
  run on the verified it would supersede. The owed wide yields once for that
  verified; if the core stays red or held and verified does not advance, the
  next eligible wide start goes first even when main moves again. The full
  verified SHA of that postponement survives controller restart. A different
  verified ignores and clears it; advancing verified or starting wide clears
  it too. Postponement consumes no wide start, minimum gap or nightly idle
  deadline. Status names the owed wide and the core it waits for. After a
  green core, wide follows the new verified under the same schedule. With
  verified current or no eligible stale core due, wide keeps its usual slot.
  A run already in flight finishes first. There are no daytime clock slots.
- **Records, the benchmarks and the count run beside the parts,** each in a
  unit of its own. The core continues beside them; wide work waits for benchmark
  measurement. A part's records run
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

Between cycles the controller awaits a timer owned by its command lifetime.
Shutdown clears the timer without starting another cycle. An active measurement
is interrupted through the controller unit's control group and its bound
measurement scope; an interrupted measurement stays held.

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
  probe valid. Historical observations are keyed by base commit, sorted revert
  composition and step, with their original run provenance. A main move never
  discards these observations; ordinary historical probes can reuse them in the
  next cycle, while fresh confirmations still execute.
  The first newest-main probe extends the original red run's range only when
  its remaining failed steps keep the identities read from that red run's log.
  A partial fix may narrow that set; a newly failed step never extends it.
  Otherwise the original red commit is confirmed freshly. A flake stays flaky;
  a known identity change holds, naming the old and current identities. Missing
  original detail keeps the original range's search, with a named explanation
  in the search log and Finding. An extended Finding uses its actual tip,
  candidate count and that tip's measured run together.
  The search finishes its historical bisection before checking main again.
  When changed inputs reach the failed steps, it measures the newest decision
  tip once. The range extends through that tip only if no new step fails and
  every remaining step's canonical failure identity equals the previous tip's.
  A partial fix narrows the search to those remaining steps. Identity is
  the sorted complete REGRESSED, CHANGED and MISSING verdict-detail rows from
  census comparison sections, including case names and verdict changes. Progress,
  timing and run paths outside those rows are not identity. Truncated or missing
  detail proves nothing; two missing identities never compare equal. A known
  identity change on any step takes precedence over missing detail on another.
  A green decision tip records a fix forward and reverts nothing; a changed
  failure, unavailable identity, unknown reach or a non-extending first-parent
  history holds by name. If main moves during the decision probe, unrelated
  inputs carry the observation through the new tip; affected or unknown reach
  holds with the current tip's identity unmeasured. Thus one attempt is finite
  even when main moves after every probe. A revert names only a commit in the
  original or extended first-parent range, with identity proven through current
  main. A false green defers a defect to the next core, a cheaper error than
  reverting a change already fixed forward.
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
  At landing replay, a full-check records submission's oracle shards are held
  to the same fixture and generator source digests at the measured commit and
  the new base. A changed fixture's shard edit is dropped and named as left
  pending; other records still land. If no edits remain, the submission is
  withdrawn. Ordinary task commits retain their fixture and record edits.
- **One records run is one transaction over its families.** Families record
  in the table's order in one tree. The run keeps its own write ledger: each
  record path it changed from its committed bytes, with the bytes it left.
  Later families treat those content edits as rows of the same delta, not as
  source edits; a path already dirty when the run first touched it, or changed
  after the run wrote it, is not in the ledger. At apply, a row derived from
  committed sources that another ready row of the same delta changes is
  skipped with that path named, and the next records run takes it up. A family
  whose pending, source or source-digest question fails is its own counted
  problem: the run is red, and every other family still records and applies.
- **An oracle past its own CPU or resident bound has a budget row,** with
  the phase, bound and observed stop, and no invented count. Checks retry it
  and print it loudly. A completed count is an improvement; replacing a count
  with a budget is red. The records pass refreshes a budget after a completed
  check requests it, or its case, Node, producer or bound identity changes.
  A refresh always measures afresh; it reuses no failed execution or count.
  Persisted budgets use version 2: phase, outcome, bound and signal only.
  Per-run CPU readings and error text remain in raw evidence. Budget producer
  identity binds runtime recipe and package content, independently of installer
  implementation provenance. An unchanged classification keeps its record bytes.
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
to have validated them. A measured row's driver digest is recording provenance,
not a freshness key: every execution checks its complete generated count.
Budget revision separately schedules refreshes.
Missing fixture records appear in the shared pending format, so the controller
starts the core recorder even when no other suite requests those fixtures.

A whole program (a source with no case to call, such as a launch row's
`case.ts`) is pending only after its compile-time declines. A module-scope
statement lowering cut, or a host the deterministic harness cannot run it on,
is decided by the compiled program alone, and no row can change it. So the
check declines it in the same words before and after its `program` row is
recorded (`whole_program::compile_time_decline` in
`tooling/differential/src/whole_program.rs`). A newly added whole-program row
with a cut is therefore red at its own landing, unless it is listed with its
refusal and owning task (a launch row in `LAUNCH_DECLINES`,
`tooling/gate/verdict-policy.ts`). Otherwise the first red would be the records
commit after it, and the culprit search would blame that commit.

The landing tree check `benchmark-identities` uses the compile recorder's
`--check-identities` mode. It computes each benchmark's resolved options,
roots, sources and local data, plus the existing compile-driver key, and holds
all three backends' compile rows to those identities. It invokes no compiler,
linker or workload, requires no compiler binary and publishes no records.
Missing new cells are pending; changed source or driver identities and missing
recorded cases fail. Compiler source and binary identity are provenance, not
row validity: a compiler-only edit keeps current rows current. Measured compile
outcomes remain the responsibility of `benches` and the full-check recorder.

Benchmark run updates are independent by case. The recorder publishes each
completed pending row and accepted update before reporting another case's
failure or incomplete observation. A recorded regression keeps its old row,
an unmeasured case stays pending, and the batch keeps its red or held result.
The controller publishes audited delta rows even when a recorder exits with
a problem; one recorder cannot discard another's evidence.

The memory census is an observation family, not an outcome ratchet. A home
change is neither better nor worse. A record whose source or static producer
recipe changed is listed pending for a new observation after landing; it does
not make the check red. Malformed, forged, internally inconsistent, corrupted or foreign
records remain red. Only an unchanged observation from accepted main may use
an older identity to request refresh; a new or edited row whose source or
recipe identity disagrees with the tree is red, even with a matching payload
SHA-256. Each canonical memory-group program owns one JSON record under
`results/memory-census/`. The full check writes requested records independently
through the ordinary per-case delta transaction. A landing's records check
validates structure, identity and integrity only; it does not run the compiler.
The records check lists a missing or stale observation as pending. A current
row whose compiler provenance is unknown or differs requests native refresh:
`refresh requested: <family>: <program> in <record>`. The shared parser and
full-check controller treat this line generically, separately from missing
rows and accepted outcome changes. Refresh-only green logs start a records
unit. The census family uses `pending` for missing/stale rows and the existing
`refresh`/`refreshLine` hooks for current rows needing rederivation.
A row already measured with the known current clean pin, with matching source,
recipe, compiler commit and actual binary digest, requests no redundant refresh.
The pin must name the tree's current source revision; an old sidecar cannot
suppress requests while the new compiler is still waiting to build.
An unavailable or unpinned compiler remains unknown; the tree-only records
check never builds a compiler or trusts an earlier target binary. The recorder
receives its known green-run pin through its prepared environment. Requested
rows are natively rederived and differing observations replace their rows,
without ranking homes. An observation never changes a better/worse verdict.
Identical projections retain their bytes and original compiler provenance.

Its selection identity binds the census version, the program's actual inputs
and the instrument's own static recipe. The shared Program input owner derives
the selected roots, resolved source and JSON imports, ambient types, package
goals and inherited configs from the real project, using the benchmark's own
config or the shared generated-project recipe. No compiler/runtime tree or
hand-picked namespace approximates these inputs. Each records check or recording/apply
transaction reads each program once through that owner. Its detached facts are
revalidated before reuse, including failed lookups; no persistent Program cache
is introduced. The static producer inputs
are `compiler/core/src/hir/memory.rs`, `memory/report.rs`,
`memory/census.rs` and the CLI's `src/main.rs` and `src/arguments.rs`; the records recipe is the census writer, its family and
the shared benchmark project recipe. These exact inputs are declared once by
the production owner and are staged through `copyModuleClosure`.

The census reader has no declarative benchmark Program input reach in the owed
graph. An imported file outside the case can therefore change without selecting
the census check at landing. Each green core still requests native rederivation
where the current producer is unknown or differs, and census observations
decide no better/worse verdict.
Benchmark Program declarations belong to the shared `projectMembers` owner;
recording identity reads do not provide that declarative reach.

Compiler commit and exact binary SHA-256 are provenance, outside the source
and recipe selection identity. They suppress a redundant native refresh only
when the current clean pin is known and matches; they decide no verdict.
A writer requires a clean compiler pin
whose recorded binary digest agrees with its bytes. The core records run
rederives requested censuses after a green core, which keeps observations true
across compiler changes. An identical projection retains its original bytes
and provenance; a differing projection replaces it without ranking homes.
The observation also records its JSON SHA-256, source URIs and content digests.
At delta application, selection identity and canonical group membership are
checked again. The record envelope's version is independent of the census
wire version and changes when its fields or meaning change.

## Benchmarks

An agent's evidence sitting uses `nts-bench --sitting <dir>`, with a fresh
`~/.cache/nts-scratch/<N>/sittings/<id>/` directory outside the repository.
It retains sealed JSON and `full.md` through the ordinary measurement,
validation and renderer, and commits nothing. Cite its path and SHA-256 in the
record. A sitting identifies itself in both outputs and cannot be published.
This replaces running a published run and dropping its results commit. The
nightly command omits the flag and continues publishing official records.

Benchmarks run nightly on `verified`, on the CPUs reserved for measurement
(4 and 5), and produce the report with every row and its ratios. A
regression becomes a task.

Build details travel with each completed row, including failed builds and
journal recovery. External build stages retain exact waited user and system
CPU from the shared child-rusage owner, including waited descendants, while
case-bound remains their only CPU and inactivity supervisor. A bound kill
may prevent final waited accounting; that stays unavailable, with the last
own-CPU sample separately labelled "sampled at bound" and the failure reason
retained. Sequential nts capture, preparation and emission retain only the
calling thread's CPU, explicitly excluding shared checker CPU. These build
observations do not decide throughput verdicts. Old immutable run records
without the optional versioned build details keep their original shape.

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
  measures waits for it. When the previous slot ended without a measured
  record, benchmarks on the newest `verified` start before the controller
  starts another core, wide or records run. A running run finishes; culprit
  probes keep their rank. The overdue state survives restarts and unsuccessful
  attempts, and clears only when a record is measured. A stored due slot after
  an unmeasured prior night derives a missing overdue marker on read; explicit
  markers are preserved. Controller start order changes no memory rank: landings never wait for benchmarks, and a stale
  core keeps its culprit-search rank. Once the benchmark unit starts, core
  and records continue beside it; wide waits for its measurement.
- **A session ends with its own outcome.** Its seven-and-a-half-hour observation
  budget includes admission. At the budget it stops its measurement unit,
  retains every completed row, names the cases not reached as `NOT_RUN`, and
  ends the night without restarting. The partial immutable run keeps its
  observations without replacing the newest complete run in `full.md`.
  The containing unit's eight-hour guard bounds a runaway, including finalization.
- **Only a record counts.** A held measurement lock queues the nightly attempt
  through `with-lock --wait` at full-check priority within its observation
  budget. A higher-ranked sitting goes first; release admits the queued night
  without a new controller request. A wait that exhausts the budget ends
  unmeasured with its refusal reason retained. Other admission refusals leave
  benchmarks due for a later attempt, keeping the log, outcome and reason in
  status. A run whose unit
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
The admitted compiler preparation builds selected doctest prerequisites in
that same target and `nts-dev` profile with the doctest route's `-- --list`
mode. It compiles Cargo libraries
and dev dependencies while rustdoc only lists examples. The executing doctest
step requires the successful build receipt for its working directory, selected
crates, profile and target. Cargo's freshness check validates current inputs;
the first non-fresh artifact stops the Cargo command. A doctests-only
selection prepares those prerequisites without building compiler binaries or
reporting an unselected build step; its doctest result retains preparation evidence.
Pinned runs and landing prepare them inside their existing shared build
lifetime. Direct selections use that same admitted build owner before taking
step scopes; retries retain the receipt. The scheduled build and doctests
reuse the prepared artifacts. A selection without doctests performs no
doctest preparation. The
build's disk claim includes `nts-dev`, shared with existing claims for that target.
The complete seal verifier is a node-only leaf, `differential/oracle-seal/main.ts`,
so checking preparation adds no launcher dependencies to the Rust test steps.
Rust and TypeScript oracle consumers require that inherited sealed image;
neither launches a dependency producer when it is absent. A missing seal names
`inner.ts --no-agree` or the gate route. Acquisition and resource controls
belong to the tooling producer fixture, which executes from its own staged
Git source. Staging and production fences never become Rust-test reads of the
real repository. Git-fence descriptors consume their owner's indexed candidate
population and its ignore/attribute controls, without executable placement.
Standalone oracle command entries use `withPreparedOracle` at their boundary.
It takes their admission, creates the canonical run and uses the same sealing
owner as the gate. Resolver state belongs to the entry's own temporary, with
its root identity and live owner birth pinned independently of the dependency
image. An unsealed sibling acquires a fresh scope. A valid inherited seal for
the same source consumes the parent's exact live scope without closing it.
Completed holder metadata is terminal evidence, never a reusable live session.
For another source, preparation treats the parent's image as a candidate inside
the owned handoff. Matching producer, lockfile and validated installation inputs
reuse that existing immutable image under a handoff bound to the new source;
otherwise preparation builds an image as usual. Reuse neither rewrites the
parent's records nor changes its image or resolution-helper lifetime. Seal
version 2 binds source and revision as well as image identity; both TypeScript
and Rust readers refuse an older shape by name. Commands that
read ambient environment values re-enter once with the complete sealed
environment; callbacks can instead receive it explicitly. The command lifetime
drains children and newly acquired resolution services before releasing its
admission, temporary and complete entry run on every terminal outcome. Internal workers remain consume-only and validate
their sealed-parent handoff. The host audit inventories command entries and
shell Node invocations and refuses consumer reach without one of those owners.
Report decoding and identity readers import pure leaves, independently of
execution and command entries. Modes that compute or compare an oracle-dependent
identity prepare before doing so, including checkpoint resume and report modes.
Usage, error and listing modes that compare no oracle identity do not prepare.
Each standalone entry validates and names its command options as source-owned
values. In an inherited canonical handoff, an option outside that entry's list
must equal its inherited owned value or refuse by name before admission; it
cannot silently become a default during preparation or same-source reuse.
Resolution services receive that exact planned environment. Their session
reports actual Node arguments and received `NODE_OPTIONS`; validation compares
those launch facts with the intended options. Token acquisition validates its
owned-value packet before requesting capacity. A later binding failure releases
and joins the granted lease before propagating the error.
The dependency image archives installation metadata and named workspace command
targets, together with the installed third-party packages. Importer directories
are not installation inputs. Workspace aliases retain their verified installed
layout but resolve to the selected live consumer closure in each oracle snapshot;
unread workspace implementations receive no runtime grant. A command-target edit
changes the installation identity because pnpm reads its shebang when linking.

The profile is `nts-dev`: no debug info, incremental compilation, overflow
checks and debug assertions. The owner validates the manifest, refuses
conflicting arguments or environment, fixes one checker per test process,
and keeps `--no-fail-fast`. Cargo's actual compiler-artifact reports must name
files below the selected profile and test artifacts must have no debug info.
A successful command without artifact evidence is an instrument failure.
Current-source Cargo invocations go through `tooling/gate/cargo.ts`. Both `config` and
`config.toml` must be absent from Cargo's working-directory ancestor chain and
its declared `CARGO_HOME`, before launch and after the child drains. A present
configuration or an unreadable observation is a named tooling-setup refusal.
Caller `--config` and working-directory overrides are refused. The complete
Cargo home remains a shared content cache, including its existing registry,
download, lock and garbage-collection state. Nothing is copied or relocated.
The same owner asks `rustup override list`, with the declared `RUSTUP_HOME`,
before and after the call. An override on a guarded cwd or any ancestor,
an incoming `RUSTUP_TOOLCHAIN`, or a caller `+toolchain` refuses. Unknown or
unreadable rustup output also refuses. Cargo-produced replay environment is
retained; the toolchain-override check uses the incoming caller environment.
The Rust test replay retains this guard through completion, including each
binary's supplied scratch root; Rust Cargo children must use a checked root.
Historical code is checked by its current parent: endpoint queries and pinned
run lifetimes use the same owner over their tree and supplied scratch roots,
before entry and after drain. A pinned checkout is checked again before any
historical code runs. The parent never rewrites historical code.
The shared source audit rejects direct Cargo test calls in other tooling,
including shell calls; isolated cache-pruning controls are classified separately
because they manufacture obsolete artifacts intentionally.

The local Rust input census uses
`node tooling/landing/check.ts <commit> --here --trace-rust-inputs`.
Cargo's artifact report binds each executable to its target source. Temporary
doctest executables run during the original Cargo/rustdoc lifetime; only
profile-owned binaries are recorded for the workspace replay.

`rust-runtime-inputs.json` binds Cargo source/name/kind identities to shared
reader rows. The structural Rust module owner retains module directories and
literal path attributes; every traversed reader needs a row. Compile-source
edges alone grant no runtime-byte authority. Unit and library-doctest routes
remain independent, including doctest-only libraries.

Selection consumes the same canonical graph as explicit post-run validation.
Its writer, mandatory derivation, delta source-key check and gate-inputs Rust arm
use the selector's clean committed-source owner and verified endpoint installation.
Gate-inputs passes that source's tree and revision explicitly through its graph
options and memo context; its non-Rust graph still observes the caller tree.
Ignored working outputs never enter the Rust key; the candidate record body remains independently
bounded and authenticated. The working-tree fence around a keyed assessment
(pending, mandatory check, writer and delta source key) is bounded by the
record's key: the declarations, content edits at paths the key observes, and
membership changes beneath a declared membership or byte/alias ancestor, and
Cargo input names. Structural changes also replay the key's typed filesystem
queries and compiler project matches against fresh committed-source answers.
An unchanged directory kind or identity grants no recursive membership reach;
a nonmatching addition leaves the Program query unchanged.
A tracked edit elsewhere, such as another record, is not a source change; hand
dirt on a declared input refuses, as does a HEAD that moves during assessment.
Gate-inputs, which has no key on its live path, fences the whole tracked tree
except the selector record. Its tool-written selector record interns portable paths
and consumed roles;
the key validates source bytes/modes, engine, Cargo and SDK identities, exact
typed answers, candidates, aliases and populations. Fast selection requires
bytes identical to an independently acquired accepted main blob and a current
key. The range selection owner acquires main's record blob once and passes it
explicitly to both private endpoints. Reuse requires the endpoint's record blob
to match and its working bytes to equal the bounded immutable Git body. Missing
trust is explicit, never discovered from a candidate ref or environment. The
trust blob is part of every memo key that depends on the record decision.
Landing's range controls exercise the real selector with one Rust crate and
its verified installation catalog. The wide `integrity` step owns the complete
source-population control through the exact tooling-test ownership table and
the ordinary scoped test runner; it is excluded from landing's tooling group.
Missing or stale accepted records log their kind/path, remain pending and
use a live projection. The full check refreshes pending records after landing.
The owed CLI's self-test and requested selection share one committed Rust-source
lifetime and trust context. Their JS graph still observes the working tree;
the Rust graph observes that committed source. The source fence closes and its
temporary drains before the selected work runs. Independent endpoints retain
their own graph and source lifetimes.
New record bytes require an actual rebuild comparison before gaining future
authority; malformed payloads and unverified stale candidates refuse by name.
The byte-bounded reader decodes untrusted material without acquiring a compiler.
Key validation replays project discovery through one lazy, closed native
parse-only session; it constructs no Program. Its identity hashes only the
path bindings referenced by the key, in canonical order. The complete path
table and selection roles remain bound by the payload hash and accepted blob.
Acquisition-only observations stay in the live snapshot for race and native-claim
validation; the shared selector role projection omits them before persistence.

Interned paths, roles and two fixed levels of ordered blocks use content-derived routing IDs, so a
new input cannot renumber existing references. Every ID is checked against its
row and duplicate IDs refuse; these short IDs grant no authentication authority.
Targets share blocks of block references as well as the leaf role blocks. Both
levels are bounded, preserve order and multiplicity, and cannot recurse.
The complete payload and key retain SHA256 authentication. The committed file
bound has headroom over the measured stable format; packed history growth,
rather than the uncompressed file size alone, determines this representation.

Stopped exec capture retains argv and environment under one combined kernel
string budget, with a separate per-string limit. Native storage grows only with
observed bytes and lives through serialization. The shared protocol owner
supplies native limits and finite hex-frame and raw/index row bounds. Raw
observation version 7 and attributed index version 10 accept these larger rows;
older versions retain their original row bound. Null, unreadable and truncated
vectors remain explicit facts; an unavailable environment cannot certify a
child loader receipt.

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

The decision report counts setup attempts and subjects discharged by a declared
input, literal argument or authenticated execution fact. It retains full
normalized details for every uncovered subject and unresolved probe. Its footer
accounts for retained and discharged subjects separately; the reader rejects
inconsistent totals. The independently authenticated raw stream retains every
attempt, including those represented only by counts in the decision report.

## The machine

Every `.ts` and `.mjs` module under `tooling/` belongs to the single strict
project `tooling/tsconfig.json`. The existing `tooling-types` step also checks
the product projects declared by `tooling-type-projects.ts`, each under its own
platform declarations and strict options. Node host bindings have a checked-JS
project with `allowJs` and `checkJs`; WPT and ICU use their owning projects.
The JVM generation entry has its own project. The registry and read-only pending
discovery have no checker or oracle execution dependency.

The checker validates each project's settings, complete owned population and
Program membership. A removed project, an existing omitted module or a disabled JS
owner refuses before diagnostic counts can fall. Only the owner's no-entry
observation permits a deleted source to leave its inventory. New modules in recorded
projects start without diagnostics, so renaming a module with diagnostics
requires fixing those diagnostics. Records include zero-count inventories and
are keyed by project and module in `results/tooling-types/diagnostics.json`;
diagnostic limits may only fall. A newly registered project without a row is
pending and does not fail landing. After the green core run, the full check's
ordinary `record-pending` cycle writes its first measured row. The existing
`--record` writer refuses an increase in any established project or module.

Each project's measurement identity covers the compiler's actual input reads,
its options and population, and the checker recipe. A source edit is checked
again against the established limits; it does not reset them. The records delta
holds the same identity, so a changed binding invalidates a stale measurement
before application. The fixture base excludes its own tooling subtree, while
each child fixture still discovers its own sources. Product type defects are
recorded debt owned by their product tasks; checking adds no behavior changes.

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
The Node harness's declaration and path helpers are sealed runtime source in
`oracle-node-harness.ts`, included in the shared execution inventory and native
identity. They use Node's strip-only transform and never enter a user Program
or discover a project config. Prepared consumers use the loader's authenticated
runtime export. Direct conformance probes use the same source through the
pinned Node's strip-only loader. The runner owns that choice and binds the
fixture accessor before loading a test. Non-erasable syntax refuses by source name;
the tooling strict checker owns the source's type checking.


- **An elastic pool of worktrees.** A task takes a free tree at the newest
  `main`, warm first: its build folder is kept, so the build is incremental
  rather than cold. When every tree is held, the pool grows by one, unless
  the disk cannot hold its remaining measured build promise and the gate's floor;
  then `take` says why and exits 75, so a scheduler waits and retries. A tree
  goes back warm when its task lands or is discarded, and the full check's
  hourly upkeep reclaims idle build output while keeping two warm targets;
  an unbuilt idle checkout is removed through Git.
  Agents do not make worktrees of their own. The shared checkout
  `~/Projects/nts` stays on `main`.
  A held task's worker presence is explicit: `pool.ts detach <branch>` marks
  it without giving back its checkout; `pool.ts attach <branch>` and taking
  an already-held branch attach it again. Agent hosts call detach after their
  worker ends or parks, and attach before recovery/resume; a host that only
  reads status must attach separately. Hosts without these hooks leave trees
  attached. Detach refuses live process, unit, resource-lock or disk-claim
  owners by name. The pool writes a versioned, atomic, branch- and worktree-bound
  `<slot>.worker.json` beside the tree's lease. Missing state is the normal
  attached default, with no diagnostic. Corrupt, mismatched or unknown-version
  state protects it as attached with a named diagnostic; the hourly count
  reports that diagnostic. `status --json` version 2 reports
  attached, detached or unknown presence without changing it. The task's Git
  branch and checkout remain held in either worker state. Ending the hold by
  reset or checkout removal also removes its presence record; a future-version
  record refuses either mutation.
- **One disk capacity owner.** `tooling/gate/disk-capacity.ts` keeps the
  temporary hard floor free beside active build promises. A free checkout
  promises nothing. An attached held tree promises its remaining cold build;
  a detached worker promises none. Taking a cold tree checks and creates its
  Git lease under the capacity lock; worker detachment, landing or giving it
  back ends that promise. Resuming a detached or landed tree admits any cold
  or partial remainder under the same lock and capacity equation as a new take,
  protecting that target during pressure reclamation. Both take and attach
  make a landed tree held before releasing the lock, so its admitted promise
  is counted before another take can spend that capacity. A refusal exits 75 and
  leaves its presence and hold unchanged for retry. A take or attach whose tree
  resource lock a gate run or disk reclamation holds refuses the same way,
  exit 75 naming the tree, before any change to its branch, checkout or
  presence. Taking or attaching an
  already-counted lease is idempotent, with no new admission or publication,
  even under disk pressure or while its tree resource is in use. Complete
  output adds no promise. A resumed
  task or explicit build rebuilds missing output through normal build admission.
  The forecast
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
  for one target merge with its pool promise. One build is admitted once: an
  owner that admitted a build hands its admission to the command doing that
  build (`NTS_DISK_BUILD_ADMISSION`), as the landing check does to
  `tooling/gate/build.ts` and `build.ts` to its doctest preparation. A handed
  admission that covers the build's target and outputs is not admitted again,
  so a disk that moves between the two never refuses work its owner admitted;
  one that does not cover them admits the uncovered build on its own. A handed
  admission whose owner no longer holds it is a `tooling-setup` instrument
  failure, never a fresh admission. Only its owner releases it, and a
  launcher's admission never reaches a new landing run. Temporary admission checks and
  durably claims its measured byte allowance under that same capacity lock.
  Its explicit lease stays held through preparation, publication and resource
  drain, then releases in `finally`; a denied attempt owns nothing. Temporary
  claims carry PID and birth identity and use a separate versioned file, so
  older build-claim writers cannot overwrite them. Dead holders are reclaimed
  by the same owner liveness check. Build, pool and temporary admissions all
  subtract these live promises before granting new capacity. Fixtures carry a
  private `NTS_DISK_CAPACITY` namespace with their resource capability; an
  absent grant never discovers the account's pool.
  The configured pool outputs and admitted capture temporaries share one
  filesystem; this capacity namespace accounts for that filesystem as a whole.
- **A denied build measures nothing.** Disk capacity refusal is a typed
  `disk-capacity` instrument result, with the actual target, outputs, shortage,
  floor and outstanding promises. Every build route preserves that result;
  missing Cargo artifacts cannot replace its cause. The run drains and releases
  its memory instead of waiting or repeating under the same reservation.
  The full check holds and uses its normal retry, without a culprit search.
  A disk-held landing waits beside the queue, allowing no-build changes past.
  Claim releases, pool lease changes, upkeep and reclaim wake the service to
  re-read the capacity owner's full snapshot. Once its equation permits the
  request, the entry returns at its original arrival position. Readiness never
  admits a build, caches a capacity projection, or guesses from elapsed time.
  The service intentionally stays up while a disk-held entry exists; status
  names it and its last measured shortfall. Withdrawal answers this already
  drained entry immediately, and the service exits when no work remains.
- **Pressure reclaims rebuildable disk state.** DiskCapacity explicitly reclaims
  before admission and during upkeep; status reads do not delete. Inventory
  and recursive allocated-byte measurements run outside the pool lock. Fresh
  ownership fences, a durable manifest and a same-filesystem rename into
  `nts-pool/.disk-trash/<uuid>/payload` run under it; permission traversal and
  recursive deletion run after release, holding only that entry's kernel
  drainer lock. Git's removal child inherits its descriptor, so an exited
  parent cannot expire the lock while that child still removes bytes.
  The manifest preserves the approved removal kind and physical identity.
  Reclamation rechecks each listed trash entry under the pool lock before
  classifying it and acquiring its drainer; an entry its owner retired is
  skipped. It resumes interrupted entries, including partial deletions, before
  considering new candidates. A rename credits no capacity: only observed disk
  free bytes enter admission, so undrained trash still consumes space. A grant
  reacquires the pool lock and recomputes current promises before publication.
  Pool status and its JSON show trash bytes and age; reclamation names drains
  older than an hour as stuck. The count recognizes only the owner's trash
  directory and manifest-backed UUID/payload worktrees, and never deletes them. Below the floor plus live promises and one measured cold build, it
  removes in cost order until another cold build of headroom is free: obsolete
  whole profile generations, clean unbuilt pool checkouts, then free pool build
  output while keeping two compatible warm targets, then held trees' Cargo `target/`
  whose workers are explicitly detached, oldest detachment first. This last
  kind runs only under pressure, never from elapsed idleness. Free and
  detached held targets containing unknown siblings offer their recognized
  Cargo profiles separately:
  a Cargo cache tag or a validated owner completion marker proves the profile.
  Unknown siblings remain by path, with their writer where known; they cannot
  veto removal of an independently proven profile. Each profile removal holds
  both pool and tree locks through detachment and repeats the physical, claim
  and owner checks; neither lock spans byte deletion.
  Taking the tree afterwards rebuilds missing output normally. Admission
  refusals include their removal and retention decisions, including the warm
  minimum. The hourly count reports retained target siblings by path and
  known writer without granting deletion. Held target removal preserves
  branches, commits and uncommitted work outside `target/`. Its whole-target
  grant requires Cargo cache identity, recognized build contents and no tracked
  target files; each independent profile grant requires its own provenance
  and no tracked files inside that profile.
  The landing and full-check trees offer
  only obsolete generations, never their current build output. Unknown or corrupt
  generation markers keep the candidate. A removed checkout must be Git-detached, clean,
  registered and have no unpublished commits; ignored local data also keeps it.
  Git moves an unbuilt checkout into trash under the pool lock and removes
  it outside the lock, preserving its worktree registry. A removal refusal
  keeps its registration, payload and manifest; it never falls back to
  recursive filesystem removal of a registered worktree.
  Each removal rechecks physical root identity, the resource lock, leases, build
  claims, unit working/root directories and ExecStartPre/ExecStart/ExecStartPost
  paths and arguments, and process cwd/exe/open files. Unit environments and
  argument-file contents are outside this guard. Readable process owners
  always count. A non-dumpable process with a readable cgroup outside every nts
  or agent unit is excluded with its PID, birth and cgroup in the audit facts;
  unreadable nts processes and unreadable cgroups keep the root by name.
  Held-output removal rereads its branch registration, worker presence and
  live claims beside the final ownership and identity checks under both pool
  and tree locks. A detached record cannot override a live owner, including
  ledger jobs' processes, units, working directories, executables or open files.
  Old-boot claims and locks confer no ownership. One JSON line in the pool's
  `.disk-reclaim.log` names each removal, its tree and task for held output,
  allocated footprint, observed free
  space change and checked ownership facts. These byte measures have separate
  meanings when other jobs or filesystem sharing affect free space. Scratch,
  evidence, shared corpora and unknown cache roots have no deletion grant.
- **Git observers preserve the owner's index.** Git arguments run through
  `tooling/gate/git-arguments/main.ts`, which prepends `--no-optional-locks` for
  observations and mutations alike. Required mutation locks remain enabled.
  The shared source-facts audit checks literal or constant-bound Git command
  positions: a call's first argument, an argv vector's first element, a
  probe's command property, and shell command words. Shell and Python argv
  carry the literal option. Selected generated launch sources are checked
  through the same facts. A local function that passes its own parameter
  directly to `child_process.spawn`, `spawnSync`, `execFile` or `execFileSync`
  takes that command as its required identifier first parameter and uses
  ordinary call syntax, so its callers retain the same audited command
  position. Constructors and accessors cannot own these forwarders. This
  lexical convention grants no command meaning
  to ordinary string data. `results/git-observations/unprotected.json` records
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
  takes over an incompletely published or unparseable owner. A bounded lock
  wait raises a `tooling-setup` instrument result naming the lock path,
  holder PID and birth identity, and its unit when known. A build or temporary
  claim release that exhausts this wait logs the named holder and defers
  cleanup until the claim owner exits; it preserves the finished command's
  result. The unreleased claim continues to reserve capacity until then.
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
- **Gate binaries stay while their runs hold them.** `tooling/gate/binary-pins.ts`
  publishes immutable executables in `~/.cache/nts-gate/bin-v2/<sha256>` and records
  each run's holder under that folder's `holders/`. The folder digest covers
  the sorted executable names and content digests; compiler provenance remains
  the compiler's own digest. The summary records both and every member digest.
  Reuse verifies members while leased, outside the lock, and never rewrites them.
  The holder binds its run,
  token and boot/PID/start identity. Copies and hashing happen outside the
  cache-wide owner lock, as does complete holder-record preparation and flushing;
  publication, holder acquisition, recency, reclamation
  and pruning share that lock. Retention keeps every held folder and the ten
  newest unheld folders. The runner releases after its workers, scopes and
  reservation drain on success, failure and signal. Terminal reporting never
  acquires a holder. A killed owner leaves a lease that can be reclaimed only
  after a fresh identity proves the original process gone; an unreadable
  identity or malformed or newer holder state protects the folder. The hourly
  count names unreclaimable leases. Lock wait and hold durations are observations
  in the run's compiler identity, never verdict inputs.
  Private staging directories publish a versioned boot/PID/start identity and
  unique token in their names at creation, before any payload bytes. Pruning
  reclaims only proven-dead stages under the same lock after rechecking their
  directory identities and names. Live stages remain named notices; unknown,
  malformed and older unnamed stages remain protected warnings. A detected
  member mismatch records a versioned corruption diagnostic and does not refresh
  recency. The count reports corruption without hashing payloads under the lock.
  Malformed or future diagnostics protect the bundle from retention deletion.
  The sibling legacy `nts-gate/bin` root remains isolated from these leases:
  historical gates can prune only their own root. Both roots have `kept` rules;
  no existing age-based sweep proves a legacy run gone. The count reports legacy
  content folders as leftovers without granting deletion.
- **No evidence folders.** The landing check's and the full check's logs are
  the evidence; each keeps three days of them. A control or a bisect is a
  pinned compiler, not a tree: `node tooling/conformance/pin.ts <rev>` builds
  `~/.cache/nts-pins/<12 hex>/nts`.
- **A gate temporary ends with its run.** One run temporary owner closes after
  children, resolution helpers, scopes and reservations drain, before terminal
  reporting. Success, failure and signal all discard the authenticated `tmp/`.
  Its systemd backstop binds to the creator's exact unit and invocation and runs
  after that unit stops, including a forced stop or an interrupted start.
  The bound step hierarchy drains before the creator. Delegated affinity scopes
  still need that creator binding ([#994](https://github.com/AkisArou/nts/issues/994));
  the backstop retains its live-holder refusal on that path.
  Acquisition waits for backstop activation before work starts. Its working
  directory retains the cleanup code until that callback drains. The receipt and token bind
  the created directory and its parent by device, inode and owner. Replacements,
  aliases, unknown state and live or unreadable holders refuse by name. Every
  removal logs the run, path and allocated bytes. Historical temporaries are
  outside this owner.
  Allocated bytes and process and unit holders come from the same complete host observation
  capability. Fixtures supply explicit process and unit views; missing or
  malformed views refuse rather than falling back to ambient ownership.
  The observation owner supplies typed unit data; the temporary closer applies
  the existing ownership guards to it.
  Red runs keep failing inputs, stderr, reproducers and existing cores in a
  diagnostic directory beside their logs, preserving relative paths with a
  manifest from the original root. Retention is capped at 64 MiB and 4,096
  files per run; hitting either cap is logged. Artifacts referenced by the step
  logs are copied before unreferenced scratch. The manifest names each referenced
  root's retained destination and whether it is complete, partial or absent;
  the original logs remain intact. Unreadable diagnostic entries are logged and
  skipped. After the ownership guards, directory permissions are normalized
  before measuring allocated bytes and discarding scratch. Only authenticated dependency
  image payloads are excluded; capture stderr and failure metadata remain.
  Copies are staged inside the authenticated temporary. One filesystem flush
  makes the copied data and directory entries durable before a flushed manifest
  and receipt bind the staged directory's identity. Atomic publication flushes
  both parent directories;
  the backstop resumes an interrupted copy or publication without retaining
  partial evidence. Replaced publications refuse removal.
  A runner handed a prepared root by a launcher without lifetime metadata
  explicitly adopts it before arming its owner. The root must be the owned
  physical `tmp` directly under this run, with the run as its parent and no
  existing lifetime receipt. The owner takes the entire directory, including
  setup and compiler scratch; its contents do not decide adoption. Adoption logs the run and directory
  identities and forwards the new creation token through the canonical handoff.
  Root aliases, foreign ownership, a wrong parent, changed identities and existing
  receipts refuse adoption; no historical temporary population is discovered.
  This compatibility path is removed once both services and the verified controller
  run the lifetime-owning launcher code (#1009).
  Links and sockets are never followed. Core dumps
  remain disabled. The normal owner requests backstop shutdown without waiting
  behind its own unit's stop; a closed receipt makes that later callback inert.
- **The full check counts them.** Its hourly count
  (`tooling/full-check/count.ts`) is red when a branch is named by no open
  issue and not in [`plan.md`](plan.md), a worktree is outside the pool and no task names its
  path, or `~/.cache` holds an nts folder that `tooling/full-check/keep.json`
  does not name with its reason. Issue-named scratch (`nts-scratch/<N>` and
  `nts-<N>-scratch`) needs no per-issue row: an open issue or a literal path
  citation in committed `docs/records/` on main keeps it. Unknown issue or
  citation state keeps the folder and names the observation failure. Closed,
  uncited folders are reported after the scratch grace period; they are never
  placed in the automatic removal list. Non-issue exceptions remain explicit.
  Rules alone let 1,364 branches, 185
  worktrees and 120 GB of evidence folders pile up by 11-06; a red step does
  not.
- **The full check removes four kinds of leftover itself,** each hour before
  it counts: what a stopped run left in a tool's scratch root past that
  root's age in `keep.json`, with nothing inside it changed since; its own
  pins of commits that are neither `main` nor `verified`, a day old and named
  by no task; the logs of gates run by hand (`~/.cache/nts-gate/runs`) and
  inner runs (`~/.cache/nts-inner`)
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
  A non-fitting head permits fitting draining growth of admitted owners
  at equal or lower priority. The runner declares only its already-started finite step cohort;
  it starts no new steps while yielding. New starts use reserved bytes minus
  the outstanding drained amount, including at equal priority. Running wants
  and tokens retain full capacity. An empty cohort returns its drain grant
  before pending work can start on the next event-loop turn. Draining demand excludes pending-step
  reservations and withheld resources. Outstanding drained bytes remain a
  full promise for higher decisions, survive ordinary growth, and return first
  on shrink. New borrowers cannot draw those protected bytes.
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
  worker sizing under the history's flock before admission, except for a
  case-sized key, whose basis code declares (below). `--workers`, even
  a width of one, declares worker sizing; omission declares a whole job.
  A mismatch refuses by name, and publication rechecks the basis under the
  same lock. Samples retain the whole peak and measured width; worker
  forecasts normalize each sample by that width. `steps-v5.json` imports its
  predecessor only while absent. Step rows survive; legacy job observations
  without a recoverable basis and width are rejected with a named count and
  measured again through live accounting. Historical writers retain their
  old namespace.
- **A case-sized job key reserves one case at a time.** `CASE_KEYS` in
  `tooling/gate/step-scheduling.ts` declares the keys whose work is a list
  of independent cases (`hir-compare`: one project's prepared HIR and
  refusals under both compilers), each with the shared tool that runs them.
  The declaration is code, never a first caller's. Every admission under
  such a key names one case, `admit.ts --key <key> --case <path>`, a path
  inside the tree the tools are in. It reserves that case's own peaks from
  `cases-v2/<key>.json`, keyed by step, backend and path as the gate's case
  leases are, or its live use and margin when the case was never measured.
  Its watcher adds the case's peak there. A run of many cases therefore holds
  only its running cases' forecasts, never its heaviest moment throughout.
  A call without `--case`, with `--workers`, or with a path outside the tree
  refuses by name before reserving, and the refusal names the per-case route.
  `--case` on any other key refuses too. A key moved to case sizing has
  its old whole-job row dropped under the history's flock, with a named
  count; those samples never size a case and are never reinterpreted. Two first
  callers serialize on that lock, and one reports the drop.
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
- **Cost telemetry records state changes.** The runner writes the initial pool
  snapshot and only changed snapshots thereafter; sampling time and runner CPU
  counters do not constitute a pool change. Every intervening event carrying
  state invalidates the snapshot comparison, so the next poll can restore the
  wait-cause reader's state. The summary names the polling cadence; it does not
  promise periodic raw samples. Token lifecycle events remain
  complete. Compiler checks append to one process-owned file with a distinct
  session key on each row. Readers retain the legacy per-session file format
  and group interleaved sessions before deriving `summary.json.case_costs`.
  A failed process-file write disables that file for every session, preserving
  a partial final row without appending other records to it.
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
  a case that needs more asks for admitted growth before starting. The common
  pool selects fitting later requests within a step. Its starvation bound
  restricts that existing backfill to one cohort: the constructor's fixed
  token width (`SLOTS` in the gate), counted in grants. The bound is independent
  of arrival time, fixed-step occupancy and withheld slots, and never replenishes. Once exhausted,
  that request is a barrier until admitted or withdrawn; running cases still
  finish and return their leases. This contract applies to every pool user,
  including census cases and tooling entries. It changes no machine-ledger
  order: a step's growth still queues behind higher or earlier ledger work.
  Barrier start and end observations identify the request and terminal reason.
  Case-cost records retain their wall and request durations separately from
  execution: a policy barrier may overlap running work or other admission waits.
  The hard case cap is separate from this forecast. The token broker publishes the
  held-token transition to the step's execution clock before acknowledging
  admission, so a running case cannot still be charged as an excluded wait.
  The common worker owner retains
  each registered persistent scope's acquired device and inode. The worker
  subtree's floor holds those scopes' caps until a fresh cgroup filesystem
  observation proves departure; lease completion alone cannot lower it.
  Replacement or unreadability refuses. Each lease still reads actual caps
  and ancestry and resets its own peak meter. An unchanged kernel cap needs
  no manager write, and a changed parent bound updates only that sibling.
  Nested work cannot enlarge a real enclosing case cap. Each lease keeps its token
  until its final peak is retained and its workers have drained. A kill by
  an ancestor limit names that cgroup, its cap and the case cap, rather than
  claiming host-wide memory pressure.
- **Tooling entries use the common case pool.** Each test file holds its own
  lease before dispatch to a bounded resident controller. Its tests run in a
  fresh Node process with the ordinary test bootstrap and activity observer.
  The bootstrap revokes inherited census execution roles; each fixture's own
  compiler and worker owners retain their semantics beneath the file cap.
  The shared longest-first scheduler uses measured entry costs; untimed
  entries go first so an unknown cannot be left in the measured tail.
  Admission requests follow that dispatch order and reach the shared pool
  concurrently. Fitting files can backfill a waiting file within the common
  cohort bound. Granted files execute concurrently.
  The pool uses each worker container's local OOM count for its own budget;
  fixture descendant budgets retain their owners' completed outcomes. A
  completed assertion report survives a later memory observation failure.
  Each file reads its registered worker cap after dispatch; a controller's
  startup allowance never sizes later file scopes. Local budget and lost
  controller incidents drain the finite neighbouring work before surfacing.
  Completion retains the file's peak before the lease returns; a controller
  may then accept another entry. The accepted-source selector self-test is an
  explicit entry kind in the same pool, with its own stable source case lease
  and authenticated completion. It runs alongside test entries. A historical
  whole-tooling peak cannot size these admissions.
  Completed assertion failures survive an unfinished neighbour or an observation
  failure, with the separate diagnostic retained in the transcript.
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
- **Tooling contention is checked on demand.** Run
  `node tooling/gate/tooling-load.ts --out <fresh kept-scratch directory>`
  from a named agent unit. Each invocation admits one complete round, prepares
  a fresh compiler and CLI test artifact through the existing Cargo and test
  profile owners, and runs the complete tooling inventory and CLI integration
  harness beside ready-signalled CPU load. One fresh owner-bound experiment
  slice holds the load and collector workers under the same quota; this is
  an experiment condition, never gate policy. Independent fixture units keep
  their own ownership and are identified in the retained test output.
  Completed test results decide the outcome. The tool retains full failure
  output, resource and pressure samples, quota and throttling counters, and
  waits for worker, scope and sampler drain before releasing admission or
  publishing its terminal report. Inspect the first round before requesting
  stability repeats. A loaded failure needs its actual output and resource
  evidence before it is attributed to timing assumptions or resource limits.
  Each round releases admission, so a waiting landing can go first.
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
  Selector preflight uses this owner for Git, endpoint evaluation and historical
  rule self-tests before a step clock exists. A wedged selector grants no scope
  and holds the landing as a named instrument failure. Ordinary missing-content
  answers retain conservative precision fallback; a failed observation escapes
  that fallback. Compare-and-delete recovery independently confirms absence
  without hiding a failed absence probe.
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
  Tooling-file guards own their clock and idle scheduler together. Timing and
  activity are separate capabilities: supplying timing keeps native acquisition,
  verification and drain. A supplied activity source acquires its complete
  frequency/watch/sample/verify/close lifetime explicitly. Each timer, watch and
  lifetime closes once; every cleanup error remains beside a completed failure.
  The shared
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
  Its owned Git configuration disables automatic maintenance and garbage
  collection, so fixture commits never leave a detached writer in that state.
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
- **Restoring verified outranks agents' work.** The machine has four ranks,
  highest first: the landing check, the full check's culprit-search probes
  and core runs advancing stale `verified`, agents' work, and the full check's
  other runs. A search exists to restore
  `verified`, which records, benchmarks and every later search wait on, so
  the controller runs each probe at the `culprit-search` rank. The same rank
  applies to a core run when `verified` is a strict ancestor of its candidate
  and the oldest first-parent commit in `verified..candidate` has been
  unverified on main for more than **two hours** (since its landing), measured
  from the landing result's `at` to the supplied controller clock immediately
  before launch. `queue.ts`'s `landedTimes()` supplies each commit's arrival
  on main through `Effects`; tests supply their own observations. Equality retains full-check
  rank. A fresh change after a quiet spell, missing `verified`, a current
  `verified` or a non-descendant candidate retains full-check rank. A branch
  committed hours ago but landing now is fresh work. A missing landing record
  or invalid landing time is named in the log and keeps full-check rank;
  committer time never substitutes for landing evidence.
  `tooling/full-check/service.ts` chooses at `runPart`'s launch and passes
  the rank to `Gate.run`; it logs a promotion with the outstanding commit,
  age and bound. The choice is fresh each run and ends with it, so a green
  catch-up returns subsequent fresh core work to full-check rank. Wide runs,
  records and benchmarks keep full-check rank. Probes stay one at a time and
  all runs keep their measured reservations. The bound allows a complete
  slow measured green core cycle before promoting; its
  [measured cycle basis and historical promotion frequency](records/full-check-stale-verified.md)
  distinguish ordinary completion from stale-backlog recovery. A probe of a
  commit whose own `ranks.ts` predates the rank runs at the full check's, and
  its log says so. The controller runs `verified`'s code, so the rank orders
  these runs only once `verified` contains the controller rule. The same
  eligibility orders a due core before wide, with one postponement per verified
  until the owed wide starts; launch rechecks the rank against fresh observations.
  This cycle ordering also takes effect only once `verified` contains it. A ledger entry at the
  `culprit-search` rank is written at version 4, so a reader that predates
  the rank refuses it by its future version rather than ordering it wrongly;
  the reader's operator rebases onto `main`. The current reader's refusal
  of a newer version names that remedy.
- **A contended CPU serves the ranks in the memory ledger's order.** The
  landing check's work comes first, a culprit search's or stale-verified
  core's second, agents'
  third, the full check's other runs last: `tooling/gate/ranks.ts` holds one
  table of what each rank gets from the kernel, its memory admission order,
  its OOM score and its CPU weight. The full check's measurement places a
  promoted run, started inside the full check's unit, at its rank's OOM score. The rank travels in
  `NTS_MEMORY_PRIORITY`. Every rank's work runs under `nts.slice`, where
  siblings share a saturated machine by weight: each run's root slice
  carries its rank's `CPUWeight` (`startBoundSlice`, which refuses a root
  whose launcher names no rank), and so does a unit or gate command scope
  started outside a run (`toolingSliceArgs`, `gateCommand`), at the rank its
  launcher's code names. Work started outside `nts.slice` enters a scope of
  its own there at its rank, bound to the unit it was started in
  (`rankedScopeArgs`): every job `admit.ts` admits, which includes
  `with-lock.sh`'s and `inner.ts`'s (`--memory-max` caps that scope), and
  `check.ts --here`. The landing service's unit and an agent's unit
  (`tooling/agents`) run under `nts.slice` at their rank's weight; the full
  check's units carry the full check's, and a probe's or stale-verified core's
  run slice the culprit search's. A unit another launcher starts
  outside `nts.slice` (a Signalbox worker's) is ranked only through those
  entries; its other processes stay where it put them. Nice values still
  order the processes inside one run. A weight shares contended time only: it never
  caps a run on an idle machine, and no gate's parallelism is capped.
- **A memory wait names who holds the memory.** When a request waits, its
  line is followed by a census (`tooling/gate/memory-holders.ts`) of the user's
  cgroups to a bounded depth: the user manager's children, with each slice among
  them (`app.slice`, `nts.slice`) expanded one level, and the manager's siblings
  in its user slice. Each row gives its resident charge, split into the
  admitted jobs whose measured use it holds (by rank and what) and the
  unledgered rest. A last figure is what is not available outside every row.
  A job's measure arrives as parts, each in the cgroup that holds it, and each
  part counts once, in the deepest row that contains it. The census is read
  after the decision releases the lock. It repeats every 300 s of the run's
  monotonic clock while the wait lasts, and `admit.ts --status` (and `--json`)
  shows the same table. Charges and the one-level listing come through
  `HostObservations` (`cgroupCharge`, `cgroupChildren`). A missing observation
  is printed by name in place of the census, and the wait goes on. A gate
  run's measure is its steps' slice and its runner's process tree outside it
  (`OwnerSpec.tree`), so the runner is no longer outside the ledger.
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

- Composed Rust selectors project targets inside one validated batch. Only
  replay answers, authority and metadata facts survive a projection; full
  snapshots do not. Every fact is revalidated before publication, and a later
  call starts fresh. Step discovery releases its inference cache before Rust
  selection; the final detached input graph remains memoized
  ([log](records/notebooks/decisions-log.md#composed-selectors-project-within-one-validation-boundary-11-23)).

- **A missed benchmark night gets the next controller start.** After a slot
  ends without a measured record, benchmarks start on the newest verified
  before another core, wide or records run. Measurement queues at full-check
  rank within the session budget; only a measured record clears the overdue
  state. Readers infer a missing marker for a stored due slot after an
  unmeasured night, preserving explicit values. Existing work finishes,
  landings retain priority, and stale cores can start beside the benchmark
  unit at their existing rank
  ([log](records/notebooks/decisions-log.md#missed-benchmark-nights-get-the-next-start-11-24),
  [state adoption](records/notebooks/decisions-log.md#stored-due-benchmark-nights-retain-their-priority-11-24)).

- **A pending whole program still declines at compile time.** Its module
  evaluation cuts and host dependence are checked before its pending answer,
  so a cut program is red, or listed, at the landing that adds it, not first
  at the records commit
  ([log](records/notebooks/decisions-log.md#a-pending-whole-program-declines-at-its-own-landing-11-23)).

- **Run temporary cleanup owns normal and forced exits.** The run's explicit
  lifetime and identity-bound systemd backstop share one guarded remover.
  Bounded diagnostics live beside the logs before scratch is discarded;
  unknown historical temporaries receive no new deletion grant
  ([log](records/notebooks/decisions-log.md#run-temporary-lifetime-11-23)).

- **A stale catch-up core precedes owed wide once per verified.** The cycle
  uses the same eligibility as launch ranking. The postponed wide retains its
  schedule and gets its next eligible turn if verified stays unchanged, across
  restarts and new red main candidates. In-flight work finishes. Controllers
  adopt this ordering through verified
  ([log](records/notebooks/decisions-log.md#stale-core-precedes-wide-with-a-bounded-postponement-11-23)).

- **Gate pin retention follows live ownership.** The pin owner serializes
  publication and per-run leases with pruning, stages executable bytes outside
  the lock, and retains all held folders plus ten recent unheld ones. Unknown
  ownership protects the folder and appears in the hourly count
  ([log](records/notebooks/decisions-log.md#gate-binary-pins-follow-run-leases-11-20)).

- **Cost observations retain session identity independently of files.** Pool
  snapshots are written only on a structural change, excluding clock and rusage
  changes, or to resynchronize after an intervening state-bearing event. Compiler
  cost sessions append to one file per process, with an
  explicit session key on every row. Readers group sessions in the legacy
  logical-file order so phase populations and case ordering remain unchanged
  ([log](records/notebooks/decisions-log.md#cost-telemetry-records-changes-and-process-sessions-11-20)).

- Mutable Node resolution sessions belong to their prepared run, independently
  of reusable dependency images. One shared locator validates the captured
  scope root and owner birth for preparation and emission. Sealed children
  borrow the parent's scope; unsealed entries own and join their own helper.
  A completed or replaced holder still refuses, without deletion or restart.

- **Held oracle records have stable classifications and behavioral identities.**
  Version-2 budgets retain phase, outcome, bound and signal; raw measurements and
  failure messages stay in run evidence. Their revision binds runtime recipe and
  validated package content, not installer implementation. Measured driver
  digests remain provenance and never schedule refreshes.

- **Cross-process fixture records are published atomically.** A consumer may
  wait for a record's existence and read its complete bytes once. Producers use
  `durableRecord`, explicitly included in their staged executable inputs;
  injected command fragments carry the `generatedJavaScript` source brand so
  the publication audit checks them before execution. Existence-only markers
  and deliberately incomplete stream controls retain their separate contracts.

- **A record root has one identity across command modes.** Recording and applying
  use the entry's single resolved root. Type-project identities classify local
  paths with relative containment, so equivalent root spellings cannot turn
  local inputs into absolute host names. A source change remains a source
  change; a trailing separator is not one.


- **Withdrawal cancels and certifies the running check.** The queue owns one
  watch on its durable withdrawal directory, armed before taking entries and
  re-read after each subscription. Watch setup failures refuse service startup;
  watch failures hold rather than silently losing cancellation. The entry's
  signal reaches admission, candidate commands and retry boundaries. One
  spawn-captured, PID/start/session-fenced process-group capability sends
  SIGTERM to the actual command group, including payloads behind GNU time.
  Candidate entries join their children; the gate's existing scope owner
  certifies its root before the landing releases and joins its reservation.
  Only then is the entry answered withdrawn.

  An unproved drain retains the run, tree, hold and reservation, publishes a
  named held status with the run directory, and takes no further entries.
  Later child closure resumes certification. Repeating
  `check.ts withdraw <id>` wakes a failed certification through the same watch;
  it neither creates replacement work nor declares live work withdrawn.
  Persisted spawn birth facts grant only read-only empty-group certification
  after service restart. On the same boot, emptiness excludes every live
  process with the recorded PGID and session born at or after that birth; a
  different boot proves the old processes gone. The existing dead-runner gate
  root owner alone may reap its scopes. Pending cancellation is certified
  before any warm-tree preparation, including after power loss.

  The final withdrawal read and main's compare-and-swap share the queue lock.
  A withdrawal winning that transition prevents publication; after publication
  begins it reports too late. A failed compare-and-swap returns to the
  cancellable phase. Existing cleanup guards remain unchanged
  ([log](records/notebooks/decisions-log.md#withdrawal-owns-the-live-landing-drain-11-16)).

- **A pooled priority yield releases idle memory before waiting.** The common
  feed joins its token cancellation, idle worker closure and one shared pause.
  In-flight cases finish; remaining cases retain their queue ownership across
  worker generations. A token-backed offer is counted only at actual dispatch,
  and an unused offer returns only after its token drains. Initial and resumed
  workers are created lazily after a case token is granted. A standalone job
  returns its own idle forecast and restores it through ordinary admission
  before restarting; an inherited job never shrinks its parent. The gate owner
  returns idle elastic history beyond observed charge and the existing margin,
  preserving live case grants. Census and compile feeds use this same boundary
  ([log](records/notebooks/decisions-log.md#pooled-priority-yield-releases-idle-memory-11-16)).

- **The token pool decides an aborted wait's grant.** A client whose wait
  aborts after its request is sent withdraws it rather than closing the
  connection. The pool orders the withdrawal against its grant: a waiting
  request is cancelled and answered `withdrawn`; a granted one, including a
  sized grant pending behind its answer, keeps its grant and size, and its
  `go` answers the withdrawal. The caller owns that grant, and the census feed
  returns it as an offer with its path, so every grant is a dispatch or a
  returned offer. A runner gone before answering grants nothing more
  ([log](records/notebooks/decisions-log.md#the-token-pool-decides-an-aborted-waits-grant-11-17)).

### Landing attempts keep worker lifetimes asynchronous

A landing's compiler build, step attempts and contract probes use the candidate
launcher's asynchronous form. Its synchronous form remains for the full check's
synchronous measurement and record transaction contracts; both share one request
encoder and child-receipt decoder. Candidate Node, argv, environment, descriptor
passing and output limits have the same owner in both forms.

After the first step attempt, the landing releases and joins the build sampler
before starting a retry. Disk ownership spans the awaited build. A final
`landing.json` is published only after the build reservation and sampler have
drained; primary and cleanup failures both remain visible. The worker's existing
stop guard stays in force. Drain diagnostics distinguish the worker thread's own
exit-hook wall timestamp, read through shared memory, from the parent's observed
exit event. The hook timestamp is not a claim about the kernel's exact thread
death; an absent timestamp remains explicit after forced termination.

- **A run closes the oracle image it creates.** Cold preparation exclusively
  acquires an image tree and registers its directory identity with the run's
  temporary owner. A drained failed close drops only those registered trees,
  retaining identity files and reporting each removed path and allocated bytes.
  Borrowed images and pre-existing unregistered images receive no ownership
  grant. An image whose guard refuses is kept by name while valid siblings
  can drop; the failed temporary still registers its full retained bytes.
  Replacements, aliases and live holders refuse image disposal. A registered
  closed temporary cannot be acquired again: `NTS_GATE_RUN_DIR` names one run
  lifetime, and a new run needs a new directory. Live inherited handoffs and
  retries within an open run retain their existing lifetime. Interrupted-run
  discovery and recovery are not enabled
  ([log](records/notebooks/decisions-log.md#run-owned-oracle-image-disposal-11-16)).

- **Recorders compose independent families.** `record-pending.ts` is the one
  production table of record families, their check steps and recording order.
  `recorder-core.ts` owns generic audit transactions and delta transport without
  importing a family or compiler parser. Each `*-record-family.ts` owns its
  population, format rules and source identity. Command entries prepare their
  oracle explicitly, then pass the sealed environment to `recorder-command.ts`
  for supervised execution. `copyFixtureProject` stages an explicit-root
  fixture project from its unchanged config and authoritative `files` list,
  including relative runtime and local type source edges and triple-slash
  paths. The local type context grants no runtime assets and never resolves
  installed packages; those remain owned by the sealed oracle image. The
  helper uses `copyModuleClosure` and grants no installed Program. Explicit
  oracle entries seed original-owner discovery through `projectFor`; each
  owner keeps its unchanged configuration and local Program sources while
  installed facts are validated at their source and remain image-owned. A fixture
  composes the core and its own family;
  composition controls retain the complete production table
  ([log](records/notebooks/decisions-log.md#independent-record-families-11-16)).

- **Started work may drain past a non-fitting head.** The ledger
  backfills only explicitly draining growth of admitted owners at equal or lower priority, in its
  existing order and room. The marker declares eligibility; only a grant
  that actually backfills creates protected drained bytes. A normal prefix
  grant remains ordinary capacity and preserves earlier drain debt.
  New admissions and ordinary growth stay queued behind a non-fitting head.
  Yielding runners keep only their live started cohort eligible for case
  leases and growth, with no pending-step demand. New starts cannot spend
  outstanding drained bytes even without a higher-priority yield; an empty
  cohort returns them before scheduling its successor on the next turn.
  A mixed ticket is joined
  before its drain-only replacement. Drained bytes are protected from the
  priority discount and new ancestor draws until shrink returns them; observed
  consumption is still counted once. The head retains its place, and every
  completed growth reschedules on the next event-loop turn. An entry uses
  version 3 only while protected drained bytes remain, then returns to
  version 2. Older admission readers fail closed during that interval and
  continue normally afterward; operators rebase or restart onto this protocol
  rather than bypassing its future-state refusal
  ([log](records/notebooks/decisions-log.md#started-work-may-drain-past-a-non-fitting-head-11-16)).

- **Gate memory adjustment retains pending demand.** Shrink and growth use
  the same demand from current grants, withheld memory and running steps'
  pending wants. A completed growth re-enters scheduling on the next event-loop
  turn, so sampling, feeding, time bounds and child completion keep running
  ([log](records/notebooks/decisions-log.md#gate-memory-adjustment-retains-pending-demand-11-16)).

- **Resource acquisition and option identity share their real owner.** A Node
  resolution helper launches with the explicit environment that supplied its
  expected options and reports its actual arguments and `NODE_OPTIONS`.
  A token controller validates the canonical packet before requesting a lease;
  if binding fails after a grant, it releases and drains that lease while
  retaining the binding and cleanup errors
  ([log](records/notebooks/decisions-log.md#resolver-launch-and-token-binding-ownership-11-15)).
- **Benchmark compile identities are checked before compilation.** The landing
  tree check shares the recorder's source and driver inventory comparison,
  keeps new cells pending and compiles nothing. Compiler provenance does not
  invalidate rows; case and compile-driver inputs do.
  The benchmark population is one compiled-program project-members declaration:
  its case member selects shallow directories, each own config wins, and absent
  configs use the build's declared default and generated whole-directory recipe.
  Program resolution supplies sources; compiled runtime assets remain inputs.
  A fixtureInput grant exactly naming a member population substitutes only that
  namespace: staging records its private data owner without building source
  members. The fixture validates its private cases through the same production
  member/default-config recipe; other populations retain normal discovery
  ([log](records/notebooks/decisions-log.md#2026-11-16-check-benchmark-compile-identities-at-landing-546)).

- **Project reads belong to one selection run.** The ordinary JS step graph
  uses one synchronous discovery batch across its three description sites.
  Each complete request, entry and namespace key is resolved once within the
  graph's fixed source, installation and catalog view. Independent cases keep
  independent Programs; the Rust selector retains its independent batch.
  The complete request key includes whether it performs compiled-program
  nearest-config lookups. Each fresh Program transaction produces its canonical
  reader identities once, before snapshots attach reader and target provenance.
  Validation preserves observations, source ownership and populations before
  returning. The scoped callback closes when its body returns, and its query
  answers clear on success or failure. Endpoint views cannot share answers
  through relative config names. Standalone descriptions retain fresh reads
  ([scope log](records/notebooks/decisions-log.md#project-reads-belong-to-one-selection-run-11-18),
  [identity log](records/notebooks/decisions-log.md#program-transactions-produce-reader-identities-once-11-22)).

- **Rust publication belongs to one owner.** `nts-publication` stages files,
  links and immutable directories in an exclusively acquired sibling claim
  named by process ID and a process-wide serial. Collisions are retried without
  removing an existing claim. The producer creates the initially absent payload.
  Files and links publish by one rename; a host refusing replacement reports an
  error without removing the target as a fallback, including on Windows.
  Directory replacement and legacy directory-to-link conversion use a portable
  parent-directory lock, quarantine and restore. One retained lock file per
  parent bounds lock metadata as target versions change. The synchronous owner
  refuses same-thread re-entry for a canonical parent; competing threads wait
  on its process registry, and the OS lock coordinates other processes.
  A failed restore retains and names the
  recovery path. Surface staging, publication and pruning share an identity
  lock; pruning skips private namespaces and recognizes committed entries.
  Cleanup touches only the acquired claim and retains errors beside the primary
  failure. This provides atomic visibility, not fsync durability. The Rust token
  audit rejects filesystem renames outside that owner; test-only declarations
  confer no production exception
  ([log](records/notebooks/decisions-log.md#rust-publication-owns-each-writers-staging-11-15)).

- **A superset race guard is an observation, not a selection input.** Landing,
  pinned and full-check source trees are committed and clean. A guard that
  snapshots a candidate superset but compares only the eventual recipe members
  cannot depend on a non-member's content or status. `dependency-source-inputs`
  retains those reads in `runtimeFiles` and observation-only metadata for trace
  claims and full source validation; ordinary module or data visits promote
  actual members to selection `files` in either order. Installation-status
  inputs remain selection inputs, as do the installed catalog's target recipes.
  A dirty source is refused by the committed-source owner.


- **Affinity commands have their own entry.** Runner code imports the affinity
  library; shell launchers execute `tooling/gate/affinity/main.ts`. Fixtures
  stage both through their actual command roots, then may replace the command
  without changing library exports or inventing a second module layout.

- **Product type projects share tooling's diagnostic ratchet.** One registry
  supplies the existing strict gate step, read-only pending discovery and input
  declarations. Each project uses its own declarations and has independent
  per-module limits and a complete inventory. New projects follow the ordinary
  pending-record rule; the green core records cycle measures their first rows.
  A recorded project's limits never rise, including after a source edit, and a
  records delta applies only to the complete input identity it measured.
  Genuine source deletions require the owner's no-entry observation; an existing
  source omitted from its Program refuses. A rename is a deletion plus a new
  module, whose diagnostic limit starts at zero
  ([log](records/notebooks/decisions-log.md#product-projects-share-the-type-ratchet-11-15)).

- **Pinned corpora coexist by revision.** AWFY, TypeScript and test262 have
  plain revision data files under tooling/bootstrap. Rust includes those same
  files as constants; TypeScript's definition verifies its native-checker
  version before acquisition or reuse. One registry feeds bootstrap, linking
  and private fixture preparation. The shared corpus owner publishes each
  checkout under third_party/<slot>.d/<pin>, and each candidate links its own
  selected pin before running suites. Fresh bootstrap fills empty slots while
  retaining nonempty legacy directories. Existing shared checkouts never move;
  a pin change needs no manual migration. Node retains its authenticated
  immutable release/identity pair owner
  ([log](records/notebooks/decisions-log.md#pinned-corpora-coexist-by-revision-11-15)).

- **AWFY reference inputs have one corpus pin.** Bootstrap, linking and reference
  readers consume `tooling/bootstrap/awfy.pin`. The shared corpus owner takes a
  pin source, upstream URL, sparse set and slot. Acquisition publishes a fresh
  checkout at `third_party/are-we-fast-yet.d/<pin>`; an existing checkout is
  verified without moving it. Each tree links its own selected pin, while the
  legacy directory and older trees remain untouched. A pin bump needs no manual
  checkout procedure: the candidate acquires its missing pin before linking.
  Rust embeds the data pin and resolves its selected directory once during build
  setup. AWFY provenance URLs must name the pin. A missing acquired corpus gives
  both AWFY reference cells the same named unavailable reason and acquire command,
  before either reference compiler starts. Present corpus cells are unchanged.
  A pin edit reaches its benchmark readers through their data declarations
  ([log](records/notebooks/decisions-log.md#awfy-reference-corpus-is-pinned-11-15)).


- **One graph owns three file roles.** Selection retains all input `files`;
  producer identity hashes `placingFiles`; fixture reproduction copies
  `stagingFiles`. The staging role includes modules, declared data and compiler
  or Node observations. Nested source/status fence populations are inspection
  only; an explicit population entry stages itself, and any reproductive visit
  promotes a shared path. Source validation keeps the complete observations.
  Immutable fixture ownership also requires a reproductive owned visit: a data
  population cannot revive an inspection-only file's immutable ownership.
  Fixture staging finishes before private mutations.


- **Runtime module edges follow Node stripping.** Clause-level `import type` and
  `export type` do not make runtime inputs; the tooling type project owns them.
  Named type-specifier lists retain the module's side effects. Parser-free
  population, identity data and host-environment utilities have independent
  owners, so consuming them does not acquire executable preparation or Git
  fence inputs. The fences retain their own observed populations.


- **Load diagnosis uses the real test owners.** An on-demand tooling round
  shares one owner-bound quota between ready load and the real collector and
  CLI harness. It adds no gate step or elapsed-time verdict. Failures are
  inspected before stability repeats
  ([log](records/notebooks/decisions-log.md#tooling-contention-is-an-on-demand-round-11-15)).

- Tooling and measurement slices use the shared transient creator and bind to
  their actual user-manager owner unit. They retain an empty start until members
  arrive, and stop with that owner even when no process cleanup runs. Setup
  refuses with a scope rerun command when no bindable owner exists.

- The config audit builds in a temporary copy of its declared tracked workspace
  and external inputs, retaining working edits while excluding ignored outputs.
  One declaration list owns selection and staging, so an undeclared external
  reference fails the private build. The copy remains alive through diagnostic
  capture and is removed after the compiler drains.

- **Free build profiles have independent reclamation grants.** Unknown target
  siblings remain named by path and known writer. They do not veto proven
  Cargo profiles in a free tree. The warm compatible pair and each profile's
  live ownership remain protected under both locks. Admission refusals retain
  the decisions that prevented reclaiming enough space.

- **Pressure reclamation uses ownership provenance**: only approved rebuildable
  outputs and clean unbuilt pool checkouts may be removed under the capacity
  lock. Current service builds and two warm free targets remain. Non-dumpable
  processes outside nts are recorded by cgroup provenance; unreadable tool
  processes or cgroups refuse
  ([log](records/notebooks/decisions-log.md#pressure-reclamation-uses-ownership-provenance-11-14)).
- **Node harness helpers belong to sealed execution.** Pure declaration and
  path helpers share the runtime inventory, byte identity and strip-only
  transform. User oracle projects retain their own config and source closure
  ([log](records/notebooks/decisions-log.md#node-harness-helpers-are-sealed-runtime-11-14)).

- Local process forwarders keep their command parameter first. The source
  audit checks that one direct forwarding hop; Git arguments at callers use
  the shared argument owner without parameter-flow inference.

- **Stall diagnostics preserve scope and time.** Native histograms retain real
  percentiles per window, and PSI retains each scope's identity and cumulative
  counters. Shared exposure is distinct from a causal step charge; all meters
  close before the terminal record
  ([log](records/notebooks/decisions-log.md#runner-delay-and-pressure-11-14)).

- **An owned root can end before its cleanup runs.** The run retains the
  acquired cgroup device and inode independently of its ownership receipt.
  Cleanup accepts the same empty root, or an absent path whose exact unit is
  inactive or unloaded. A changed, populated or live-unreadable root still
  refuses. The owner binds every pressure read, including the first, to that
  identity before and after the read; replacement or removal leaves the new
  point unaccepted. Worker PSI retains its last actual counters and observation time,
  plus the time departure was observed; it supplies no new terminal counters.
  Worker exposure ends at that real sample, and a new step cannot start after
  departure. Successful ownership cleanup leaves a canceled run interrupted
  and non-green
  ([log](records/notebooks/decisions-log.md#owned-root-departure-11-14)).

- **Conservative reach remains explicit and non-placing.** A declared wide
  namespace may retain a harness's input obligations without pretending to be
  an exact generated Program. Immutable bytes, recursive presence and reader
  context survive records and handovers; the census identifies the wider paths.
  Runtime identity components still require their captured kind/link facts
  ([log](records/notebooks/decisions-log.md#conservative-runtime-inputs-remain-visible-11-14)).
- **Fast selector records inherit derivation authority from accepted bytes.**
  Current keys alone cannot authorize a narrowed payload. Accepted-byte equality
  permits reuse after fresh input validation; stale accepted records use the
  live graph, while new records must pass actual derivation checks
  ([log](records/notebooks/decisions-log.md#selector-records-bind-accepted-derivation-11-14)).
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
- **Temporary bytes are acquired, not only observed.** Captures hold an explicit
  disk lease in the same capacity equation as pool/build promises. One locked
  check-and-claim prevents concurrent requests spending the same free bytes;
  release follows publication and drain, while dead process identities expire
  ([log](records/notebooks/decisions-log.md#temporary-disk-admission-claims-capacity-11-14)).

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

- **Tooling admission is per entry.** Test files and the selector self-test
  use the common case leases and independent worker boundaries. A fresh Node
  test process preserves file isolation; resident controllers can be reused.
  The controller outside each file scope owns activity and inactivity. It
  authenticates completed assertions on that child's private channel before
  termination; a killed or over-budget file cannot publish a partial pass.
  The collector retains completed failures beside unfinished files and observer
  errors ([log](records/notebooks/decisions-log.md#tooling-files-own-their-memory-admission-11-18)).

- **Persistent scopes retain their kernel allowances across leases.** Fresh
  per-lease observations and meters remain independent of cap publication.
  Registered scope identities determine the ancestor floor until observed
  departure, and unchanged limits incur no manager call. Whole census bounds
  use measured CPU history or the committed baseline through the existing
  concurrent-run rule
  ([log](records/notebooks/decisions-log.md#persistent-worker-caps-and-measured-census-bounds-11-15)).

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
- **Accepted revision data stays outside candidate reach:** opaque descriptors
  name only captured accepted-main blob reads through the shared Git owner.
  Working-tree readers of those paths keep their independent obligations
  ([log](records/notebooks/decisions-log.md#accepted-revision-data-is-not-candidate-data-11-15)).
- **Wide completion answers its night:** a completed green or red run of the
  current verified answers every nightly slot through its actual end, while
  any verdict retains the existing post-slot start answer. A held straddling
  run can cause only one further nightly attempt on that verified. Start
  retains the minimum-gap origin
  ([log](records/notebooks/decisions-log.md#completed-wide-runs-answer-the-night-11-15)).
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
  consume the same explicit `projectConfig` descriptor. Discovery uses the
  oracle's existing owner and parsed inputs, with no guessed neighbouring config or
  separate copier option
  ([log](records/notebooks/decisions-log.md#compiled-readers-name-their-config-11-14)).
- **Project discovery selects the compiler-matched view.** Each native config
  parse captures its request and ordered matched file names. Selection keys
  replay those requests through the same pinned parser in one lazy, closed,
  parse-only session. Generated requests retain their literal recipe and use
  the generated-config owner. Raw matching directory reads and the metadata
  they alone cause remain acquisition race guards and native claims; they do
  not create selection reach. A read also used by an ordinary Program
  operation keeps its selection obligation, in either acquisition order.
  Compact accepted records retain this role distinction explicitly. Ignored,
  nonmatching build output leaves the key unchanged; matching source changes
  invalidate it. Step selection replays each current request at the committed
  base to retain consumers of removed matched roots. The base Git tree and
  link blobs bind logical and physical ownership names, including intermediate
  aliases, independently of working or tip links. Chains stay inside the source;
  outside or unsupported identities refuse by name. Unrelated and excluded
  deletions add no reach. Config bytes, negative resolution and alias facts retain
  their independent obligations. Compiled programs also retain the emitter's
  actual nearest-config lookups for local non-declaration modules as ordinary
  selection facts, including absent nearer configs. Queried Program modules
  witness genuine ancestor config absences outside the source; a positive
  external config refuses. Type-check-only inputs keep their declared config.
  Within a snapshot, each reader and namespace context composes the detached
  observations produced by its Program transactions. Equal answers retain the
  union of their causes; conflicting answers refuse. Typed facts share a detached
  authority descriptor
  only when it is identical; different authority or Program provenance retains
  separate rows and validation. No Program answer survives its graph scope.
  The producer canonically orders capture owners, requests and role bags, and
  consumes
  snapshots in Cargo inventory order. The codec retains its ordered byte
  contract; verification still requires exact output from that producer
  ([alias log](records/notebooks/decisions-log.md#matched-source-deletions-use-committed-alias-identities-11-19),
  [capture log](records/notebooks/decisions-log.md#reader-context-program-capture-11-19)).
- **Installed Program inputs owe their repository pins:** a declared config's
  installed reads must match the verified installation's finite package catalog,
  including aliases, membership and content hashes. Selection retains package
  identity and depends on the installation inputs and recipe closure; it neither
  installs packages nor grants runtime byte or fixture-copy authority. The source
  owner passes the catalog path and digest explicitly to private endpoints.
  Installation snapshots Git index entries, per-path status and dirty file
  hashes before parser acquisition. After the verified install it derives the
  executable recipe modules, requires tracked regular code, and rechecks only
  those members plus the input identity before publication. Clean members must
  still equal their index blobs; dirty members must equal their captured bytes.
  Unrelated data writes do not change the code generation. An unborn tree uses
  its index, while executing producer code always requires a Git source.
  Missing or stale catalogs owe all Rust targets with a structured reason;
  malformed catalogs and uncataloged positive reads refuse by name. The census
  retains that fallback separately from path reach.
  ([log](records/notebooks/decisions-log.md#installed-programs-depend-on-cataloged-packages-and-repository-pins-11-14)).
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
  peak in one queue, in priority order (the landing check, the full check's
  culprit-search probes and core runs advancing stale `verified`, agents'
  work, the full check's other runs); a gate run holds one reservation that grows and shrinks with
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

- **Tooling-file liveness begins at actual spawn.** The collector uses the
  pinned Node spawn channel to bind the executed entry, parent and PID birth
  before reporter delivery. The shared command liveness owner observes that
  entry's rooted descendants: CPU progress, runnable or I/O-blocked threads,
  and test reports renew inactivity. A file with no progress reaches the
  named five-minute hang guard. Missing identity or activity fails the
  instrument when no assertion has completed failing. A definite completed
  failure remains FAIL with the observation diagnostic retained beside it.
  The enclosing step retains its execution budget; file activity
  introduces no separate CPU cutoff. Observation subscriptions and samplers
  close with the collector; timing injection preserves that native lifetime.
  Entry completion and final drain retain every release error without replacing
  a definite completed FAIL. The existing slice owns cancellation
  ([log](records/notebooks/decisions-log.md#tooling-file-liveness-begins-at-spawn-11-14)).

- **Fixture tooling comes from its declared closure.** A private test repository
  stages command entries through `copyModuleClosure`, including their imports
  and named assets. A fixture that compiles TypeScript supplies the same
  `projectConfig` descriptor as its compiling reader. The shared project owner supplies inherited configs, references and roots;
  a compiled entry must declare its config explicitly.
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
- **Selector preflight cannot wait without a bound.** Its synchronous tool
  questions use the existing infrastructure probe before any step clock runs.
  Classified nonzero answers retain their meaning; unavailable observations
  hold selection without granting a fallback scope
  ([log](records/notebooks/decisions-log.md#selector-preflight-is-bounded-11-14)).

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
  shared compiler preparation through `admit.ts` with the whole-job `pinned-build`
  key and the selected target's scheduling history. That command's process
  ends before gate entry; the runner's normal admission retires the exited
  owner and reserves for itself. No reservation spans both phases, and the
  shell never passes the build handle to the gate. Preparation rusage starts
  after admission, so its duration excludes time waiting for memory
  ([log](records/notebooks/decisions-log.md#pinned-preparation-owns-only-its-build-11-13)).
- **Doctests execute an already prepared Cargo graph.** The shared build
  owner compiles their selected libraries and dev dependencies in `nts-dev`
  before step scopes. Execution requires the matching successful receipt and
  fresh artifacts. Compiler changes cannot charge a cold library build to the
  warm doctest step. Selection still decides whether preparation is owed
  ([log](records/notebooks/decisions-log.md#doctest-compilation-belongs-to-admitted-preparation-11-20)).
- **Proof jobs have stable history keys**: `hir-compare`, `perf-count` and
  `test262-records` name the prepared-HIR corpus comparison, instruction
  counts and five test262 records. Issue numbers belong in labels and logs,
  so a fresh task can use the warm tree's observations
  ([log](records/notebooks/decisions-log.md#unmeasured-jobs-use-live-accounting-11-10)).
  `hir-compare` is sized per project (11-23):
  `tooling/conformance/refusal-diff.ts` admits each project as its own case,
  and a hand-written comparison wraps each project in
  `admit.ts --key hir-compare --case <project>`
  ([log](records/notebooks/decisions-log.md#the-corpus-comparison-is-sized-per-project-11-23)).
- **Job history keys bind their sizing basis.** A key's first caller declares
  whole-job or worker meaning before admission, and every writer preserves
  it. A case-sized key (`CASE_KEYS`) is the exception: code declares its
  basis, every admission names one case, and its old whole-job samples are
  dropped by name, never reinterpreted
  ([log](records/notebooks/decisions-log.md#the-corpus-comparison-is-sized-per-project-11-23)). Each observation keeps its whole peak and measured width. The versioned
  history path retains compatible step observations and names discarded
  ambiguous job observations, without exposing new state to older writers
  ([log](records/notebooks/decisions-log.md#job-keys-keep-their-measurement-basis-11-12)).
- **Reservations yield to a request that outranks them** (11-09): for a
  waiting request's decision, a reservation of lower priority counts as what
  its job uses and a margin, whatever holds it; a landing's build hands its
  reservation to its gate run, so nothing is admitted between them
  ([log](records/notebooks/decisions-log.md#reservations-yield-to-a-request-that-outranks-them-11-09)).
- **A landing's selection is ledgered at its caller's rank** (11-21):
  selecting a commit's steps reserves `landing-selection` from its measured
  history, at the landing's rank in the service and an agent's for `--here`
  and `--dry-run`, and the service's and `--here`'s selection hands its
  reservation to the build, or to the gate run when nothing is built
  ([log](records/notebooks/decisions-log.md#a-landings-selection-is-ledgered-at-its-callers-rank-11-21)).
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
  job. Higher-rank yield returns pending-step demand while retaining the
  already-started cohort's completion demand and outstanding drain grants
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
  check's ordinary work first, then agents', then a culprit search's, and a
  landing's last
  ([log](records/notebooks/decisions-log.md#memory-limits-guard-against-runaways-only-11-10)).
- **CPU ranks follow the memory ranks** (11-17): the CPU scheduler shares a
  contended machine by the ledger's ranks, as cgroup CPU weights from one
  table, because every run's steps share `nts.slice` and nice alone, set by
  whoever launched a run, left an agent's run equal to a landing's. All of a
  rank's work, including jobs started from agents' shells, runs under
  `nts.slice` at its rank's weight
  ([log](records/notebooks/decisions-log.md#cpu-ranks-follow-the-memory-ranks-11-17)).
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
  rendered from the newest complete run. Each backend/comparator's within-run
  ratio is compared with its best compatible prior ratio, using the same
  machine, workload/input and harness contract. A change beyond max(1.05, the
  product of the four current/prior cell spreads) is a regression. The report
  shows the comparator, all four factors, their product and the prior run;
  absolute times are information only. Missing or unverified pairs remain
  unestablished. A backend regression requires at least one established pair
  and a regression against every established comparator; individual comparator
  flags remain observations. The nightly reader consumes the backend verdict.
  The benchmark JSON summary uses this same model, in version 2.
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

- **Issue scratch retention is derived.** Open issue state and committed-main
  record citations keep issue-named scratch without per-task keeper edits.
  Missing observations keep it by name; closed uncited folders are reported,
  with deletion held for the user
  ([log](records/notebooks/decisions-log.md#issue-scratch-retention-is-derived-11-15)).

- **Cargo configuration is empty and checked.** The shared Cargo home keeps
  its complete cache protocol. Cargo's two configuration spellings must be
  absent throughout every checked cwd chain before launch and after drain;
  an outside file refuses the run by name rather than changing the build.
  More generally, current parents retain this same guard around historical
  endpoint and pinned-run lifetimes without changing the historical source
  ([log](records/notebooks/decisions-log.md#cargo-configuration-is-checked-11-15)).

- **Own-best benchmark verdicts compare ratios.** Each backend/comparator
  retains a compatible prior within-run ratio. The four current/prior cell
  spreads compound into its allowance, with a 1.05 floor. Markdown and the
  versioned benchmark JSON summary expose the same comparator, factors and
  provenance. At least one established pair and agreement across every
  established comparator decide the backend and nightly row verdict;
  absolute times do not decide a regression
  ([log](records/notebooks/decisions-log.md#own-best-benchmarks-compare-ratios-11-15)).

- **Benchmark build CPU has an explicit basis.** External stages reuse the
  waited-child owner beneath case-bound; nts's sequential compiler phases
  use calling-thread CPU, excluding shared checker work. Missing final
  accounting after a bound kill is distinct from the supervisor's last
  sampled own CPU. Optional versioned row details survive failures and
  journal recovery without changing old records or throughput verdicts
  ([log](records/notebooks/decisions-log.md#benchmark-build-cpu-has-an-explicit-basis-11-15)).

- **Oracle consumers never produce dependency images.** The canonical parent
  prepares and seals them before tests. Missing preparation refuses with the
  owned command; cold/hit and resource proofs execute only in the tooling
  group's staged producer fixture. Installed third-party packages are sealed;
  workspace implementations come from each consumer's live captured closure,
  while metadata and named command targets own the installation identity
  ([log](records/notebooks/decisions-log.md#oracle-consumers-require-prepared-images-11-15)).

- **Standalone oracle preparation belongs to the command entry.** Entries
  share the gate parent's preparation and sealing owner, reuse valid inherited
  seals and hold admission through complete child and infrastructure drain.
  A different source can reuse the parent's image only after producer,
  lockfile and complete installation-input validation; its own canonical
  handoff supplies the source binding. Mismatching inputs prepare normally.
  Versioned seals bind that source and revision in both runtime consumers.
  No cross-run store or fixture-only rebinding API participates.
  Internal commands accept only a sealed-parent handoff. The source audit
  inventories entries and shell Node programs; report-only imports stay in
  pure leaves rather than acquiring preparation or an audit exception
  ([log](records/notebooks/decisions-log.md#standalone-oracle-entry-ownership-11-15)).

- **Compiler project readers name their execution role.** Each project
  descriptor requires `type-check` or `compiled-program`. Type checking owns
  exactly the pinned Program's captured files and observations; runtime URL
  assets and descriptors in checked sources do not execute. A compiled program
  keeps those runtime assets as well as its Program inputs. Distinct role and
  project contexts preserve both visits independently of discovery order.
- **Resolution helper acquisition owns failure cleanup from spawn.** The
  starter joins only its newly spawned helper on failed readiness or session
  validation before releasing output or admission. Successful callers may
  transfer that ownership; reused parent helpers remain owned by their parent.
  A foreign standalone entry with gate admission allocates its entry subtree
  inside the authenticated gate temporary and removes only that subtree after
  child, helper and admission drain. A cold image follows the same lifetime as
  a parent-image hit.

- **Oracle image disposal uses the run's process observations.** Both green
  discard and failed-close disposal consume the required process-users view in
  `HostObservations`. Production retains the existing live ownership scanner
  and its unreadable-process refusal. Fixtures own an empty proc tree or state
  the exact child PIDs they observe live; unrelated machine processes cannot
  decide their cleanup assertions. `gateEnvironment` validates the complete
  named view before creating a run temporary, without sampling its resources,
  and holds that in-process capability through close. A candidate launcher
  acquires its supplied observation packet before invoking another version's
  factory, retains it when that factory has no in-process observation field,
  and refuses a factory that rewrites the descriptor. Direct temporary owners
  acquire an omitted view only inside the image guard that needs it: a failed
  view keeps that image by name and still registers the closed root. A close
  reports each complete image disposition before a fixture checks whether the
  image still exists.

- **A gate run's measure includes its runner.** `OwnerSpec` takes `tree: true`
  beside `cgroup`: the measure is the cgroup's charge plus each process of the
  owner's tree outside it, counted by what it maps. A tree process inside the
  cgroup is in its charge already and is not counted again. `run.mjs` reserves
  with its steps' slice and its own tree, because its runner (broker, samplers,
  reports) runs in its launcher's unit, where no reservation counted it
  ([log](records/notebooks/decisions-log.md#a-memory-wait-names-its-holders-11-17)).

- **Memory census records are observations.** Their versioned program-input
  and static recipe identity requests fresh rows after a recipe or source change;
  home changes have no ordering. Malformed, foreign and corrupted records
  remain errors. The full check publishes each canonical memory-group
  program's observation after landing, through the shared records transaction.
  The landing checks structure, identity and integrity; the core records run
  natively rederives requested rows after each green core and replaces differing
  observations; a row whose source, recipe and known current clean-pin provenance
  all match requests no redundant refresh. Current rows emit distinct refresh requests, and the controller
  starts records on refresh-only green logs; `pending` remains missing/stale.
  Compiler commit and binary identity are provenance only.
  Recording identity uses the shared Program reader; declarative benchmark
  reach belongs to the shared `projectMembers` owner. Until the census reader
  declares those inputs, an imported file outside the case can miss the landing
  census check; green-core native refresh still covers every row.

- **A step's bound spends no CPU that other work takes from it.** The runner
  samples the step slice's `cpu.pressure` `full`, never `some`, whose own
  threads would excuse an oversubscribed step. The excuse is a lower bound,
  never scaled by an estimate. A CPU bound of the bound times the step's width
  backs it, and the bound has no separate stall limit
  ([log](records/notebooks/decisions-log.md#a-steps-bound-spends-no-cpu-that-other-work-takes-11-24)).

- **The full check's run bound measures progress, not wall time.** A run is
  held when it has stalled outside its own waits for its stall bound, when no
  step has run, started or finished for its lifecycle bound, or when it has
  used its CPU bound. Its own fitting requests and yields to requests waiting
  on other work's memory excuse it, never a yield to a request waiting on its
  own memory; CPU that higher ranks take spends nothing.
  No wall bound remains; the live progress receipt makes an endless wait
  visible in the status
  ([log](records/notebooks/decisions-log.md#the-full-checks-run-bound-measures-progress-11-19)).

- **A temporary's disk wait is named, never excused.** One owner waits
  (`TemporaryAdmission.acquire`) and records the waiting request with the
  holders of the disk it needs. The run bound, its receipt and its held reason
  name it; the wait spends the stall bound, because a build promise held by an
  idle tree never ends on its own
  ([log](records/notebooks/decisions-log.md#a-temporarys-disk-wait-is-named-never-excused-11-23)).

- **A culprit search outranks agents' work.** Its probes run at a rank of
  their own, below a landing and above agents' work, chosen by the
  controller per probe run; ledger entries at that rank are version 4,
  which older readers refuse by name
  ([log](records/notebooks/decisions-log.md#a-culprit-search-outranks-agents-work-11-21)).

- **Core work advancing stale verified shares the culprit-search rank.** At
  launch the controller requires a strict ancestor `verified` and an oldest
  outstanding first-parent commit unverified on main for more than two hours
  since its recorded landing. Missing or invalid landing evidence is named
  and retains full-check rank; committer time is no substitute.
  The rank ends with the run; fresh core work, wide runs, records and
  benchmarks keep full-check rank. The bound follows the
  [measured core cycles](records/full-check-stale-verified.md)
  ([log](records/notebooks/decisions-log.md#landing-time-owns-stale-verified-age-11-21)).

- **Stopped exec vectors share the kernel budget.** The native reader owns
  growing argv and environment storage through serialization, bounded by the
  combined exec limit and each string's limit. Protocol-owned definitions keep
  producer, frame and versioned row bounds consistent. An unreadable vector
  remains a named unavailable receipt
  ([log](records/notebooks/decisions-log.md#stopped-exec-vectors-share-the-kernel-budget-11-19)).
