# How we work

Nine sessions ("lanes") work on nts at once, on one machine. This is how they
stay out of each other's way. The decision and its reasons are record 0355;
the rules every session follows every time are in `AGENTS.md`.

## Where things are

| What | Where |
|---|---|
| `main`, and nothing else | `~/Projects/nts`. Landing-only: nobody edits here. |
| A lane's work | `~/Projects/nts-lanes/<lane>`, one long-lived worktree per lane. |
| Who owns which paths | `tooling/lanes/lanes.json` |
| Pinned compilers for measuring | `~/.cache/nts-pins/<12 hex>/nts` (`tooling/conformance/pin.ts`) |
| The gate's tree | one, shared, used only through `land` |
| Archived branches and worktree heads | `refs/archive/…` (`git for-each-ref refs/archive`) |

Every archive ref has a row in `tooling/lanes/archive.tsv`: its lane, what it
holds, why it is parked and what resuming needs. Use `unknown` where the
history does not say. Record new archives in a reviewed registry update;
`branches.ts` refuses missing rows and rows whose refs no longer exist.
`lane status` and every full run show uncatalogued archives and branches
older than three days whose changes are not proved on main.

The shared checkout supplies what no commit carries: the corpora in
`third_party/*` and immutable frontend builds in `target/tsgo.d/`. A tree's
`target/tsgo` links its own gitlink and ordered carried patch contents. Its
`third_party/typescript-go` is a real, patched worktree at that gitlink, in
both lane and gate trees; neither follows main's current frontend pin.

Build a missing frontend without cargo or corpora:

```sh
sh tooling/bootstrap/bootstrap.sh --tsgo-only ~/Projects/nts
```

Run this from the tree that needs the build. The shared cache key is the full
gitlink plus a SHA-256 of the ordered patch names and contents. Builds publish
atomically under a per-key lock, and existing keys are verified and reused.
`inputs.sh` refuses a missing or modified build by name. Conformance pins
record the immutable binary path and its hash, so preparing another pin never
changes an earlier pin's frontend. Old provenance is rebuilt once on reuse.

Old keys are never pruned automatically: a long-lived lane or recorded pin may
still use any of them. Remove a key manually only after checking every tree's
`target/tsgo` and the provenance of saved pins, and confirming no running job
uses it. A failed build removes its own staging directory; it cannot replace
an existing key.

## A lane's tree

- **Branches are `<lane>/<topic>`**, the prefix from `lanes.json`. Switch topics
  inside your tree; open a second tree (`~/Projects/nts-lanes/<lane>-<topic>`)
  only while two topics are genuinely in flight.
- **Its cargo target is its own `target/`.** Never point `CARGO_TARGET_DIR` at
  another tree's: cargo reuses the other tree's compiled crates and you run
  code you did not write. A target is 15–40 GB, so delete `target/debug/incremental`
  after a test run.
- **`git stash` is shared by every worktree.** Commit work in progress as a
  `WIP:` commit instead (`land` refuses one).
- **Scratch work does not need a tree.** A control or a bisect is a pin:
  `node tooling/conformance/pin.ts <rev>` (with `--patch <file>` for a
  sabotage). When a throwaway tree is unavoidable, put it under
  `~/.cache/nts-scratch/<lane>/` and remove it when you are done.

## Landing

```sh
node tooling/lanes/land.ts <commit> --dry-run   # what it owes
node tooling/lanes/land.ts <commit>             # gate and land; ~30 min, run it in the background
```

Run it from your tree, at the commit you are landing, bare (never inside a
lock of your own). It:

1. joins the queue and waits for the landing lock (a kernel lock; it also
   honours the old `GATE-RUNNING` marker while lanes move over);
2. **lands a train**: whoever holds the lock gates every queued landing at
   once, up to six, oldest first. Each one's commits since it left `main` are
   replayed onto `main`, the next onto the last; one that conflicts is
   refused (rebase by hand and land again), and the train goes on without it;
3. asks `owed.mjs --range main..<tip>` which gate steps the train owes, and
   which interop projects: a change inside one project builds that project,
   a JVM backend change the projects built on the JVM, and anything it cannot
   narrow every project (`interop` is half an hour of GTK builds);
4. runs exactly those, with `pinned.sh`, in the one gate tree;
5. lands the train only on a green summary that names its tip with every owed
   step PASS. A red train of more than one is halved, and its first half gated
   next, down to the landing that is red on its own: that one is refused, the
   rest land;
6. records the run as a git note on the tip (`git notes --ref=land show <commit>`).

After success, the originating process removes its own submission tree under
`~/.cache/nts-scratch/` only if its HEAD and checkout branch are unchanged, it has no work, and
no other process has its cwd there. Lane homes and tool-owned build caches
stay. It deletes the topic ref with a compare-and-swap only after every
commit is proved on main by ancestry or stable patch IDs, and only when no
worktree checks it out. A checked-out topic stays attached; the inventory
labels it `landed, still checked out`. Subject-only matches never qualify.
The upkeep decisions are logged in `~/.cache/nts-land/upkeep.jsonl`.
Each successful landing revisits only topic refs that this tool previously
recorded as successfully landed. It classifies their current tips, keeps
any new unlanded work, and CAS-deletes a proved tip only once every checkout
has gone. `lane status` shows those revisit outcomes. Branches never submitted
to `land` are outside this automatic cleanup.

The user policy dated 2026-10-23 allows Apple and Windows platform SKIPs
through `lanes.json`'s `platforms_unrun_ok` list. The landing note records
when that policy accepted an unrun platform; other platform refusals and
the explicit `--accept-unrun=… --because=…` override keep their usual rules.

Your landing's own process prints what became of it when its turn comes,
whoever gated it. So queue a change as soon as it is ready: a gate costs the
same for one landing as for six. `~/.cache/nts-land/trains.tsv` has a line per
train: size, verdict, wall time.

A change to `compiler/` or `runtime/c/` from another lane is reviewed by the
compiler lane before it lands. `land` never pushes to `origin`.

## What is going on

```sh
node tooling/lanes/lane.ts status          # every tree: lane, branch, ahead/behind main, dirty, age
node tooling/lanes/lane.ts status --json   # the same, for an agent
```

The last landing, what holds the gate, and the landings queued are at the top. A tree on a branch
no lane claims, or detached, is listed as such: those are the ones to ask about.

## Finishing a topic

When `land` has landed your branch, start the next topic from `main` in the
same tree. A branch that will not land is archived, not deleted:
`git update-ref refs/archive/<branch> <branch> && git branch -D <branch>`.
