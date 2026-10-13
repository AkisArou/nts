# Working on nts

Rules for every contributor, human or agent. Each is here because breaking it
cost real time; the reason is beside it. What working on nts has taught beyond
these is in [`docs/agents/lessons/`](docs/agents/lessons): read the topic before
working in it.

nts compiles TypeScript ahead of time to native code, the JVM, WebAssembly and
Node addons. The README says how; [`docs/README.md`](docs/README.md) indexes the
rest.

## Lanes

Several sessions work at once, each in a lane. [`tooling/lanes/lanes.json`](tooling/lanes/lanes.json)
says who owns which paths and which branch prefix each uses.

- Edit only your lane's paths. Announce an edit to a shared or another lane's
  path to its owner before making it: two sessions editing one file lose hunks.
- The compiler lane reviews every change to `compiler/` or `runtime/c/` from
  another lane before it lands.
- Report a compiler defect as a gated fixture (below), then a one-line pointer
  to the compiler lane, not as prose.

## Your tree, and the shared checkout

Work in your lane's own worktree, `~/Projects/nts-lanes/<lane>`, on branches
`<lane>/<topic>` (`docs/workflow.md`). `~/Projects/nts` is `main` and is
landing-only: nobody edits there. It supplies the inputs no commit carries
(`third_party/*`, `target/tsgo`), and every tree shares its object store.

- `git stash` is shared by every worktree: commit work in progress as a `WIP:`
  commit instead.
- Sabotage and control experiments run only after the fix is committed:
  restoring the "before" state with `git checkout` has destroyed the fix
  itself. A control is usually a pin (`tooling/conformance/pin.ts`), not a tree.
- Never `pkill -f` or `pgrep -f` a pattern: it matches other lanes' processes
  and your own shell. Kill exact PIDs you started.

Until your lane has moved into its tree, you share the checkout's one git
index with everyone still in it: commit with
`tooling/gate/commit-mine.sh -F <msg-file> -- <paths>`, never `git add -A` or
`git commit -a` (either sweeps a peer's uncommitted work into your commit),
and never `git checkout --`, `git reset --hard` or `git stash` paths you did
not change.

## Landing

Nothing reaches `main` except a fast-forward to a commit that passed the gate
steps it owes. `land` does the whole of it (see `docs/workflow.md`):

```sh
node tooling/lanes/land.ts <commit> --dry-run   # the steps it owes
node tooling/lanes/land.ts <commit>             # gate and land, ~30 min: run it in the background
```

Run it from your tree at that commit. It refuses a commit not on top of
`main`, gates exactly what `owed.mjs` says the commits owe (choosing steps by
hand is how `main` went red), one gate at a time, and lands only on a green
summary with `main` unmoved. Never `git merge` onto `main` yourself.

Before you land, run the gate's own commands, not look-alikes:
`cargo fmt --all`; `cargo clippy --workspace --all-targets -- -D warnings`;
`cargo test --no-fail-fast` over every crate you touched *and the backend
crates* (`-p nts-codegen-{c,llvm,jvm,wasm}`), with `NTS_TSGO=$PWD/target/tsgo`
set; and `clang-format --style=file --dry-run -Werror` on any `runtime/c` file
you edited. A core change that passes core's tests has broken a backend's more
than once; a test without `NTS_TSGO` skips itself and reports ok; and without
`--no-fail-fast` cargo stops at the first failing test binary and silently
skips the rest. After committing, read `git show --name-status HEAD`: a new
file left untracked is a commit nobody can build.

## Fixtures

The corpora are the specification: `examples/` (compiled and compared with
node), `tooling/conformance/blockers/` (must refuse, with the `// expect:`
message), `tooling/conformance/outcomes/` (a recorded wrong answer or crash,
then a guard once fixed), `tooling/memory/cases/`.

- A defect is reported as a fixture with a **control** that differs from it in
  one thing and agrees with node, so the fixture shows what breaks it.
- Many `examples/` entries are a specific test's input: check before editing or
  reusing one.
- A new blocker or outcome whose refused function runs at module scope cuts
  that statement; register the cut in `tooling/conformance/integrity.known` in
  the same commit.
- Run a new fixture against the previous compiler too: if it passes on both, it
  does not test the fix.

## Compiler contracts

- A change to the semantic schema (a field added, removed or retyped in
  `compiler/semantic-schema/src/schema.rs`) bumps `SCHEMA_VERSION` in the same
  commit, to the next number even if another lane bumped it today.
- A new C runtime helper owes a row in four tables in four crates, each checked
  by a test in *its* crate: follow the checklist at the top of the helper block
  in `runtime/c/nts_runtime.h`. A forgotten row reds a lane that never calls
  the helper.
- A new `OpKind` reaches every `_ =>` match over ops; audit them before the
  first probe.
- Refusals live in two lists: lowering's `program.uncompiled` and each backend's
  own.
- `nts emit-c` and `nts check` print refusals on stderr and exit 0 while
  compiling what they can. Read stderr.
- `nts hir` shows raw lowering; `nts hir --prepared --backend <b>` is what a
  backend sees.
- Running with a different `NTS_TSGO` poisons the snapshot cache: set
  `NTS_NO_SNAPSHOT_CACHE=1`.

## The machine

- The shell is zsh: an unquoted `$var` does not word-split. `cp`, `mv`, `rm` and
  `ls` are aliased (`cp -i` hangs a script): use `command cp`. `grep` is ugrep:
  use `awk` where a miss would matter.
- `/tmp` is a 16 GB tmpfs with a per-user quota, and it runs out of inodes
  before bytes; a full one makes writes fail silently. Use `~/.cache/...` for
  build output, logs and `TMPDIR`.
- One cargo target per worktree: two trees sharing one reuse each other's
  compiled crates and run the wrong code. A target is 15–40 GB; delete its
  `debug/incremental` after a test run and check `df -h /` before starting one.
- A tsgo snapshot of a large program takes gigabytes: cap parallel frontends,
  and check `journalctl -k` for OOM kills before blaming a crash.
- Benchmark on the P-cores (CPUs 0–15) only, from a worktree pinned to a
  commit, and compare ratios within one run, never absolute times across runs.
  `nts-bench` links the compiler crates directly: run a plain
  `cargo build --release` (no `-p`) before measuring a compiler change.
- A gate or bench run drives `target/release/nts` unless told otherwise: pass
  `NTS_BIN` for any other build.
- Never edit a gate script (`all.sh` and its helpers) while a run of it is
  executing from that tree: the shell reads a running script incrementally.
- System packages come from `paru`.
