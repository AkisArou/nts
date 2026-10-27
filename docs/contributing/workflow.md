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

1. **joins the queue** and waits for the landing lock (a kernel lock; it also
   honours the `GATE-RUNNING` marker);
2. **gates a train:** whoever holds the lock gates every queued landing at
   once, up to six, oldest first. Each landing's commits since it left `main`
   are replayed onto `main`, each onto the last. One that conflicts is refused
   (rebase it and land again), and the train goes on without it;
3. **asks `owed.mjs --range main..<tip>`** which gate steps and which interop
   projects the train owes;
4. **runs exactly those** with `pinned.sh`, in the one gate tree;
5. **lands the train only on a green summary** naming its tip, with every owed
   step passing. On a red train it first runs the failed steps on `main`
   itself:
   - a step red on `main` is reported as "red on main", and only the landings
     that owe it are refused;
   - otherwise the train is halved, each half running what it owes plus the
     failed steps, down to the landing that is red on its own: that one is
     refused, and the rest land;
6. **records the run** as a git note on the tip
   (`git notes --ref=land show <commit>`).

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
  landing lock, while no train is running.

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
