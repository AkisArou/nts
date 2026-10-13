# 0355 — One worktree per lane, and land by tool

**Decided 2026-10-13, by the user, on the compiler lane's proposal.**

## What was wrong

Nine sessions work on nts at once. On 2026-10-13 the repository held 168
worktrees and 352 local branches; nobody could say which were live. Several
lanes edited the shared checkout directly, which shares one git index between
them, and the incidents were recorded more than once: a `git add -A` swept a
peer's uncommitted work into a commit, a peer reset another's edits, an
uncommitted file blocked a fast-forward. Worktrees had no lifecycle and no
gitignored inputs, so they measured wrong (a blocker read as fixed because
`node_modules/@types/node` was missing). And every lane landed by hand: on the
same day one landing skipped an owed step and left `main` red, one commit went
onto `main` ungated while another lane's gate held the marker, and one release
truncated the marker instead of removing it and stalled the queue.

## Decision

- **The shared checkout `~/Projects/nts` is landing-only:** always `main`,
  moved only by a fast-forward to a gated commit. It supplies the large
  read-only inputs (third_party, `target/tsgo`).
- **One long-lived worktree per lane**, `~/Projects/nts-lanes/<lane>`, on
  branches `<lane>/<topic>`, with its cargo target in its own `target/`. Lanes
  and their paths are in `tooling/lanes/lanes.json`.
- **Landing is a tool**, `tooling/lanes/land.ts`: the steps `owed.mjs --range`
  computes from the commits, one gate at a time under a kernel lock, and a
  fast-forward only on a green summary naming the commit, with `main`
  unmoved.
- **Unmerged branches are archived**, never lost: `refs/archive/<name>`.

## Why not the alternatives

- **A worktree per topic** multiplies cargo targets (15–40 GB each), which is
  how 168 worktrees filled the disk. A lane's tree reuses its target across
  topics.
- **Separate clones** would lose the shared object store that pins, the gate
  tree and review all read commits from.
- **Keeping the hand ritual with better documentation** had been tried: the
  rules were written down and followed correctly many times before they
  weren't.

How it works day to day is `docs/workflow.md`.
