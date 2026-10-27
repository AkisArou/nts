# Test262

How nts is held to test262, the conformance suite of ECMA-262: the pin, what
runs, the variants, the verdicts, how a case is counted, the records the gate
holds, and how to run each part. For anyone reading a test262 number,
changing the census tools, or landing a change the gate checks against the
records. What nts declines on principle is
[boundaries](../language/boundaries.md); the census's history and
measurements are in [the census notebook](../records/notebooks/test262-census.md).

## The pin

The suite is `third_party/test262`, checked out at the commit that
`TEST262_PIN` names in `tooling/suite/src/test262_runner/mod.rs`;
`tooling/bootstrap/bootstrap.sh` clones it there. Every command refuses a
checkout at another commit or with local changes. Moving the pin means
changing that constant, then deriving the inventory's counts and every record
again from runs at the new pin.

## Scope at the pin

`nts-test262-protocol inventory` reads every `.js` file under `test/` and
sorts it:

- a `_FIXTURE.js` file is a module dependency, never a standalone test;
- every standalone file's metadata is parsed, whatever nts supports. Malformed
  metadata or a missing include is an infrastructure error, never a skip, and
  an unknown flag makes the file unsupported, with the flag named;
- **ECMA-402** is `test/intl402/`. It is in scope, as Intl is, and it is
  counted apart from ECMA-262: the two never share a denominator, and no
  record of ECMA-402 is held yet. A case elsewhere that declares an ECMA-402
  feature token (`Intl.Era-monthcode`) is excluded from the ECMA-262 headline
  through `features.json`, because its expectations are ECMA-402's;
- **ECMA-262** is everything else: `test/language`, `test/built-ins`,
  `test/annexB`, `test/staging` and `test/harness`.

Within ECMA-262, each file is scheduled by its flags:

| flags | action |
|---|---|
| none, or `onlyStrict` | run once, as a strict script |
| `module` | run once, as module code |
| `async`, with either of the above | run, completing through `$DONE` |
| `noStrict` | scope-excluded: counted, and not attempted |
| `raw` | scope-excluded: counted, and not attempted |

The scheduled files are the **strict lane**. The counts at the pin are
asserted by the ignored test `pinned_corpus_matches_the_documented_strict_inventory`
(`tooling/suite/src/test262_runner/discover.rs`) and printed by the inventory
command. They are read off a run there, never recomputed by hand.

## Variants

test262 runs a default test twice: as written, and with `"use strict";`
prepended. nts runs one variant of each scheduled file:

- a script gets exactly `"use strict";\n` before the test source, and its
  variant is `<path>#strict`;
- a module test runs once as module code, `<path>#module`, with the
  `./*_FIXTURE.js` modules it imports placed beside it. One with no `import`
  or `export` is marked `export {};`, so the early errors of module code
  apply.

A pass is therefore `strict-pass`: one strict variant. A passing strict
variant is never promoted to a full-file pass when the file's metadata also
requires a sloppy variant.

## What runs

Each case is compiled as test262 lays it out, as global scripts in one
program, except that a module test's own file is module code:

| file | what it holds |
|---|---|
| `src/harness.ts` | the stand-in for the default harness, `assert.js` and `sta.js` (`tooling/census/harness.ts`), with `assert.throws`, `assert.compareArray`, `$DONE` and `$DONOTEVALUATE` added only for a test that uses them |
| `src/include-<name>.js` | each file the test's `includes:` names, verbatim |
| `src/main.js` | the test, as JavaScript, behind its strict prefix |

"Test262 permits implementations to replace harness functions with equivalent
functionality." Only the default entries are replaced: every other include is
compiled as test262 wrote it, and one that does not compile refuses like any
other source. The harness, the includes and the test "remain separate source
units evaluated in one realm". They are never concatenated into a function or
a CommonJS wrapper, and none imports another.

The program is built by the backend's own command with `--main` (`emit-c`,
`emit-llvm`, or `emit-jvm`), linked where the backend
links, and run. A run ends with exit status 0, or with
`nts: uncaught <Class>: <message>`.

A test that uses `$262` is not attempted: the host hooks it reaches (realms,
agents, detached buffers, garbage collection, `IsHTMLDDA`) are not provided.
The protocol layer also ships typed declarations of that host
(`tooling/suite/assets/test262/`), for a runner that maps them to intrinsics.
That mapping is not built, so the census uses the stand-in.

A run checks itself before it counts anything: a control program that must
pass, a sabotage that must not, a refusal that must be read as one, and an
async case. Each case runs under a memory cap. A run will not start without
the memory its workers need, it prints the machine's state at both ends, and
it marks itself `DEGRADED` when it ran under swap traffic or low memory.

