# `tooling/conformance`

Forty scripts and 43 fixtures, and a new session needs about six of the
scripts. This says which
six, and what the rest are for when you reach them.

## The loop

    check.sh <module> --ts            the TypeScript on node, no compiler needed
    check.sh <module>                 the compiled addon, needs target/release/nts
    run.mjs --module <m> --sabotage   blank the module; every test must fail

`--sabotage` is not optional politeness. A test that passes against a blanked
module is measuring the harness, and this directory has produced several.

## The instruments, and what each exists because of

Every one of these was written after something was reported wrongly. The reason
is in the file's own header; the summary is here so you know what to reach for.

| script | question it answers |
| --- | --- |
| `blockers-check.mjs` | do the filed compiler blockers still reproduce? |
| `build-floor.sh` | did a module that used to compile stop, or start? |
| `cascade-reach.mjs` | which single refusal, if fixed, unblocks the most? |
| `c-tests.sh` | does the hand-written C behave, without its module compiling? |
| `self-oracle.mjs` | is a test comparing the module under test with itself? |
| `shape-blindspot.mjs` | does a `shape.mjs` supply a value it should pass through? |
| `standin-blindspot.mjs` | which bindings can no lane disagree with node about? |
| `binding-abi-audit.mjs` | does every `declare function` match its C prototype? |
| `counted-lane.sh` | does reference counting change any answer? |
| `pinned-tree.sh` | a worktree pinned at one commit, for a measurement that must not move |
| `sweep.mjs` | all of the above, plus the per-module compiled result |

## Four things this directory has learned the hard way

**A check with no demonstrated failure is a claim.** Every instrument here
should be run once against a deliberately broken input before its result is
believed. `counted-lane.sh` carried a guard for nine months that *could not
fire*: `$(grep -c ... || echo 0)` yields `"0\n0"`, the `-eq` test errors, and
the `if` falls through — in exactly the case the guard existed for.

**A result must distinguish absence-of-problem from absence-of-measurement.**
Five instruments here have failed that way, each by a different mechanism: a
dead guard, a name mismatch (`join` against `join@posix`), a guard that called
the one clean module an instrument failure, a stale output file read as a pass,
and `typecheck: 0 of 22` that was a missing `tsc` in a worktree. That last is
the worst kind — a suspicious zero invites a second look, a plausible
catastrophe invites a search for the cause.

So: **an instrument that reports a count must also report the size of what it
examined.** The two zeros are otherwise the same sentence.

**`node:x` and `x` are the same object in a test.** The harness substitutes the
module under test for both spellings, so a test that requires both is comparing
one thing with itself. One did, and passed for it. Use a child `node -p` when
you need node's own answer; `self-oracle.mjs` checks for the rest.

**A pinned worktree costs 0.07 seconds.** Not a `node_modules` install — 256K of
`.tsbuild` directories. Three sessions commit into this checkout continuously,
and a sweep that reads source as it goes will read two different trees and say
nothing about it.

## Filing a compiler blocker

`blockers/<name>/src/main.ts`, with the expectation in an `// expect:` comment
on the first line. `blockers-check.mjs` re-measures them all against whatever
compiler is current and reports `FIXED` loudly rather than as a pass.

Name the **shape**, not the message. "Nullable properties, 305 sites" was the
loudest recommendation of one day and a plain nullable property compiles: that
was a description of a *grouped diagnostic*, and one fixture would have caught
it immediately.

If the expectation is about emitted C rather than about a refusal, say
`emit-c --napi -> emits-c <text>`; `hir` and `emit-c` do not agree about what
refuses, and at least one blocker reports an NTS1003 from a run `hir` calls
clean.
