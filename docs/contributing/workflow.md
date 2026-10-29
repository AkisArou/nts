# How work is done

Several sessions, called lanes, work on nts at once on one machine. This page
is how they stay out of each other's way, how a change reaches `main`, and
who decides what. The rules every session follows every time are in
[`AGENTS.md`](../../AGENTS.md); what the work has taught is in
[`lessons/`](lessons).

## Roles

- **The user** owns product direction, spending, and anything that deletes or
  overwrites shared state.
- **The coordinator** (MainClaude) decides, designs and reviews. Every change
  to `compiler/` or `runtime/c/` from another lane is reviewed by it before it
  lands. Branch and worktree cleanup is its call:
  - landed branches are deleted;
  - branches with unique work are archived (`refs/archive/…` plus a row in
    `tooling/lanes/archive.tsv`);
  - a worktree goes when it is clean, idle and its branch is done;
  - the Chromium checkout and that lane's branches stay.
- **Implementing agents** implement and measure, each in its own lane.
- **Earlier agents' archived branches** (`refs/archive/codex/…`) are a quarry:
  an independent fix is ported to `main` on its own, with its own fixture and
  gate, never landed wholesale.

## Where things are

| what | where |
|---|---|
| `main` | `~/Projects/nts`. Landing only: nobody edits there except the coordinator's documentation. |
| A lane's work | `~/Projects/nts-lanes/<lane>`, one long-lived worktree per lane |
| Who owns which paths | `tooling/lanes/lanes.json` |
| Pinned compilers, for measuring | `~/.cache/nts-pins/<12 hex>/nts` (`tooling/conformance/pin.ts`) |
| The gate's tree | one, shared, used only through `land` |
| Archived branches and worktree heads | `refs/archive/…`, each with a row in `tooling/lanes/archive.tsv` |

The shared checkout supplies the inputs no commit carries (`third_party/*`).
The TypeScript checker is vendored at `third_party/tsrs` and compiled into each
`nts` binary, and a pin records the complete binary hash. Input preparation
runs from the candidate tree's own `tooling/lanes/inputs.sh`.

`branches.ts` refuses an archive ref with no row, and a row whose ref is gone.
`lane status` and every full run list uncatalogued archives, and branches
older than three days whose changes are not on `main`.

## A lane's tree

- **Branches are `<lane>/<topic>`,** with the prefix from `lanes.json`. Switch
  topics inside your tree. Open a second tree
  (`~/Projects/nts-lanes/<lane>-<topic>`) only while two topics are in flight
  at once.
- **Its cargo target is its own `target/`.** Never point `CARGO_TARGET_DIR` at
  another tree's: cargo reuses that tree's compiled crates, and you run code
  you did not write. A target is 15–40 GB, so delete `target/debug/incremental`
  after a test run.
- **`git stash` is shared by every worktree.** Commit work in progress as a
  `WIP:` commit instead (`land` refuses one).
- **Scratch work does not need a tree.** A control or a bisect is a pin:
  `node tooling/conformance/pin.ts <rev>`, with `--patch <file>` for a
  sabotage. When a throwaway tree is unavoidable, put it under
  `~/.cache/nts-scratch/<lane>/` and remove it when you are done.

## Landing

```sh
node tooling/lanes/land.ts <commit> --dry-run   # what it owes
node tooling/lanes/land.ts <commit>             # gate and land; about 30 min, run it in the background
```

For a detached systemd user unit, start from a login shell and run
`node tooling/lanes/land-unit.ts <commit> <name>`. It resolves the commit in
your tree, creates an isolated submission, checks it, and queues it with the
gate's environment (`tooling/gate/environment.ts`). It prints the unit and the
log path.

Run `land` from your tree, at the commit you are landing, bare: never inside a
lock of your own. It:

1. **joins the queue:** it records a durable entry under
   `~/.cache/nts-land/pending` and polls for its answer. A train service, one
   systemd unit the lander owns, holds the landing and gate-tree locks while a
   train runs, and releases both between trains and whenever it is idle;
