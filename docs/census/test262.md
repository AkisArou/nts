# Test262 as a gap census

**This is not a conformance report and contains no pass rate.** It compiles a
slice of Test262 and records *why* each file fails to lower. Nothing is
executed, nothing is compared against node, and no refusal is promoted to a
Test262 verdict — the rule is
[`test262.md`](../conformance/test262.md)'s own: *"no compiler refusal can be
promoted to a Test262 verdict"*.

`lowers` below means the compiler accepted the program. It does **not** mean the
program computes the right answer, and this instrument cannot tell.

## Why

The hand-written corpus is 257 examples and repeatedly turns out to cover the
ordinary middle. Six defects were found in one night by writing ten-line
fixtures for shapes nobody had written down, and three of them scored **zero
sites** in the existing refusal census — every function that would have reached
them stopped earlier on something else. `test/language/expressions` is 11,102
files that enumerate the corners of the language on purpose.

## The run

```sh
cargo run -q -p nts-suite --no-default-features --bin nts-test262-protocol -- \
  select third_party/test262 test/language/expressions > selection.jsonl
node tooling/census/test262.mjs --selection selection.jsonl --slice1
```

Suite pinned at `14e8c908e54ae2e770e473bcacf536f8cb654929`. Two runs over one
checkout produced identical bucket counts.

The **full strict lane** is the 10,445 scheduled files; **slice 1** is the
2,527 files that are scheduled for the strict lane, carry no
harness `includes:`, contain no `function` or `=>` token, and are not negative
tests. No unannotated parameter means no implicit `any`, so a refusal here is a
lowering gap rather than the typecheck wall — which is what makes this slice
worth running before `NeedsRepresentation` exists.

## Outcomes

| | full lane | slice 1 | |
| --- | ---: | ---: | --- |
| files | 10,445 | 2,527 | |
| `lowers` | 500 | 481 | accepted — **not** verified correct |
| `unsupported` | 936 | 425 | a lowering refusal; **this is the census** |
| TypeScript error | 8,875 | 1,603 | 107 / 65 codes, before lowering is reached |
| `frontend-crash` | 134 | 18 | a `tsgo` panic, not a gap of ours |
| distinct first refusals | **49** | 37 | |

Slice 1 is the better instrument for the language: it is the slice with no
unannotated parameters, so almost everything that reaches lowering reaches it
for a reason about the code rather than about `any`. The full lane is 85%
TypeScript errors.

The TypeScript column is the larger half and is not a defect list: Test262 tests
coercion on purpose, and a typed language rejects much of it statically. The
five biggest are `TS2362` (201), `TS2769` (181), `TS2348` (121), `TS2339` (113)
and `TS2304` (112); `TS18050` — *"The value 'undefined' cannot be used here"* —
is 93 on its own.

## What the compiler refuses, ranked

37 distinct first refusals. **This ranks reach, not causes**: the compiler
reports one blocker at a time, so a file contributes only its first, and a row is
where reducing starts rather than a defect.

| files | first refusal |
| ---: | --- |
| 80 | a default on a property that can be `X` as well as missing |
| 48 | `X`, a builtin this compiler does not provide |
| 36 | a module-scope variable of unrepresentable type |
| 36 | **reading a name before it is bound** |
| 25 | a method `X` with no declaration in the hierarchy |
| 24 | `X`, a static field this compiler gave no storage |
| 23 | a `X` of unrepresentable type |
| 23 | `X`, declared by `X` with a type that has no representation (a function type) |
| 20 | a parameter of unrepresentable type |
| 20 | a rest element with no name |
| 18 | **an omitted expression** — array elisions |
| 10 | `X` or `X` where what it stands in for is not a reference |
| 9 | an `X` against something this compiler has no class for |
| 8 | a property `X` of unrepresentable type (any) |
| 7 | a static field of an anonymous class |
| 5 | assignment to a computed target |
| 4 | a `X` literal needing more than the 128 bits this compiler gives one |
| 3 | a try statement, which has code in it |

