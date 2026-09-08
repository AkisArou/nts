# Handoff — `runtime/node`

For a session working **only** on `runtime/node`. Written by the session that
owns the compiler, so that three sessions can share one machine and one
repository without stepping on each other.

## What you own

- `runtime/node/**` — the modules themselves.
- `tooling/conformance/**` — the harness that runs node's own tests against
  them. It is _not_ a gate step, so it is yours to change.

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
saturating) and benchmarks (~25 minutes, needing a _quiet_ machine — a noisy
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
_quiet_, not merely a lane: cores share last-level cache, memory bandwidth and
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

## The instruments here, and how each of them has lied

Every tool in `tooling/conformance/` has been wrong at least once, and in each
case the output looked exactly like a correct run. These are the specific ways.

**A baseline list nobody updates manufactures progress.** `build-floor.sh` held
nine modules while twenty built, so a run printed `11 newly building` — against a
binary carrying an in-progress compiler change, where it read exactly like that
change's doing. A stale floor does not merely miss a regression. Re-derive the
list, or check the date on it.

**A verdict word can be the reassuring one for the alarming case.**
`blockers-check.mjs` printed `FIXED` when a *guard* stopped holding — the outcome
that needs a person fastest, labelled with the word that stops them looking. It
prints `REGRESSED` now. When you add a check, ask which of its outcomes is the
one you would least like to be quiet.

**A fixture that reproduces can still be about the wrong thing.** `emits-c` is a
substring match, and a substring taken from broken output can appear in correct
output; five fixtures were in that state at once. Worse, a fixture can reproduce
the *text* without ever having had the *condition* — the stopping rule "the
smallest program that produces the error I saw" is wrong, because **the smallest
program producing the text is not the smallest program having the defect**.

**So every fixture carries a control that must stay clean**, written into the
file, with prose saying what it means if it ever starts failing. One control
tells you the defect is present; a second tells you what the defect *is*. Three
fixtures were named for the wrong construct until their controls were added —
one was "narrowed into an object literal" and is really about one *spelling* of
them. A fourth kind exists, found by the compiler lane: a control that
*suppresses* the defect it controls for, which makes the fixture green rather
than merely uninformative.

**Guard forms need controls too.** `compiles`, `once-c` and `lowers` were each
pointed at something false to confirm they said so.

**Write down which checks have never fired.** The `NOT ITS OWN` check shipped
with a comment saying it was uncontrolled and guarded a state that did not yet
exist. It fired for the first time months later and was **wrong**. The note is
the only reason that was a minute's diagnosis.

**Say which lane a number is from, and what it is a count of.** A refusal count
over a module's whole tsconfig cone is not a count of what blocks that module —
most of it is shared code. `AnyView` was 2–7% of every module's cone and three of
four of `string_decoder`'s *own* refusals; both true, not interchangeable, and
the cone-wide table got quoted against the question it was not built for.

**A fix's refusal delta is not a measure of the fix.** `buffer` went 79 to 79
across a real improvement: five refusals cleared and five appeared behind them.
A cone sizes a queue rather than a step. Show what replaced them.

**Do not extrapolate a diagnostic population from a sample.** Asked what share of
a 141-site message came from one cause, four sites were sampled and two matched —
which points at seventy. The measured answer was **nine**. Report `N certain,
plus an unmeasured share of M`, and leave the second number unsummed.

## Git

Name the paths on the commit itself. No staging, no private index, no reset:

```
git commit -m "..." -- <paths>
```

or `tooling/gate/commit-mine.sh -F <message-file> -- <paths>`, which does the
same and refuses a workspace that does not lint.

**This paragraph used to say the opposite** — commit through a private
`GIT_INDEX_FILE` and `git reset` after — and that recipe removed **1,121 files
in one commit**. A private index built from a partial tree does not record the
files it was never told about, so the commit reads as a mass deletion of
everything outside it. The reset afterwards does not undo a commit.

Three sessions share one `.git/index`, which is the real problem the private
index was reaching for, and a partial commit solves it without the hazard:
`git commit -- <paths>` never consults staged state, so nothing another session
has in flight can be swept in.

One thing naming paths does _not_ protect against, learned the same day: a named
file can still be dirty with somebody else's work in it. Run `git diff <path>`
first and confirm the hunks are yours.
