# Working on nts

Rules for every contributor, human or agent. Each is here because breaking it
cost real time; the reason is beside it. What working on nts has taught beyond
these is in [`docs/contributing/lessons/`](docs/contributing/lessons): read the topic before
working in it.

nts compiles TypeScript ahead of time to native code, the JVM, WebAssembly and
Node addons. The README says what it is for; [`docs/architecture.md`](docs/architecture.md)
says how it works, and [`docs/README.md`](docs/README.md) indexes the rest.

## Always the best architecture

**Build the best design you know, never an interim step toward it** (user,
2026-10-28). A profile or review sometimes shows a cost the right design
removes: a conversion, boxing or tag dispatch the types already rule out, or
work a known native implementation does faster. Then build that design
directly. A smaller fix inside the wrong representation is not a step toward
the right one; it is work to undo. nts has no users yet, so nothing is fixed:
refactor or replace representations, runtimes and code outright. If the best
design isn't known, measure until it is, then build it.

## Tasks

Work is a task in [`docs/plan.md`](docs/plan.md): one agent per task, small
enough to land within a day ([`docs/workflow.md`](docs/workflow.md)).

- Two tasks editing one file lose hunks: before editing a file another open
  task is changing, say so to that task's agent.
- A change to the compiler's core (`compiler/`, `runtime/c/`), the gate or the
  landing tools is read by the coordinator before it is submitted.
- Report a compiler defect as a fixture (below), then a task line in
  `docs/plan.md`, not as prose.

## Your tree, and the shared checkout

A task works on one branch named after it, in a worktree from the pool:

```sh
node tooling/landing/pool.ts take <branch>   # a free tree at the newest main, on a new branch
node tooling/landing/pool.ts status          # which task holds which tree
node tooling/landing/pool.ts give <branch> --discard   # drop a task: its branch, here and on GitHub, goes too
```

`take` reuses a warm tree or makes a new one while the disk can host it.

Never make a worktree of your own: the pool's trees keep their build folders
warm, and the full check counts every tree outside it as red. Landing gives
the tree back. `~/Projects/nts` is `main`, and nobody edits there. It
supplies the inputs no commit carries (`third_party/*` corpora); the native
checker is compiled into nts, and every tree shares the object store.

- `git stash` is shared by every worktree: commit work in progress instead.
- Sabotage and control experiments run only after the fix is committed:
  restoring the "before" state with `git checkout` has destroyed the fix
  itself. A control is usually a pin (`tooling/conformance/pin.ts`), not a tree.
- **Stop your own work by its systemd unit, never by a list of PIDs.** Start
  every long run in a named unit (`systemd-run --user --unit=<name>`) and stop
  it with `systemctl --user stop <name>`: the cgroup holds exactly its
  processes. Never send a signal to PIDs worked out from `ps`, and never
  `pkill -f` or `pgrep -f` a pattern. On 2026-10-27 a descendant walk over
  `ps` started from PID 1, and its `kill -TERM` reached the systemd user
  manager, which ended the session and every agent, tmux pane and gate with
  it. A pattern matches other agents' processes and your own shell the same
  way.
- **A test that starts a real gate runner gives that run its own memory
  reading and its own unit.** Pass `NTS_MEMINFO` through `gateEnvironment`'s
  owned values, so the host's free memory never decides the result, and run
  it under `systemd-run --user --unit=<name>`, so a runner that outlives its
  test is stopped by name. On 2026-11-07 an inner run waited silently for
  host memory inside a gate run, and an orphaned runner spun a core in the
  tmux pane's own cgroup.

## Landing

Nothing reaches `main` except through the landing check
([`docs/workflow.md`](docs/workflow.md)). From your pool tree:

```sh
node tooling/landing/check.ts <commit> --dry-run   # the steps it runs, the deferred ones, the estimate
node tooling/landing/check.ts <commit> --here      # run them now, in your tree
node tooling/landing/check.ts <commit>             # queue it; run it in the background
```

One service, `nts-landing-check`, checks one change at a time against the
newest `main`, in ten minutes or less. A conflict refuses it, naming the
files. Green fast-forwards and pushes `main`, deletes your branch here and on
GitHub, and resets your pool tree. Red names the failing steps and the run's
logs. Memory pressure retries by itself; any other unfinished run holds the
change (`check.ts retry <id>`), as does a step stopped at its time bound. A
single case past its own bound (a compile past ten CPU minutes, a compiled
call past its allowance) is a recorded `timeout`, a loud defect. Withdraw with `check.ts withdraw <id|commit>`,
never by stopping a unit. `check.ts status` lists the queue. Documentation
and fixtures land the same way, in seconds. A new gate step needs a
`LANDING` row in `owed.mjs`, and a new tooling directory a rule, so that a
change owes only what it reaches.