The two in bold are the kind this corpus exists to surface, and both needed
checking before they could be described — the first draft of this paragraph was
wrong about each.

**An omitted expression** is an elision in an *array literal*: test262's
`var array = [,,,,,]`. `typescript.md` has no row for it. The corpus does cover
elisions — `examples/a-hole-in-a-destructuring-pattern` — but every one of them
is a **destructuring pattern** (`const [, second] = pair`), which is a different
production. 18 files separate the two.

**Reading a name before it is bound** was described here as the temporal dead
zone, pointing at the ✅ ledger row for it. **That was wrong on 2026-09-18, and
wrong in the way this document keeps warning about: a diagnostic's text is not
its cause.** `NTS1004` is the dead-zone diagnostic, it is about *cross-module*
evaluation order, and its first test is `if declaring == at { return }` — so it
cannot fire on a single-file program, which every file here is.

The real refusal is a `Place::Binding` whose symbol was never bound, and all 36
files are **compound assignment** over a module-scope `var` with no annotation:

```js
var x;
x = -1;
x += -1;
```

The checker fills such a declaration's type in from the assignments that follow.
`lower_variable_statement` reads that back with `evolved_type` and always has;
`collect_module_scope` asked `type_of` alone, so the same three lines were an
ordinary local inside a function and refused one scope out. Fixed 2026-09-18 —
`examples/an-evolving-type-at-module-scope`, and 12 of 12 sampled files went
from refused to `strict-pass`.

It also ranked **twice**. The root, *a module-scope variable of unrepresentable
type*, is 36 files as well — the same 36. The read that follows the missing
global refuses again, and a table of first-diagnostics counts one cause under
two headings and names it wrongly under both.

It is worth saying plainly what this cost: the paragraph here read confidently,
named a mechanism, and cited a ledger row — and every part of that was reached
by matching the *words* of a diagnostic rather than by reading the code that
emits it. The row it cited is about something else entirely.

## Two upstream crashes, found by running the corpus

134 files panic the vendored TypeScript frontend, in two distinct families.
Neither is a gap here, and they have their own bucket so they cannot be folded
into the refusal ranking or the typecheck column.

**130 files**, all `dynamic-import/**/*import-defer*`, out of
`getSymbolsAtLocations`:

```
panic: Debug failure. False expression:
  Trying to get the type of `import.defer` in `import.defer(...)`
```

**4 files**, `assignment/dstr/*nested-array*`, out of `getTypeArguments` — and
this one is on ordinary code rather than a stage-3 proposal:

```
panic: interface conversion:
  checker.TypeData is *checker.TypeReference, not *checker.TupleType
```

Minimised to two lines:

```ts
let x: number;
[[x]] = [[]];        // panics;  [[x]] = [[1]] does not
```

Nested array destructuring assignment against an **empty** nested array
literal. A flat `[x] = [1]` is fine, and so is a non-empty `[[x]] = [[1]]`.

## The first conformance result — 486 of 2,527

**`tooling/census/run262.mjs` builds, links and runs.** It is the half this
census deliberately does not do, and it answers the question the census cannot:
not *why does this not lower* but *does the program do what the specification
says*.

At test262 `14e8c908`, compiler `a780cf01fcbc8c3c`, over the 2,527 slice-1
files under `test/language/expressions`:

| | files | |
| --- | ---: | --- |
| `strict-pass` | **486** | compiled, linked, ran, completed normally |
| `unsupported` | 2,019 | 1,603 TypeScript, 413 lowering, 3 link |
| `frontend-crash` | 18 | all in `syntax/`, the two upstream `tsgo` panics |
| `threw Test262Error` | **4** | compiled, ran, and gave a wrong answer |

2,019 + 486 + 18 + 4 = 2,527. The run prints that sum and says so when it does
not reconcile.

