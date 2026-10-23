# Working on nts

Rules for every contributor, human or agent. Each is here because breaking it
cost real time; the reason is beside it. What working on nts has taught beyond
these is in [`docs/agents/lessons/`](docs/agents/lessons): read the topic before
working in it.

nts compiles TypeScript ahead of time to native code, the JVM, WebAssembly and
Node addons. The README says what it is for; [`docs/architecture.md`](docs/architecture.md)
says how it works, and [`docs/README.md`](docs/README.md) indexes the rest.

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

Run it from your tree at that commit, **bare**: never inside a `flock` or a
lock of your own. It takes the landing lock itself; a wrapper holding it while
`land` waited stopped every lane's landing for most of an hour, and `land` now
refuses to run under one. Landings queue, and whoever holds the lock next gates
every queued one as **one train**: replayed onto `main` in turn, gated once
for exactly what `owed.mjs` says the range owes (choosing steps by hand is how
`main` went red), and landed together on a green summary. A red train is
halved until the red landing is alone, and only it is refused. One gate is
half an hour whether it carries one landing or six, so queue a change as soon
as it is reviewed and ready; `lane status` lists the queue. Never `git merge`
onto `main` yourself.

A landing runs the core steps. The wide ones -- integrity, the profile,
addons, interop, counting, memory and the rest (`WIDE` in `tooling/gate/owed.mjs`
says which, and why) -- run in the **full run**, `node tooling/census/full.ts`,
on a pin of main, started by hand when the queue is quiet. A step red there is
red on main: bisect it over the landings since the last green full run and fix
it before new work.

Before a lowering change goes to the gate, also run the five test262 records
the gate checks (all.sh's `test262_cases`, `test262_builtins_cases`,
`test262_rest_cases`: `conformance262.ts --under <dir> --recorded <tsv>`
against a pin). They take minutes, and they caught seventeen regressions that
fixtures, examples and blockers did not.

Before you land, run the gate's own commands, not look-alikes:
`cargo fmt`; `cargo clippy --workspace --all-targets -- -D warnings`;
`cargo test --no-fail-fast` over every crate you touched *and the backend
crates* (`-p nts-codegen-{c,llvm,jvm,wasm}`), with `NTS_TSGO=$PWD/target/tsgo`
set; and `clang-format --style=file --dry-run -Werror` on any `runtime/c` file
you edited. A core change that passes core's tests has broken a backend's more
than once; a test without `NTS_TSGO` skips itself and reports ok; and without
`--no-fail-fast` cargo stops at the first failing test binary and silently
skips the rest. After committing, read `git show --name-status HEAD`: a new
file left untracked is a commit nobody can build.

`node tooling/gate/inner.ts` runs all of these, then agree on four backends
against main's pinned compiler, building the tests in the incremental
`nts-dev` profile: the workspace's tests built cold in 6 minutes and ran in 8
on 2026-10-22, where the release build took about 40 beside a gate. The gate
still builds release; this is so the gate is not where you find out.

## Fixtures

The corpora are the specification: `tests/programs/` (compiled and compared with
node), `tests/refusals/` (must refuse, with the `// expect:`
message), `tests/outcomes/` (a recorded wrong answer or crash,
then a guard once fixed), `tests/memory/`.

- A defect is reported as a fixture with a **control** that differs from it in
  one thing and agrees with node, so the fixture shows what breaks it.
- Many `tests/programs/` entries are a specific test's input: check before editing or
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
- A new C runtime helper owes a row in four tables in four crates, and every
  function the header declares one more in the Wasm catalog, each checked by a
  test in *its* crate: follow the checklist at the top of the helper block in
  `runtime/c/nts_runtime.h`. A forgotten row reds a lane that never calls the
  helper.
- A new `OpKind` reaches every `_ =>` match over ops; audit them before the
  first probe.
- Refusals live in two lists: lowering's `program.uncompiled` and each backend's
  own.
- `nts emit-c` and `nts check` print refusals on stderr and exit 0 while
  compiling what they can. Read stderr.
- `nts hir` shows raw lowering; `nts hir --prepared --backend <b>` is what a
  backend sees.
- The snapshot cache is keyed by content: the frontend's own source, tsgo's
  identity and every file an answer read. Another `NTS_TSGO` or a rebuilt
  frontend is a new question, so neither needs `NTS_NO_SNAPSHOT_CACHE=1` any
  more; that variable stays for ruling the cache out of a defect.

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
- **Gates run back to back, so heavy work runs beside them:** `nice -n 19`, one
  heavy job of yours at a time, a heavy phase started only when `MemAvailable`
  (`/proc/meminfo`) is at least 14 GB. Below 12 GB, stop starting new cases
  (the conformance feeder and gate-pool tokens); let running cases finish, and
  resume admission at 14 GB. The gate's token pool and the conformance
  runner's feeder hold it themselves (`tooling/gate/admission.ts`); work of
  your own outside them holds its next case or phase by hand. Never SIGSTOP timed work:
  its wall-clock timeout keeps running, so suspension fabricates a timeout.
  A gate step's memory pre-check is what a neighbour breaks, and a red gate
  costs its lane a half-hour rerun.
- **CPUs 4–5 (hyperthread siblings of one physical P-core) are reserved for
  measurement.** Gates and heavy jobs exclude both: `taskset -c 0-3,6-31`
  (or a narrower set, such as E-cores `16-31`). `land.ts` and `pinned.sh`
  apply the exclusion without widening their inherited affinity. A user scope
  with `AllowedCPUs` enforces a kernel ceiling when cpuset is delegated and a
  widening probe proves it. Otherwise the log says `best-effort`: a library
  such as Mesa can widen a taskset mask. Never change an in-flight gate's mask.
- Benchmark on CPU 4 with sibling 5 idle, under
  `tooling/gate/with-lock.sh --wait`, from a worktree pinned to a commit.
  The wrapper waits only for CPUs 4–5 to be quiet and sets `NTS_BENCH_CPUS=4`;
  a command other than `nts-bench` needs its own `taskset -c 4`.
  Compare ratios within one run, never absolute times across runs.
  `nts-bench` links the compiler crates directly: run a plain
  `cargo build --release` (no `-p`) before measuring a compiler change.
- A gate or bench run drives `target/release/nts` unless told otherwise: pass
  `NTS_BIN` for any other build.
- Never edit a gate script (`all.sh` and its helpers) while a run of it is
  executing from that tree: the shell reads a running script incrementally.
- System packages come from `paru`.