## The oracle

test262 is the oracle: the test body, the harness and the metadata. Node may
be run beside it to diagnose the runner, but it never decides a verdict.

- Two implementations rejecting a case at different phases is not a pass.
- A generic compiler refusal cannot satisfy an expected JavaScript exception.
- An expected `SyntaxError` cannot be satisfied by a runtime `TypeError`.
- A missing host capability cannot pass because another host lacks it too.

No compiler refusal is promoted to a test262 verdict.

## Outcomes

Every selected case gets exactly one of five outcomes, and they must sum to
the population, or the run fails:

| outcome | meaning |
|---|---|
| `pass` | ran and completed: `strict-pass` |
| `fail` | ran and was wrong: an uncaught throw, or a negative test accepted |
| `refused` | the compiler declined: a checker error or an `NTS` refusal |
| `unsupported` | the harness cannot run it: scope-excluded, a `$262` test, or a gap in the stand-in |
| `no-verdict` | crashed, timed out, hit the memory cap, produced invalid HIR, or did not emit or link |

A negative test is judged by how the compiler said no, never by whether it did:

- A **parse** or **resolution** negative passes when the checker rejects it
  with at least one evidence code: a TypeScript diagnostic code that no
  attempted positive case, which is valid JavaScript, ever draws. The codes
  are kept in `tooling/census/test262-evidence-codes.json`, derived only from
  a whole run of `test/language` on C; `test262-evidence-overrides.json` adds
  codes that a named gap in the checker needs, each audited against the
  checker's pin. Rejected only by codes valid JavaScript draws, the case is
  `refused`. Accepted, it is `fail`, and it counts as an **accepted negative**.
- A **runtime** negative passes only if it throws exactly the declared
  constructor.

Off C, parse and resolution negatives are not run: the frontend decides them
before any backend does.

A refused case is ranked by its root causes three ways: by its **first** root,
where a reduction starts; by its **sole** root, the most that fixing one cause
could clear; and by **any** root, its reach. The cascade diagnostics NTS1003
and NTS1005 are consequences, never roots. A checker root is sole over
nothing, since lowering never ran behind it.

## How a case is counted

**Exclusions are a column, never a filter.** An excluded case is still
compiled and run; it leaves only the in-scope denominator. The headline is the
in-scope passes over the in-scope cases, printed beside the raw rate over every
case. Exclusions come from two ledgers, and each entry carries a reason and an
authority, a section of [boundaries](../language/boundaries.md) or of this
page:

- `tooling/census/features.json` classes every test262 feature token the
  census has met: `inapplicable` (a boundary, excluded), `gap` (the backlog),
  `supported` (expected to lower) or `host` (needs a host capability). Only
  `inapplicable` excludes. An uncertain token is a `gap`, since a gap stays
  visible.
- `tooling/census/test262-exclusions.json` holds anything that is not a
  feature token, matched by path or by a harness include.

The rule every entry follows: a documented non-goal leaves the in-scope
denominator, and an undocumented gap stays in it. The size of a population is
never a reason.

An exclusion with a passing case is reported, `FIXED? N passing`: a boundary
that starts passing is news. An entry with no reason or authority, or naming a
path or include the suite does not have, fails the run.
`tooling/census/audit.ts` checks `features.json` itself: every class is one of
the four, every authority names a page and section that exist, every token is
in the pin's `features.txt`, and every token the selection uses has a row (the
gate selects `test/language`).

A sample, or a run over a record's cases, prints a pass count and no rate,
because its denominator is not the suite.

test262 is **done** when every file of the ECMA-262 strict lane, in every
directory, ends as a pass or under a named boundary: no `fail`, no
`no-verdict`, no unclassified refusal. Scope-excluded files stay counted and
not attempted.

## Records

A record is `results/test262/<backend>/<slice>.tsv`, one per backend (`c`,
`llvm`, `jvm`) and slice (`language`, `builtins`, `annexb`, `staging`,
`harness`). It holds every case that ran, one line each: the path, `pass` or
`fail`, and for a fail its uncaught line. Refused and unsupported cases are
not recorded: they move with every compiler change, and the rankings are
where they are read. The header names the compiler's fingerprint, the commit
(only for a clean pin), the backend, the harness and the machine.

- `--record` writes a record, and only from a pin of a commit
  (`tooling/conformance/pin.ts`).
