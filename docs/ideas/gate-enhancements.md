# Gate enhancements: concurrent gates, and a gate on a second machine

Status: proposal, 2026-10-12. Nothing here is implemented.

Today one machine runs one full gate at a time. Lanes coordinate by hand: a
lane writes `~/.cache/nts-parallel-20261004/mainctl/GATE-RUNNING` (owner, sha,
time) before `tooling/gate/pinned.sh`, removes it after, and the next lane waits.
With two Codex lanes gating several times a day, waiting for the marker has
become a visible cost. This note records why the rule exists, what would have
to change to lift it, and a second idea: running a gate on another machine (the
laptop) over SSH.

## Why two gates cannot run side by side today

### 1. They share one checkout and one target directory

`pinned.sh` checks the commit out into `NTS_GATE_TREE` and builds into
`NTS_GATE_TARGET` (defaults `~/.cache/nts-gate/tree` and
`~/.cache/nts-gate/target`, see `tooling/gate/pinned.sh:39-40`). Both lanes
point these at the same `mainctl/gate-tree` and `mainctl/gate-target`. A second
gate would check out its commit over the first one's tree mid-run.

This is the easiest part to fix.

### 2. Steps write to fixed paths

Several steps have written to paths that do not depend on the run. Each
collision showed up as a red step on a correct tree. These are the four
recorded so far (all fixed):

- `tests`: `runtime_jar.rs` rebuilt into `$TMPDIR/nts-runtime-rebuilt.jar`, and
  `runtime/jvm/build.sh` compiled into `runtime/jvm/classes`.
- `tests` again: `jvm_sabotage.rs` wrote sabotaged Java into `runtime/jvm/src`
  while another test built the jar from those sources.
- `interop`: gtk-journal's program and `build.sh` hard-coded
  `/tmp/nts-gtk-journal.txt`, and another run deleted it.
- `interop` native-rusage: `nts bind-c` wrote probes to fixed names under
  `$TMPDIR/nts-bind/`. Run concurrently, 30 of 60 rounds failed; a per-process
  scratch directory (fd35c3b55) brought that to 0 of 60.

Interop already serialises itself with `$HOME/.cache/nts-gate-interop.lock`.
Nothing has audited every step for fixed paths, so more are likely. A false red
is the costliest failure a gate can have: it costs a rerun and trains people to
distrust red.

### 3. Each gate sizes itself to the whole machine

`run.mjs` gives a run `NTS_GATE_SLOTS` CPU tokens, by default `NTS_JOBS` or
three quarters of the cores (`run.mjs:241`). Steps also carry a memory budget
that assumes nothing else is running. The token pool (`tokenpool.mjs`,
`token.sh`, `tokens.mjs`) is a TCP server owned by one `run.mjs`, so two
concurrent gates are two pools, each believing it owns the machine:

- **CPU:** each run takes about twice as long. Because the work is CPU-bound,
  two gates side by side finish at about the same time as two in a row.
- **Memory:** budgets are oversubscribed. This machine hit a global OOM on
  2026-10-11 (one `tsgo` held about 11 GiB).
- **Timing:** checks that compare against recorded baselines get noisier
  (`compile-times.tsv`, `times.tsv`).

## What would lift the rule

In order of value for effort:

1. **One gate tree and target per lane, or per run.** Derive `NTS_GATE_TREE`
   and `NTS_GATE_TARGET` from the lane name or run id rather than sharing one
   pair. This costs disk (a release target dir per lane) and removes the
   checkout collision outright.

2. **One machine-wide token pool.** Make the pool a machine-level service, or
   let `run.mjs` join an existing pool on its well-known port instead of always
   starting its own. Concurrent gates then *share* the CPU budget and the
   memory budgets stay true. The token design already suits this: a token is a
   connection, so the kernel releases it however its holder dies.

3. **A fixed-path audit, kept honest by a concurrency test.** List every path
   each step writes, including source files a test edits in place. Move every
   scratch file under a per-run directory. Then add a test that runs two
   gates, or two copies of the suspect steps, at once and compares them with
   solo runs. The bind-c case shows a concurrent loop reproduces in seconds
   what the gate shows once a day.

4. **Make the one-gate rule a tool, not a convention.** Until 1–3 land,
   `pinned.sh` could take a machine-wide gate lock itself (the queueing mode of
   `with-lock.sh --wait` already exists) and record owner, sha and start time.
   It would then release on exit and detect a stale lock by pid. That replaces
   the hand-written marker and the handshake between lanes, and it cannot be
   forgotten.

**Expected payoff, honestly:** items 1–3 make concurrent gates *correct*, not
faster in aggregate, because the machine's cores are the limit. The real wins
are an end to coordination, and that a small `NTS_GATE_STEPS` subset could run
beside a full gate without waiting. Item 4 is worth doing on its own.

## To explore: a gate on a second machine over SSH (the laptop)

A second machine is the only way to get *more* gate throughput, because it
brings its own CPU and memory. The Windows lane already drives a remote host
over `ssh nts-win`, so there is precedent. A sketch:

- `tooling/gate/remote.sh <host> <sha>` runs `ssh` to the host, fetches the
  commit into a gate tree there, runs `pinned.sh` with the same
  `NTS_GATE_STEPS`, then copies `summary.json` and the step logs back next to
  local runs, tagged with the host.
- **Each host has its own lock.** The local and remote gates never contend.

Questions to answer before relying on it:

- **Identical toolchain.** The remote needs:
  - the Rust toolchain pinned by `rust-toolchain.toml`;
  - clang (and zig where used), a JDK, Android `d8`, and node 24.20;
  - `tsgo` built from `third_party/typescript-go`;
  - the test262 checkout under `third_party/test262`;
  - cache-held inputs. `~/.cache/nts/apple`, for instance, holds the macOS
    `libuv.a` interop needs.

  A step whose input is missing must report NOT RUN, never a quiet pass. Treat
  `remote.sh`'s first run as an audit of those inputs.
- **Per-machine baselines.** The `compile-time` ratchet and instrument times
  (`compile-times.tsv`, `times.tsv`) are measured on this machine. A laptop
  needs its own baselines, or skips those steps and reports them as skipped.
- **Benchmarks stay local.** Timings are only comparable on one machine, so
  `nts-bench` and paired before/after rows never run remotely.
- **Device steps.** `on-device` needs the Android device attached here; the
  remote reports it SKIPPED, as this machine does when no device is attached.
- **Reliability.** A laptop sleeps, throttles under heat and changes networks.
  A run killed by sleep must read as NOT RUN, not as green. Record the
  remote's kernel, CPU and toolchain versions in the summary, so a result
  states where it came from.
- **What it buys.** With the laptop as a second gate runner, two lanes can
  gate at once with real parallelism. Its gate is probably slower than this
  machine's; measure one full run before planning around it.
