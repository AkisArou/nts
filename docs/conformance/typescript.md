# TypeScript

How nts is held to TypeScript. Two instruments answer different questions. The
**conformance suite**, `tests/typescript/`, asks whether a compiled program
behaves as TypeScript and node say it should. **TypeScript's own tests** ask
whether the compiler survives code nobody wrote for it. What nts compiles,
feature by feature, is the [feature table](../language/README.md); what it
declines on principle is [boundaries](../language/boundaries.md). For anyone
adding a case, reading a record, or changing what the gate's
`typescript-cases` and `corpus` steps hold.

## The conformance suite

### What a case is

A case is one strict TypeScript file, `tests/typescript/<family>/<case>.ts`,
that checks itself through test262's harness (`assert.sameValue`,
`assert.throws` and the rest), under test262's front matter:

```ts
/*---
description: A numeric enum maps each value back to its member's name.
features: [ts-enum, ts-enum-reverse-mapping]
---*/
enum Color { Red, Green, Blue }
assert.sameValue(Color[Color.Green], "Green");
assert.sameValue(Color[2], "Blue");
```

- `features:` names the concepts the case exercises, as `ts-<concept>` tags.
  [`tests/typescript/FEATURES.md`](../../tests/typescript/FEATURES.md) is the
  vocabulary: one row per tag, what it means and where it comes from, and the
  families.
- The only flags are `module`, for a case that is module code, and `async`,
  for one that completes through `$DONE`.
- There are no negatives, since a program that must not compile is a
  `tests/refusals/` fixture, and no includes.

The concepts come from three sources: the directories of TypeScript's own
conformance tests (`tests/cases/conformance/`, read for concepts only);
typescript-eslint's TypeScript-only syntax nodes; and the typed paths, where a
static type steers how a value is represented. A concept with no effect while
the program runs has no case of its own, and appears where a value flows
through it. Each family has `combination-*` cases that pair its concept with
others.

A new case reuses a tag before adding one, and a new tag gets its row in
`FEATURES.md` in the commit of its first case.

### The oracle

Node decides whether a case is right. Before nts compiles a case, node runs it
as one module, so strict, with `--experimental-transform-types`, which strips
the types and transforms enums, namespaces and parameter properties as
TypeScript's emit does. A case node fails is a wrong case: it is reported as
`no-verdict`, with node's error, and counts neither for nor against nts. An
async case passes the oracle by its completion line, not by its exit status.

Cases node cannot judge wait in `tests/typescript-pending/`, which the runner
does not select: decorators, legacy decorators, `accessor` fields, cases where
node's transform and TypeScript's emit answer differently, cases that need a
second module or CommonJS, and JSX. Each of its families has a README saying
which TypeScript emit options its oracle needs.

### How a case is counted

The test262 runner runs the suite, `conformance262.ts --suite typescript`,
with test262's harness stand-in and layout, the case compiled as
`src/main.ts`. A case gets the same five outcomes as a test262 case, and a
refusal's causes are ranked the same way ([test262](test262.md#outcomes)).
Two things differ:

- nothing is excluded: a case is in scope by being written;
- the report adds a table by feature, one row per `features:` tag. A case
  carries several tags, so the rows overlap and do not sum.

### Records and the gate

A record is [`results/typescript/<backend>/cases.tsv`](../../results/typescript),
one each for `c`, `llvm`, `jvm` and `wasm`: every case that ran, with what it
did, in test262's record format ([records](test262.md#records)).

The gate's `typescript-cases` step, a core step, holds each backend to its
record: a recorded pass that does anything else, a changed failure, a missing
case or a new failure fails it. There is no floor, because the record is the
ratchet. The step needs the test262 checkout, whose harness the cases assert
with.

### Running it

`NTS_BIN` names the compiler; for evidence, a pin of a commit.

```sh
# As the gate does, one backend at a time
node tooling/census/conformance262.ts --suite typescript \
  --recorded results/typescript/c/cases.tsv
node tooling/census/conformance262.ts --suite typescript --backend wasm \
  --recorded results/typescript/wasm/cases.tsv

# Every case, or one family
node tooling/census/conformance262.ts --suite typescript
node tooling/census/conformance262.ts --suite typescript --under tests/typescript/generics

# Re-record, from a pin of a commit
NTS_BIN=$(node tooling/conformance/pin.ts <rev> | tail -1) \
  node tooling/census/conformance262.ts --suite typescript \
  --record results/typescript/c/cases.tsv
```

## TypeScript's own tests

### What runs

TypeScript's compiler test cases, `third_party/typescript/tsc/testdata/tests/cases`,
at the commit `TYPESCRIPT_PIN` names in
`tooling/suite/src/test262_runner/mod.rs`. That commit must be the one the
native checker ports, the `typescript_commit` of
`third_party/tsrs/UPSTREAM.json`: a unit test asserts it, and
`tooling/bootstrap/typescript.ts` refuses a mismatch when it checks the tests
out.

The landing population is the cases `tooling/suite/corpus-core.json` names.
A multi-file case (one with `// @filename:` directives) is skipped: compiled
as one file, it would be a concatenation nobody wrote. `--full` selects every
source case at the pin, a separate survey that no gate step runs.

`nts-suite` compiles each case as an ordinary program. The full survey runs
each compilation in a child process, so a crash is pinned to its file and the
run goes on.

### How a case is counted

| outcome | meaning |
|---|---|
| lowered completely | every construct in the file compiled |
| refused a construct | lowered in part, with each refusal named |
| rejected by the typechecker | usually the file's purpose: a compiler's test suite is mostly programs meant to fail |
| frontend failed | loading or capture failed: the compiler fell over, not the program |
| invalid HIR | lowering produced IR the verifier rejects |
| compiler crashed | the compiler's process died (the full survey's child processes) |
| uncompilable C | the emitted C does not compile |
| unverifiable class | the JVM rejects an emitted class file, checked where a JDK is installed |

The last five must stay at zero: they are the robustness this corpus measures.
It is not a correctness oracle, because these files are checked for types,
never for answers. Its refusal table counts how many files each refusal
stops, which ranks breadth rather than work: a file refused for three reasons
does not lower when one of them is fixed.

### The report and the gate

`nts-suite` writes its report, with the refusal table, to
[`results/suite/corpus.md`](../../results/suite/corpus.md). The
gate's `corpus` step, a core step, runs the landing population and fails if
the run does not finish, if any of the five rows is not zero, or if it
measured no case.

```sh
cargo run --release -p nts-suite              # the landing population
cargo run --release -p nts-suite -- --full    # the full survey
```

## Probing one construct

Whether a single construct compiles is answered by a probe. Write each use as
one exported function at the top level of a file, and run `nts hir` on its
project: lowering reports one diagnostic per function, so a file of thirty
functions answers thirty questions. Two traps:

- a file with a type error lowers nothing, and every row then reads as
  supported, so read the checker's diagnostics first;
- a declaration nested in a function body can be refused for being nested
  rather than for what it is, so probe at the top level.

`nts hir --prepared --backend <backend>` shows what a backend sees.