**Re-measured the same evening**, on `f07920ea6d20a7a4` — the same corpus and
the same instrument, with four of that day's fixes in the compiler:

| | before | after | |
| --- | ---: | ---: | --- |
| `strict-pass` | 486 | **527** | +41 |
| `unsupported` | 2,019 | 1,979 | −40 |
| `threw` | 4 | **3** | the underflow one |
| `frontend-crash` | 18 | 18 | upstream, unchanged |

The +41 is the module-scope evolving-type fix (36 files by its own count, all
compound assignment) plus the destructuring-default work. Two numbers from two
binaries over one corpus, which is the only way a claim about a compiler moves
rather than merely being restated.

The `in` fix landed *after* this run was pinned, so it is not in the 527 — and
it does not clear its own test either: the file's receiver is `var __obj = {}`,
whose inferred type is `{}`, and `{}` accepts strings. See the ledger row.

**One strict variant per file.** `strict-pass` is not a file pass, and a file
whose metadata also wants a sloppy variant is not fully answered. Negative
tests, `noStrict`, modules and raw are scope-excluded by the scheduler; a test
whose `includes:` names a harness file beyond the `assert.js`/`sta.js` stand-in
is excluded here.

### The four that ran and were wrong

These are the whole point of running rather than compiling. Every one was a real
defect and none of them emits a diagnostic:

- `multiplication/S11.5.1_A4_T7.js` — `1 / (-0.1 * Number.MIN_VALUE)` answered
  `+Infinity`. A zero made by **underflow** kept no sign: `facts::mul`'s rule
  asked only whether an *operand* was zero. **Fixed 2026-09-18**, with three
  folded arms in `examples/negative-zero`.
- `greater-than/S11.8.2_A4.12_T1.js` and `less-than/S11.8.1_A4.12_T1.js` — both
  are `"\uDC00" > "\uD800"`, and the cause is not comparison. An **unpaired
  surrogate does not survive the frontend**: `"\uD800"` arrives as *three*
  U+FFFD code units, emitted literally as `{ 65533, 65533, 65533 }` with
  `length` 3. Its three WTF-8 bytes were each replaced by a lossy UTF-8 decode
  at the transport boundary. Our own string representation is not at fault —
  `length`, `charCodeAt` and ordering are all correct UTF-16 for every
  well-formed string, including astral pairs — so the ✅ relational-comparison
  row stands and the gap is the literal, not the operator.
- `in/S8.12.6_A2_T1.js` — `"valueOf" in {}` answers `false`. `in` does not
  consult `Object.prototype`, so no inherited name is visible to it.

### Why this number was 151 the first time

The runner read **stdout**, and `emit-c` prints refusals on **stderr** while
exiting 0. So the `unsupported/lowering` bucket never once fired, and every
refused program was linked and run anyway: one that completed came back
`strict-pass` — *a compiler refusal counted as a pass*, which is the one rule
this document's protocol says must never be broken — and one that threw came
back as a conformance failure. 151 of the first 906 rows were the second, every
one from `class/dstr`, and they read as 151 correctness bugs. They were **one**
refusal dropping a method body whose last statement increments the counter the
test then asserts on.

Neither existing self-check could see it, because both are clean programs. The
third arm is a program that is *refused* and would otherwise complete, required
to come back exactly `unsupported` — not merely "not a pass", since a crash
would satisfy the weaker test while the refusal still went unread.

### What blocks the 413 that reach lowering

The census ranks the whole corpus, most of which never typechecks. This ranks
the population that actually *could* have run: the 413 slice-1 files that
typecheck, reach lowering, and are refused there. 37 distinct shapes.

| files | first refusal |
| ---: | --- |
| 48 | `X`, a builtin this compiler does not provide |
| 40 | a method `X` with no declaration in the hierarchy |
| 40 | an erased value where a concrete representation is wanted |
| 36 | a module-scope variable of unrepresentable type |
| 36 | reading a name before it is bound |
| 32 | `X`, a static field this compiler gave no storage |
| 31 | `X`, declared by `X` with a type that has no representation (a function type) |
| 24 | a `X` of unrepresentable type (`X`) |
| 20 | a parameter of unrepresentable type (`X`) |
| 20 | a rest element with no name |
| 12 | an omitted expression |

