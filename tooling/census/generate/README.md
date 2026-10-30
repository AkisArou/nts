# Proof-directed program generation, stage 1

Generate a fact, an effect that can invalidate it, and an observation after the
effect. Each subject has an effect-removed control with a named `expect-ir`
shortcut. Node supplies runtime observations; the maintainer's oracle supplies
compiler measurements. No expected Node answers are embedded in generated code.

## Run

Use the repository's Node and pnpm versions and its locked dependencies:

```sh
pnpm install
node node_modules/typescript/bin/tsc --project tooling/census/generate/tsconfig.json --pretty false
node --test tooling/census/generate/
node tooling/census/generate/main.ts --seed 1 --count 200 \
  --cells bounds:call,bounds:callback,bounds:alias,bounds:loop,bounds:merge,length:call,length:callback,length:alias,length:loop,length:merge \
  --out /tmp/generated
```

The output directory must be empty. `--count` counts attempts: a candidate that
fails a precheck is dropped, recorded as waste, and is not silently replaced.
The CLI prints the four passing counts, waste by reason, and coverage per cell;
the same data is saved in `summary.json`. A run that retains nothing exits 1.
Invalid CLI arguments or infrastructure errors fail explicitly. `--help` lists
defaults and options.

All additions are confined to this directory. No compiler, existing generator,
fixture, dependency declaration, or gate file needs changing. The package entry
`index.ts` exists because Node's explicit directory test argument resolves a
package entry instead of discovering its `.test.ts` files recursively.

## Cells and observations

| Fact | Call | Callback | Alias | Loop | Merge |
| --- | --- | --- | --- | --- | --- |
| Bounds | guarded read after a call shrinks its array | guarded read after a builtin invokes a shrink | a second name, field, nested array or Map entry reaches the array | a later read after a shortening back edge | the `0..3` arm joins an index of 7 before an array read or `charCodeAt` |
| Length | known literal length after a growing/shortening call | length after a builtin callback mutates the array | original length after mutation through an alias | a later length read across the loop back edge | changed and unchanged lengths meet before the read |

The bounds/merge range-join shape follows PR #123's
`bounds-merge-if-else-index.ts`: `n >= 0 && n < 4` establishes `j = n | 0`, the
other arm assigns 7, and both reach one indexed use. Merge programs always
include an arm-order twin with the arms exchanged and the boolean test negated.
Other cells draw whether to include twins. An effect-removed control twin is
also emitted for function placement.

Control assertions are requirements for later measurement, not claims that an
unrun compiler satisfies them:

- array bounds: `all: count array.get.checked in control == 0`;
- literal length: `all: count array.len in control == 0`;
- string range join: `all: control returns integer`.

The string control uses an integer return requirement because counting array
reads in a string-only function would prove nothing. The oracle must reject a
control whose named requirement is missing, unresolved or unmeasured.

## Model and seeded policies

`model.ts` defines a closed scenario language: facts, routes, templates,
containers, mutations, indirection, placement and typed numeric atoms. It has
no arbitrary source fragments or arbitrary operation names. `printer.ts`
implements only those typed constructions; numeric bindings and fields are
annotated, Map lookups are narrowed before use, and the code needs no casts,
`any`, `unknown`, non-null assertions or suppression comments.

`random.ts` owns all randomness. A Mulberry32 stream is derived from the uint32
seed, ordinal and cell. Requested cells are visited evenly in their supplied
order. Rejecting one candidate does not change later candidates' random draws.
The same seed, count and ordered cells give byte-identical output in the same
repository checkout, independent of destination. The required absolute fixture
`extends` deliberately reflects the repository's installed location.

Policies draw:

- numeric boundaries: 0, -1, 2147483647, 2147483648, 4294967296,
  9007199254740992, -0, NaN and fractions, in inputs and array elements;
- direct calls, nested call chains and captured closures;
- local aliases, declared fields, nested array entries and Map values;
- `forEach`, `map`, `filter`, `reduce`, `Array.from`, `Map.forEach` and
  `Set.forEach` callbacks, each driven once on a separate target;