2. **gates a train:** the service gates every compatible queued landing at
   once, up to six, ancestry first. Each landing's commits since it left
   `main` are replayed onto `main`, each onto the last. One that conflicts is
   refused (rebase it and land again), and the train goes on without it. The
   service's log names each landing it leaves out, and why;
3. **asks `owed.mjs --range main..<tip>`** which gate steps and which interop
   projects the train owes;
4. **runs exactly those** with `pinned.sh`, in the one gate tree;
5. **lands the train only on a green summary** naming its tip, with every owed
   step passing; a train whose measurement could not finish is held instead
   (below). On a red train it first runs the failed steps on `main` itself:
   - a step red on `main` is reported as "red on main", and only the landings
     that owe it are refused;
   - otherwise the train is halved, each half running what it owes plus the
     failed steps, down to the landing that is red on its own: that one is
     refused, and the rest land;
6. **records the run** as a git note on the tip
   (`git notes --ref=land show <commit>`).

The service runs `main`'s lander. After a landing changes `tooling/lanes` or
`tooling/gate`, it moves to the new `main` at the next boundary. A train that a
crash interrupts is gated again from its recorded members before anything new
is composed.

- **Withdrawing:** `land.ts --withdraw <commit>` asks for a landing to leave the
  queue before the next train is composed. Stopping a submitting process
  withdraws nothing.
- **A stalled train:** stop its unit by name, then answer it with
  `land.ts --abandon-frozen <owner-id> --because=<reason> --run=<run dir>`,
  which records the reason before it frees the queue.
- **A held train:** a step that memory pressure kept from measuring runs again
  on the same train once memory allows, keeping the results that completed.
  A hung tooling file, a broken instrument, a summary that is missing,
  unreadable or names another commit, or an unmeasured baseline holds the
  train instead: only its members wait, and a landing stacked on one waits
  with it. Nothing is attributed or halved, and other landings keep going.
  `lane status` prints each held entry with its reason, its run directory and
  its two answers: `land.ts --retry-held <identity> --because=<note>` queues it
  again, and `land.ts --refuse-held <identity> --because=<note>` refuses it,
  recording the note beside the measurement. A hold never passes by itself.

Landings and full runs refuse a missing environment requirement before taking
the lock. Steps declare capabilities (`jvm`, `android`, `valgrind`), and an
interop project declares its own with a `# nts-gate-capabilities:` header in
its `build.sh`.

Queue a change as soon as it is reviewed: a gate costs the same for one landing
as for six, and your landing's process prints what became of it, whoever gated
it. `~/.cache/nts-land/trains.tsv` has a line per train, with its size, verdict
and wall time. `land` never pushes to `origin`.

After a landing, its own process removes its submission tree and deletes the
topic ref, each only when every commit is proved on `main` (by ancestry or a
stable patch ID) and nothing else uses them. These decisions are logged in
`~/.cache/nts-land/upkeep.jsonl`.

### Landing rules

- **A change that owes the full gate for hygiene alone** (a comment sweep over
  the gate's scripts, or a path with no rule in `owed.mjs`) lands on its own, in
  a quiet window, never inside urgent work.
- **Apple and Windows programs may stay unrun** when a landing's only refusals
  are their platform skips (`platforms_unrun_ok` in `lanes.json`). Platform
  issues are fixed when they surface.
- **A red that only affects the paused JVM** does not block a landing. It is
  recorded in `tooling/conformance/jvm-declines.known` and fixed afterwards,
  in parallel.
- **Documentation goes straight to `main`.** The coordinator writes docs-only
  changes in `~/Projects/nts` and commits them without a gate, holding the
  landing lock, while no train is running. While the queue is busy, it
  submits them with `land-unit.ts` instead, and the service fast-forwards a
  checked docs-only commit at the next train boundary.

## Reporting

- **Every benchmark result is shown as it is produced:** its ratios against
  node and Bun, the machine's conditions, and the verdict (regression,
  improvement or noise), losing rows included.