**The top row is not a gap, and the two after it are one cause.** Both are
reasons to read a ranked table with the files open rather than as a backlog.

*`a builtin this compiler does not provide`* is **43 `eval`**, plus one
`Function`, one `RegExp`, and three others — counted by opening all 48. `eval`
and `Function` are a documented boundary, not an oversight: `docs/eval.md`
records a possible AOT design for them and states that the default profile
"remains engine-free" and "must never silently add an interpreter, bytecode VM,
JIT, runtime compiler, or external compilation service". So the largest single
row in this table is a design decision the project has already taken, and
treating it as the next thing to fix would be reading the table backwards.

*`a module-scope variable of unrepresentable type`* and *`reading a name before
it is bound`* are **the same 36 files**, counted twice: the second is the read
that follows the global the first did not create. Both were fixed on
2026-09-18, and the section above records how the second came to be described
here as the temporal dead zone.

Removing those leaves *a method with no declaration in the hierarchy* (40) and
*an erased value where a concrete representation is wanted* (40) as the largest
rows that are actually work.

### And the six largest shapes occur nowhere else

Split the 413 by whether the file is in one of test262's **generated**
families — `class/dstr`, `object/dstr`, `assignment/dstr`, `class/elements`,
which expand one construct exhaustively across method / generator / async /
static / private / anonymous-class forms — and the table separates almost
perfectly. 215 files inside, 198 outside.

| elsewhere | generated | shape |
| ---: | ---: | --- |
| 48 | 0 | `X`, a builtin this compiler does not provide (43 are `eval`) |
| 36 | 0 | reading a name before it is bound *(fixed 2026-09-18)* |
| 32 | 4 | a module-scope variable of unrepresentable type *(fixed 2026-09-18)* |
| 24 | 0 | a `X` of unrepresentable type |
| 10 | 0 | `X` or `X` where what it stands in for is not a reference |
| **0** | **40** | an erased value where a concrete representation is wanted |
| **0** | **40** | a method `X` with no declaration in the hierarchy |
| **0** | **32** | `X`, a static field this compiler gave no storage |
| **0** | **31** | declared by `X` with a type that has no representation |
| **0** | **20** | a rest element with no name |
| **0** | **20** | a parameter of unrepresentable type |

**The six largest shapes in the whole table occur in the generated families and
nowhere else.** They are not six independent language gaps; they are one
construct family — destructuring patterns in method positions — refused at
whichever point each combination reaches first. `class/dstr` alone is 150 files
spread across seven "shapes".

That cuts both ways and both are worth stating. Clearing them would move the
number a great deal for a narrow amount of language. And the *breadth* of what
this compiler cannot do is better read off the 198 outside, which after removing
`eval` and the two fixed on 2026-09-18 is a long thin tail: 24, 10, 9, 5, and
then ones and twos.

The first is **`next` in all 40** — the iterator protocol, and it already has a
✗ ledger row: `IteratorResult<T>` is "a union of two object types whose `value`
is `T` in one and `any` in the other, so they lay out differently and the union
has no representation". `typescript.md` also records that `any` is only its
*first* blocker, that `done?: false` and `done: true` representing differently
is an independent second one, and that this was measured and reverted once
already. So this row is one known piece of work with a design behind it, not 40
separate things — which is the useful thing a ranked table can say, and only
says if somebody opens the files.

### And what blocks the 1,603 that never typecheck

Sampled 40 at random from the slice-1 population and opened each. The answer is
a long tail, and **it is not the harness**:

| code | n | |
| --- | ---: | --- |
| TS2362 | 7 | arithmetic on a non-number |
| TS2339 | 6 | property does not exist on type |
| TS2348 | 4 | value is not callable |
| TS2365 | 3 | operator cannot be applied |
| TS2304 | 3 | cannot find name |
| TS18050 | 3 | |
| — | 14 | eleven other codes, one or two each |

These are TypeScript statically rejecting dynamically-typed JavaScript, and **no
configuration reconciles them**: `"a" * 1` is TS2362 whatever `noImplicitAny`
says, because the operand has a known literal type.

The three `TS2304`s are `x`, `y` and `unresolved` — the tests' own undeclared
globals, not a harness entry. That matters for planning: `$DONOTEVALUATE` is
2,034 files **corpus-wide** and is the right first harness fix, but every one of
them is a *negative* test, which this lane scope-excludes. It does not move this
number. A figure taken from the whole corpus and spent on a sub-population is
the same mistake as a ranked table read without opening the files.

## What this census cannot see

Printed by the instrument on every run, not left to a reader.

1. **The census executes nothing.** `lowers` is not `correct` — which is what
   `run262.mjs` above exists to answer, and it is a separate instrument with a
   separate population.
2. **Only the first blocking diagnostic per file is ranked**, so this ranks
   reach rather than causes.
3. **The harness is a stand-in.** `tooling/census/harness.ts` replaces
   `assert.sameValue`/`notSameValue` with overloaded signatures, which is
   permitted — *"Test262 permits implementations to replace harness functions
   with equivalent functionality"*. The shipped `assets/test262/host.d.ts`
   cannot be used: its declaration identities depend on a host-intrinsic mapping
   that does not exist, so `declare const assert` lowers as a module binding and
   produced **918 refusals on one ordinary file, every one of them the harness**.
   A test whose `includes:` names `propertyHelper.js` or `compareArray.js` is
   outside the slice this can speak about.
4. **A file that never typechecks says nothing about the lowering behind it.**
   That is 1,603 of 2,527 here.
5. **Unparsed diagnostic lines are counted and printed**, because they make a
   corpus look *less* blocking, not more.

## The self-checks, and why each exists

- **Control** — a program that must lower. If it does not, the materialiser is
  wrong rather than the compiler.
- **Sabotage** — a program that must not. It caught its own first draft: an
  unused `const v: any = 1` *lowers*, because the binding is dead and nothing
  ever reads it as an `any`.
- **Footer reconciliation** — the compiler prints its own
  `M construct(s) refused`, and every file compares the diagnostics parsed
  against it. This is how the reader's own bug surfaced: TypeScript codes can be
  **five** digits (`TS18050`), the pattern matched four, and seven of the first
  sixty files parsed as having no diagnostics at all. They landed in an
  unclassified bucket rather than in `lowers` only because the catch-all was
  written to distrust itself.

## Status

Advisory. `docs/conformance/test262.md` says larger reports stay advisory until
coverage is broad enough to set a meaningful gate, and a twenty-minute run is a
background job rather than a gate step. What *is* gated is cheap and has no
compiler dependency: the pin being reachable, and
`tooling/census/audit.mjs`'s three static questions over the feature
classifications.

## The classification check, and what it is worth

`tooling/census/audit.mjs --rows` joins the census against `features.json` and
reports a classification the corpus contradicts. Its first run over the full
lane flagged three, and **all three were artefacts of its own denominator**: it
counted files that *declare* a feature rather than files that *reached
lowering*, so `class-static-fields-private` read as "0 of 171 lower" when 102 of
those are `TS7008` and never got that far.

Corrected to the honest denominator, one survives — and it is still not a
finding. Those 7 files refuse with *"a static field of an anonymous class"*,
which is a different gap; a private static field lowers perfectly well, checked
against three controls.

So the check now prints **what the files refuse with** beside the flag, because
that single line is what refutes it. It is a pointer to something worth reading,
not a verdict: the compiler reports one blocker at a time, so a refusal in a
file declaring feature A very often names feature B.