**After landing, the full check** (`nts-full-check`) runs the core on every
new `main` and the wide steps on `verified` a few times a day. A red there is
measured again at the tip and at the last green commit, then bisected to its
first red commit, which is reverted ahead of other landings and becomes a
task. Record, benchmark and bisect against `verified`. Stop it only with
`systemctl --user stop nts-full-check`. A tool that keeps a folder in
`~/.cache` adds it to `tooling/full-check/keep.json`.

**Tests and benchmarks land without records** (user, 2026-11-05 and 11-06).
Every record check lists a case that has no row yet as pending and does not
fail it, and the full check writes those rows after landing
(`tooling/records/record-pending.ts`). A better outcome passes and is
rewritten; getting worse is red. A record that exists and disagrees still
fails, so an edit that changes a recorded fixture's cases deletes that
fixture's record in the same commit, which makes it pending.

**Never cap the gate's parallelism for a landing:** no `NTS_JOBS`,
`NTS_GATE_SLOTS` or `NTS_GATE_JOBS` in its environment. The gate sizes itself
(24 slots on this machine), and its own admission guards memory. Capped at
`NTS_JOBS=4`, the same steps took 72–100 minutes where 24 slots took 26–32
(2026-10-24 to 10-27).

**The gate's environment is its own, not your shell's.** Every step of the
landing check, `pinned.sh` and the full check runs in one canonical
environment (`tooling/gate/canonical-environment.ts`): host tools passed by
name, locale, time zone and node options fixed, and a temporary directory
inside the run. The landing check refuses any verdict-policy variable your
shell sets (the caps above, floors, step selectors, `NTS_BIN`), naming it;
unset it and run again. On `pinned.sh` such a variable is allowed, but it
makes the run a recorded experiment that can never serve as landing
evidence. Standing policy, such as the accepted on-device skip and the
platforms that may stay unrun, lives in `tooling/gate/verdict-policy.ts`, so a
launcher never has to remember it.

**A page in `docs/` is a specification, not a notebook** (user, 2026-10-27).
It states the current design and contract, with no dates, history or running
log, and changes when a decision changes it. `docs/plan.md` is the only page
updated as work goes. Numbers are not copied into pages: they live in
`results/`, written by tools. Observations, measurements, investigations and
long notes go to `docs/records/` (long notes in `docs/records/notebooks/`).
A decision is written into the page it governs, in its `## Decisions` section;
its dated entry goes in `docs/records/notebooks/decisions-log.md`.

Before a lowering change is submitted, also run the five test262 records the
full check holds it to (all.sh's `test262_cases`, `test262_builtins_cases`,
`test262_rest_cases`: `conformance262.ts --under <dir> --recorded <tsv>`
against a pin). They take minutes, and they caught seventeen regressions that
fixtures, examples and blockers did not.

Before you land, run the gate's own commands, not look-alikes:
`cargo fmt`; `cargo clippy --workspace --all-targets -- -D warnings`;
`cargo test --no-fail-fast` over every crate you touched *and the backend
crates* (`-p nts-codegen-{c,llvm,jvm}`), with `NTS_CHECKERS=1`
set to bound each test process's checker pool and memory; and `clang-format --style=file --dry-run -Werror` on any `runtime/c` file
you edited. A core change that passes core's tests has broken a backend's more
than once. Frontend tests always run: an in-process capture failure is a
failure, never a missing executable to skip. Without `--no-fail-fast` cargo stops at the first failing test binary and silently
skips the rest. After committing, read `git show --name-status HEAD`: a new
file left untracked is a commit nobody can build.

`node tooling/gate/inner.ts` runs all of these, then agree on the backends built today (C, LLVM and the JVM)
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
- A new `tests/programs/` or `benchmarks/cases/` fixture lands without its
  node oracle count: the checks list it as pending, and
  `NTS_BIN=<main's pin> node tooling/records/record-pending.ts` writes the
  count after landing, one fixture at a time. One whose generated cases
  change deletes its count in the same commit. A change to a function body
  with the same cases keeps its count, since every run still checks that all
  cases arrive.