- alias/index chains of 0, 1, 2, 15, 16, 17, 23, 24, 25, 31, 32 or 33 steps;
- nesting depths of 0, 1, 2, 3, 9, 10 or 11;
- an unrelated `number[]` literal, a second caller, both or neither;
- function or module placement, and literal lists or exported parameters.

These stress sizes bracket plausible budgets; they assert no actual nts limit.
Every loop has a literal bounded trip count, independent of extreme inputs.
Features not selected are absent from the source, so different programs have
different shapes. Stage 1 uses ordinary arrays and the string range witness;
the deterministic language can grow later without widening these ten cells.
There are no dates, clocks, random calls, locales, approximated math, sort
comparators, reflection, prototype changes or recursion in emitted programs.

### Literal lists, parameters and module execution

Parameterized functions expose numeric parameters and get workload domains
covering the numeric boundaries (including NaN and signed zero). Domains
constrain generated calls, never compiler assumptions. Literal-input functions
contain the input list unrolled into scoped scenario bodies, keeping the fact
and use inside the named control. They return semicolon-delimited observations
that preserve NaN, -0 and undefined. The manifest identifies each internal input
that actually separates the subject from its control.

Module placement executes the establish/effect/use bodies during module
initialization, then exports readers of the resulting observations. It uses
literal inputs because exported parameters do not exist at initialization.
The identical effect-removed function `control` owns the meaningful named IR
assertion. `controlModule` observes the true module control and is a twin of
that function: it must agree under Node and in the oracle on every backend.
This certifies the function control's shortcut and the module control's
behavior; it does not certify an optimization inside the module initializer.
A zero-operation assertion on the exported snapshot reader would be vacuous.

The string range witness is parameterized and placed in a function, so its
integer-return assertion applies directly to the indexed operation. Array
range witnesses supply the other placements and input sources.

## Output contract

Each numbered program directory contains:

- `src/main.ts`, starting with `// run: check`;
- `tsconfig.json`, strictly extending an absolute path to this checkout's
  `tsconfig.fixtures.json`;
- `manifest.json`, with generator version, seed, ordinal, cell, template,
  complete model, every exported function's role and calls, shortcut
  requirements, source hash, and observed distinguishing inputs;
- `main.domains.json` when the exported functions have numeric inputs, and an
  identical `src/main.domains.json`.

The two sidecar locations are intentional. The handoff requests the root
file; nts loads `entry.with_extension("domains.json")`, so its consumed file
is beside `src/main.ts`. Literal-only programs have neither sidecar.

JSON represents NaN as `"NaN"` and signed zero as `"-0"`. Ordinary numbers
remain JSON numbers. `sourcePhase: "text"` means that the stored model is the
last model ancestor and the real `src/main.ts` is authoritative after deletion.
An edited source is never silently reconstructed from that ancestor.

## Prechecks and waste

`precheck.ts` invokes this repository's installed TypeScript compiler, forces
`strict`, and checks the actual generated project. `node-worker.ts` then
executes every manifest call twice within each of two fresh Node processes.
It verifies the actual export inventory rather than trusting that a renamed
or deleted function was tested. Observations encode special numbers and
undefined without JSON's information loss.

Every retained program passes:

1. strict checking, as written;
2. identical observations across repeated calls and fresh processes;
3. complete twin/counterpart equality over their input lists;
4. at least one subject/control distinguishing input for every subject.

Waste reasons are `typecheck`, `node-error`, `nondeterministic`,
`twin-mismatch`, `no-witness` and `invalid-inventory`. Counts are staged, so a
program failing at step 3 still contributes to the first two passing counts.
Node exceptions and timeouts do not count as successful observations. The
test suite includes independently written sabotage cases for these checks.

## Oracle integration

The maintainer supplies the nts adapter. `oracle.ts` exports `Oracle`,
`OracleRequest`, `OracleResult`, `parseOracleResult` and `assessFinding`.
The adapter module exports either `evaluate(request)` or
`default { evaluate }`; async functions are supported.

```sh
node tooling/census/generate/main.ts \
  --reduce /tmp/generated/000004-bounds-merge \
  --oracle /path/to/nts-oracle.ts
```