- `--recorded` re-runs exactly the cases a record names, on the backend that
  wrote it, and compares. A recorded pass that does anything else is
  `REGRESSED`, a fail with a different line `CHANGED`, a case that did not
  run `MISSING`, and an unrecorded failure `NEW FAIL`; any of these fails the
  run. `FIXED` and `NEW PASS` print a note to re-record. The run also prints
  how many commits to `compiler/` or `runtime/` the record is behind.
- A record cannot see a new pass, since its population is what already ran.
  Only a full run, re-recorded from a pin, adds one.
- Another backend's record covers C's cases: it is written with `--paths-from`
  naming C's record, and its own previous record as well, so that cases it
  passes and C refuses are kept.

## What the gate holds

All of these are core steps, which every landing runs.

| step | what it holds |
|---|---|
| `test262` | the pin is reachable, every standalone file's metadata parses, and `features.json` passes `audit.ts` over `test/language` |
| `test262-cases` | C, `test/language`: its record, a floor on its pass count and a ceiling on its accepted negatives |
| `test262-builtins-cases` | C, `test/built-ins`: the same, with its own floor and ceiling |
| `test262-rest-cases` | C, `test/annexB`, `test/staging` and `test/harness`: each with its own record, floor and ceiling |
| `test262-llvm`, `test262-jvm` | that backend's five records, each held to itself; the record is the ratchet, so there is no floor |

The floors and ceilings are variables in `tooling/gate/all.sh`. A pass count
above its floor, or accepted negatives below their ceiling, prints a note to
move it. A lowering change runs the five C records against a pin before it
goes to the gate.

## Running it

`NTS_BIN` names the compiler; for evidence, a pin of a commit.

```sh
# The metadata layer: the inventory at the pin, and one test's plan
cargo run -p nts-suite --no-default-features --bin nts-test262-protocol -- \
  inventory third_party/test262
cargo run -p nts-suite --no-default-features --bin nts-test262-protocol -- \
  plan third_party/test262 test/language/expressions/tagged-template/template-object.js

# One record, as the gate holds it
node tooling/census/conformance262.ts --under test/language \
  --recorded results/test262/c/language.tsv
node tooling/census/conformance262.ts --backend jvm --under test/built-ins \
  --recorded results/test262/jvm/builtins.tsv

# A full run of one directory, keeping each case's row; --resume continues it
node tooling/census/conformance262.ts --under test/built-ins \
  --rows <rows.jsonl> --json <report.json>

# Re-record, from a pin of a commit
NTS_BIN=$(node tooling/conformance/pin.ts <rev> | tail -1) \
  node tooling/census/conformance262.ts --under test/language \
  --record results/test262/c/language.tsv

# One case as the census compiles it; prints the emit-c line to run on it
node tooling/census/materialise262.ts test/language/<case>.js <dir>

# What a run's rows say, and which cases moved between two runs
node tooling/census/rows.ts <rows.jsonl> --by message
node tooling/census/rows.ts --diff <before.jsonl> <after.jsonl>
```

A failing case is reported from its materialised program, never from a
TypeScript reconstruction of it: the materialised JavaScript is what the
census compiled.

The metadata layer is a Rust implementation of test262's YAML dialect, with
test262's own Python parser as its test oracle only. Three ignored tests audit
it over the whole pin:

```sh
cargo test -p nts-suite --no-default-features --lib \
  pinned_corpus_matches_the_documented_strict_inventory -- --ignored
cargo test -p nts-suite --no-default-features --lib \
  every_strict_lane_include_resolves_at_the_pin -- --ignored
cargo test -p nts-suite --no-default-features --lib \
  rust_metadata_matches_test262s_parser_for_the_whole_pin -- --ignored
```

`nts-suite test262` is not a test262 result. It harvests closed numeric
expressions from the suite and compares their values with node
([`results/suite/test262-expressions.md`](../../results/suite/test262-expressions.md)),
which tests arithmetic and constant folding, and it runs no harness, metadata
or variant.

## Decisions

- test262 is done when every ECMA-262 strict-lane file passes or sits under a
  named permanent boundary; sloppy-mode and raw tests stay scope-excluded,
  counted and not attempted
  ([log](../records/notebooks/decisions-log.md#test262-09-29-10-02)).
- Module tests are in the lane, each run once as module code
  ([log](../records/notebooks/decisions-log.md#test262-09-29-10-02)).
- test262 runs on every built backend, the JVM included; Wasm rejoins when
  its Binaryen backend exists.
- The records keep gating, and no new test262 family starts until the
  foundations are solid
  ([log](../records/notebooks/decisions-log.md#priorities-and-order)).
- The permanent boundaries are those [boundaries](../language/boundaries.md)
  states.