## Compiler contracts

- A change to the semantic schema (a field added, removed or retyped in
  `compiler/semantic-schema/src/schema.rs`) bumps `SCHEMA_VERSION` in the same
  commit, to the next number even if another task bumped it today.
- A new C runtime helper owes a row in four tables in four crates, each checked
  by a test in *its* crate: follow the checklist at the top of the helper block in
  `runtime/c/nts_runtime.h`. A forgotten row reds a change that never calls the
  helper.
- A new `OpKind` reaches every `_ =>` match over ops; audit them before the
  first probe.
- Refusals live in two lists: lowering's `program.uncompiled` and each backend's
  own.
- `nts emit-c` and `nts check` print refusals on stderr and exit 0 while
  compiling what they can. Read stderr.
- `nts hir` shows raw lowering; `nts hir --prepared --backend <b>` is what a
  backend sees.
- The native producer captures every request; it has no persistent snapshot
  cache. Any reuse must validate all recorded host observations through the
  adapter, including failed lookups and directory reads: the deleted cache
  silently kept a missing sibling module missing after the file appeared.

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
  Keep only the profiles your workflow builds (tests run in `nts-dev`), and
  delete one you no longer build whole: on 2026-10-29 a forgotten 77 GB
  `target/debug` held every landing on the disk floor.
- A native snapshot of a large program can take gigabytes: cap parallel frontends,
  and check `journalctl -k` for OOM kills before blaming a crash.
- **Gates run back to back, so heavy work runs beside them:** `nice -n 19`, one
  heavy job of yours at a time, a heavy phase started only when `MemAvailable`
  (`/proc/meminfo`) is at least 14 GB. Below 12 GB, stop starting new cases
  (the conformance feeder and gate-pool tokens); let running cases finish, and
  resume admission at 14 GB. The gate's token pool and the conformance
  runner's feeder hold it themselves (`tooling/gate/admission.ts`); work of
  your own outside them holds its next case or phase by hand. Never SIGSTOP timed work:
  its wall-clock timeout keeps running, so suspension fabricates a timeout.
  A gate step's memory pre-check is what a neighbour breaks, and a red step
  costs its change a rerun of its check.
- **CPUs 4–5 (hyperthread siblings of one physical P-core) are reserved for
  measurement.** Every process an agent starts excludes both, monitors and
  samplers as much as gates and heavy jobs: `taskset -c 0-3,6-31` inside the
  command (or a narrower set, such as E-cores `16-31`). The system and user
  systemd managers default to the same set (`CPUAffinity=0-3 6-31` in
  `/etc/systemd/{system,user}.conf.d/30-nts-measure-cpus.conf`; `daemon-reload`
  applies a change, `daemon-reexec` does not), so a unit inherits it. That
  does not cover a process started before the managers took it, or one that
  widens its own mask, and one light monitor on CPU 5 is enough to make
  `with-lock.sh` time out. `pinned.sh` applies the exclusion without
  widening its inherited affinity, and the landing and full checks run in
  units that inherit the managers' default. A user scope
  with `AllowedCPUs` enforces a kernel ceiling when cpuset is delegated and a
  widening probe proves it. Otherwise the log says `best-effort`: a library
  such as Mesa can widen a taskset mask. Never change an in-flight gate's mask.
- **Runs that crash programs on purpose disable core dumps:** `ulimit -c 0`, or
  `LimitCORE=0` for a unit. On 2026-10-27 the gate's deliberate crashes made
  2,669 dumps in an hour (4 GB). systemd-coredump, which no mask excludes, ran
  at 40% on CPU 5, so measurement could not start.
- Benchmark on CPU 4 with sibling 5 idle, under
  `tooling/gate/with-lock.sh --wait`, from a worktree pinned to a commit.
  The wrapper waits only for CPUs 4–5 to be quiet and sets `NTS_BENCH_CPUS=4`;
  a command other than `nts-bench` needs its own `taskset -c 4`.
  Compare ratios within one run, never absolute times across runs.
  `nts-bench` links the compiler crates directly: run a plain
  `cargo build --release` (no `-p`) before measuring a compiler change.
- A gate or bench run drives `target/release/nts` unless told otherwise: pass
  `NTS_BIN` for any other build (on `pinned.sh` that marks the run an
  experiment, above).
- Never edit a gate script (`all.sh` and its helpers) while a run of it is
  executing from that tree: the shell reads a running script incrementally.
- System packages come from `paru`.