- **The user is kept in the loop** on progress, especially benchmark and
  optimization results.

## What is going on

```sh
node tooling/lanes/lane.ts status          # every tree: lane, branch, ahead/behind main, dirty, age
node tooling/lanes/lane.ts status --json   # the same, for an agent
```

The last landing, what holds the gate and the queued landings are at the top.
A tree on a branch that no lane claims, or a detached tree, is listed as such.

## Finishing a topic

When `land` has landed your branch, start the next topic from `main` in the
same tree. A branch that will not land is archived, not deleted:
`git update-ref refs/archive/<lane>/<branch> <branch> && git branch -D <branch>`,
with its row in `archive.tsv`.

## The TypeScript corpus

`node tooling/bootstrap/typescript.ts` prepares TypeScript's own test corpus
at the TypeScript commit the frontend records: a shallow, sparse checkout of
`/tsc/testdata/tests/`, unedited, and linked into lane and gate trees by
`inputs.sh`. The gate's `corpus` step compiles the manifest in
`tooling/suite/corpus-core.json` and requires no invalid HIR, no uncompilable C
and no unverifiable class. Its `typescript-cases` step reproduces every
recorded case on every backend ([conformance](../conformance/typescript.md)).

## Decisions

- **A cloud agent works through pull requests** under the rules of
  [cloud-agents.md](cloud-agents.md), and a local agent lands its work
  (10-28, [log](../records/notebooks/decisions-log.md#contributors-and-packages-10-28)).

- **Team and process:**
  - the coordinator and the roles;
  - the archived branches as a quarry;
  - cleanup as the coordinator's call;
  - docs straight to `main`;
  - landings organized for speed;
  - the Apple, Windows and JVM rules.

  See the [log](../records/notebooks/decisions-log.md#team-and-process).
- **Reporting:** showing every benchmark result, and keeping the user in the
  loop ([log](../records/notebooks/decisions-log.md#the-bar)).
- **The fast landing model** is approved: precise rules with a fast lane, a
  faster gate, and land-then-verify for code. This page changes when its
  tools land ([log](../records/notebooks/decisions-log.md#gate-and-landing-10-27)).
- **The process itself** is record 0355
  ([one worktree per lane, and landing by tool](../records/0355-one-worktree-per-lane-and-land-by-tool.md)).
- **Measuring** (10-28,
  [log](../records/notebooks/decisions-log.md#performance-and-process-10-28)):
  - the noise rule: rounds of before, after and before again, over at least 5
    processes; instruction counts decide regressions; wall time has a floor of
    max(3%, twice the spread); and where a row's layout range exceeds the
    effect, the layout-interval instrument decides (P-3): at least 20
    independent code and heap layouts per arm, A/B/A brackets in each, and a
    99% bootstrap interval over the layouts. An interval wholly below zero is
    an improvement, wholly above zero a regression, and one containing zero is
    noise ([how to run it](../../tooling/bench/README.md#layout-intervals));
  - every comparator's version is pinned (node, Bun, the JDK and clang),
    every report records the machine's load, and reference numbers are taken
    whenever the landing lock is free and the load is low (P-4).
- **The full run** (10-28, same log entry):
  - a nightly full run, and a weekly one with result caches off; `--touching`
    selects tests only after a test proves that it selects deterministically
    (Q-3);
  - it gates native instruction counts per benchmark row, against the noise
    band, starting with the counting drivers (P-5);
  - it includes a sanitized, reference-counted differential run over the whole
    corpus (Q-7);
  - the compile-time guard adds backend code generation and link time (P-6);
  - result caches key on the schema, compiler and runtime digests (X-7,
    [log](../records/notebooks/decisions-log.md#debugging-security-and-versioning-10-28)).

  The cadence, the count gate, the sanitized run and the guard's additions
  are not built yet.
