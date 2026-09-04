# Handoff — `runtime/node`

For a session working **only** on `runtime/node`. Written by the session that
owns the compiler, so that three sessions can share one machine and one
repository without stepping on each other.

## What you own

- `runtime/node/**` — the modules themselves.
- `tooling/conformance/**` — the harness that runs node's own tests against
  them. It is *not* a gate step, so it is yours to change.

## What you must not touch

- Anything Rust: `compiler/**`, `runtime/c/**`, and everything under `tooling/`
  **except** `conformance/`.
- `examples/**`, `benches/**`, `docs/conformance/typescript.md`,
  `docs/records/**` — the compiler session's.
- Never run `cargo build`, `cargo test` or `cargo clippy`, and **never** `cargo
  fmt`: nothing gates Rust formatting here and one run rewrote twenty-seven
  files.

## The loop

Cheap, and needs no compiler at all:

    tooling/conformance/check.sh <module> --ts --only test-foo.js
    tooling/conformance/check.sh <module> --ts

`--ts` runs the TypeScript on node directly. One short node process; no `nts`
binary, no Rust, no build.

The compiled path:

    tooling/conformance/check.sh <module> [--only test-foo.js]

goes through `build.sh`, which calls `nts emit-c --napi` and therefore needs
`target/release/nts`. **Do not build it.** The compiler session keeps it
current; if it is missing or stale, ask rather than running cargo.

## The one coupling that can turn the compiler session's gate red

The gate's `profile` step emits all of `runtime/node` with `--napi` and fails if
the **emitter panics** on any module — a panic is a compiler bug by definition,
whoever wrote the input. It also checks each module's HIR verifies, on a list
ratcheted downward that is currently empty.

So a change here can break the gate without touching a line of Rust. Before
handing a module back:

    NTS_TSGO=$PWD/target/tsgo ./target/release/nts emit-c \
      runtime/node/<module>/tsconfig.json --out /tmp/check --napi
    NTS_TSGO=$PWD/target/tsgo ./target/release/nts hir \
      runtime/node/<module>/tsconfig.json | grep -c "does NOT verify"

Neither may panic, and the second must be `0`. **Refusals are fine** and
expected — they are counted elsewhere and are not a failure.

## Machine etiquette

Thirty-two cores, shared. The compiler session runs the full gate (~15 minutes,
saturating) and benchmarks (~25 minutes, needing a *quiet* machine — a noisy
neighbour makes the numbers wrong, not merely slow).

The marker is a directory, held for both:

    /tmp/nts-gate/gate.lock.d

- `--ts --only <one file>` is one short process. Always fine, never check.
- A whole-module sweep, or anything on the compiled path: check first with
  `[ -d /tmp/nts-gate/gate.lock.d ]`.
- **The lock goes stale.** Nothing releases it if the holder dies. If it exists,
  confirm with `pgrep -af "gate/all.sh|nts-bench"`; with no process it is stale
  and you may `rmdir` it.
- Never write a waiter as `until ! pgrep -f "gate/all.sh"` — the pattern matches
  the waiter's own command line and the loop never ends. Wait on output instead.

For a hard guarantee rather than etiquette, pin long work. The lanes, with
three sessions on thirty-two cores:

    0–7      compiler session (gate, builds)
    8–15     JVM backend session
    16–23    spare, for whoever needs a burst
    24–31    this session
        taskset -c 24-31 <command>

**Pinning does not make a benchmark run safe.** A benchmark needs the machine
*quiet*, not merely a lane: cores share last-level cache, memory bandwidth and
turbo headroom, so a neighbour saturating 8–31 changes the numbers on 0–7. The
lock is the mechanism for that, and it is the one to respect. Pinning is a
courtesy on top of it for builds and test sweeps.

## Reporting back

- `docs/conformance/typescript.md` records "22 modules emit and verify; 1,097
  distinct refusal sites". Your work moves both numbers. Do not edit that file —
  report the new ones.
- When a compiler refusal blocks a module, report the **exact diagnostic**.
  Those refusals are the queue the language work is ordered by, and one from
  real code outranks one from a generated corpus.
- `arrays_can_grow` is whole-program: one `push` anywhere puts every array in a
  growable wrapper. Measured by source proxy, **20 of the 23 directories** here
  trip it against **2 of 93** examples. If you remove the last growing call from
  a module, say so — it changes that module's representation entirely.

## Git

Commit through a private `GIT_INDEX_FILE` and run a plain `git reset` after.
Three sessions share one `.git/index`; `git add` fights over it, and moving HEAD
without the reset leaves the others seeing phantom deletions.