`OracleRequest` carries the materialized project directory, exact source,
cell, template, function roles/counterparts/shortcut requirements and requested
backends (`c`, `llvm`, `jvm`). Each backend returns the existing version-1
`CheckReport`, whose function count must cover the requested export inventory,
plus per-control projections of measurements of the **same
whole program**, and each control's exact shortcut result. Compiling a control
alone changes program-wide facts and is not acceptable evidence.

`OracleResult.failure` is null for no finding, otherwise it names a stable bug
signature, failure kind and set of failing backends. Failure kinds are
`wrong-answer`, `abort`, `error:<CheckFailure.kind>`, or a sorted `+` join
when backends fail in different ways. Its stable signature must exclude
temporary paths, source hashes and changing values. The adapter, which knows
the actual failure, supplies that identity.

Controls and control-derived twins need their own complete, nonempty,
single-function agreeing reports on **every** requested backend, with no
unavailable cases, declines, timeouts, approximate comparisons, refusals,
disagreements or aborts. Their oracle coverage and compared counts must be
complete. Each exact shortcut must have status `pass`; `fail`, `unresolved`
and `not-measured` all reject the candidate. An aggregate `agrees` verdict
without those measurements cannot preserve a control. Function control twins
own their own shortcut; a module control twin inherits its function witness.

A shortcut also requires `use: "present"`, certifying that the relevant control
use still contributes to the candidate's output (it may then be folded by the
compiler). `use: "missing"`, `use: "not-measured"`, and omission of the field
reject a candidate even if its exact IR `status` is `"pass"`. A zero count
after text deletion removed the use is not such a certificate. The adapter
checks that obligation alongside `nts expect-ir`; the reducer's fake oracle
tests deliberately reject removal of either the subject's route/read or the
control's read.

The test oracles manufacture reports to test these rules. They do not predict
nts results, run nts, or stand in for the pinned-compiler acceptance test.

## Reduction and grouping

`reduce.ts` runs the same gates on the baseline and every attempted reduction:
strict checking, repeated Node results, twins, a live distinguishing input,
the same oracle failure identity/backend set, agreeing controls and verified
control shortcuts. A rejected candidate never replaces the retained program.

The model phase removes context statements and input entries, shortens chains,
lowers nesting, simplifies indirection/containers, and replaces numbers by
smaller values of the same class. Fractions remain fractional; signs remain;
NaN and signed zero are irreducible. The text phase uses Node's type stripper
and the repository's existing Acorn parser to delete actual statement ranges,
including nested and multiline statements. It edits the real TypeScript source
at preserved offsets. Every text candidate must pass the same checks.

By default reduction writes a new `<input>.reduced` directory and leaves the
input untouched. `--out` chooses another empty directory. `--max-candidates`
defaults to 500; an exhausted budget is recorded and reported, never described
as a minimal result. `reduction.json` saves the accepted oracle report,
source-independent failure identity, final grouping signature, and acceptance
and rejection counts. Final written bytes receive the Node/strict prechecks.

`grouping.ts` groups by cell, template, failure kind, sorted backend set and a
SHA-256 hash of the shrunk source with names normalized. Lexical bindings are
renamed by scope; shadowing, literals, property names, free/intrinsic names,
operators and TypeScript type syntax remain significant. Comments and
formatting do not. Class references in type positions follow class renaming;
other type-only names are conservatively retained. The source hash is used
**after** reduction, never in its failure-preservation comparison.

## Source contracts

- [`cloud-agents.md`](../../../docs/contributing/cloud-agents.md) and the
  handoff's directory-only exception;
- [PR #123](https://github.com/AkisArou/nts/pull/123), its proof matrix and
  `chatgpt/proofs-bounds` examples;
- [numbers](../../../docs/foundations/numbers.md#integers-proved-from-doubles)
  and [arrays/functions](../../../docs/foundations/objects.md#arrays);
- [fixture lessons](../../../docs/contributing/lessons/fixtures.md);
- [`expect-ir`](../../cli/src/expect_ir.rs),
  [workload domains](../../../benchmarks/README.md), and
  [`CheckReport`](../../differential/check-report-types.ts).

Maintainers connect the adapter, measure shortcut hit rates, and run the hidden
pinned-build acceptance test before stage 1 is accepted. Further stages wait
for that review.
