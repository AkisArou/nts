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
| `frontend-crash` | 134 | 18 | a `tsgo` panic; **closed 2026-09-20** --- see the correction below |
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
| ~~15~~ | ~~an empty array literal in a position that does not say what it holds~~ — closed 2026-09-20; `never[]` is the checker saying nothing can be read, so the element width is unobservable |
| 10 | `X` or `X` where what it stands in for is not a reference |
| 9 | an `X` against something this compiler has no class for |
| 8 | a property `X` of unrepresentable type (any) |
| ~~7~~ | ~~a static field of an anonymous class~~ — closed 2026-09-20; the field takes the same `Type{id}` stand-in its own class's methods already take. 6 of the 7 pass in census 13; the seventh advanced to `eval` |
| 5 | assignment to a computed target |
| 4 | a `X` literal needing more than the 128 bits this compiler gives one |
| 3 | a try statement, which has code in it |

The two in bold are the kind this corpus exists to surface, and both needed
checking before they could be described — the first draft of this paragraph was
wrong about each.

**An omitted expression** is an elision in an *array literal*: test262's
`var array = [,,,,,]`. `typescript.md` had no row for it; it has one as of 2026-09-18. The corpus does cover
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

> **Closed 2026-09-20, and the second one's cause is corrected below.** Both
> families now produce a diagnostic. The sentence *"neither is a gap here"* was
> half right and the wrong half was load-bearing: the panics are upstream's, and
> **the fatality was ours**. tsgo recovers each one and answers with an error;
> our side turned that error into a dead compile. `types_at` had handled exactly
> this since it was written --- bisect a failed batch, answer `None` for a single
> location that still fails --- and no other request did.
>
> So the correct reading of this bucket was never "someone else's bug". It was
> "the one place that degrades does not cover these paths".

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

**That minimisation named the wrong construct**, and it took four more probes to
see it. The precondition is an empty tuple **nested inside another tuple**, and
destructuring has nothing to do with it:

```ts
const nest: [[]] = [[]];   // panics; no destructuring anywhere
const e: [] = [];          // fine --- the same empty tuple, not nested
```

The reduction had removed everything *except* the destructuring, so the one
thing left standing looked like the cause. What the accepted spelling has is
`types_at`: a top-level type goes through the batch that bisects and degrades,
so the identical upstream failure is swallowed there and fatal here. One bug,
fatal on one path and invisible on the other, and a reduction that removed the
precondition along with everything else.

The cause is in tsgo's **API layer**, not its checker: `newTypeResponse` reads
`ObjectFlagsTuple` off a type and calls `AsTupleType()`, but an instantiated
tuple's data is a `TypeReference` and the tupleness lives on its target. Five
shapes reached it through three different requests, and only `getTypeAtLocations`
survived:

```
const nest: [[]] = [[]]           getTypeArguments
[[x]] = [[]]                      getTypeArguments
[[x, y]] = [[]]                   getTypeArguments
({ a: [x] } = { a: [] })          getTypesOfSymbols
import.defer('./x.js')            getSymbolsAtLocations   (the other family)
```

Both now answer with a refusal or a TypeScript error. The degradation is
`Unknown` rather than an empty tuple on purpose: the failing programs *contain*
an empty tuple, so answering with one would look right on exactly them and give
every other tuple the wrong arity in silence.

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

**Re-measured twice the same evening**, same corpus and same instrument, on
compilers carrying successively more of that day's fixes:

| | `a780cf01` | `f07920ea` | `2b47cdae` | `2b71401d` |
| --- | ---: | ---: | ---: | ---: |
| `strict-pass` | 486 | 527 | 536 | **542** |
| `unsupported` | 2,019 | 1,979 | 1,970 | 1,964 |
| `threw` | 4 | 3 | 3 | 3 |
| `frontend-crash` | 18 | 18 | 18 | 18 |

+41 then +9. The first step is the module-scope evolving-type fix (36 files by
its own count, all compound assignment) plus the destructuring-default work; the
second is completing that work for an **erased** element, which is the inferred
shape and needed a second test for a present-but-`undefined` element.

Three numbers from three binaries over one corpus, each with its own compiler
fingerprint in the report. That is the only way a claim about a compiler moves
rather than being restated — and the fingerprint is the bytes rather than the
path, because `target/release/nts` is what everyone builds into.

The fourth column is the same corpus once those landed: a module-scope `switch`
and a labelled block, both of which **panicked** the compiler rather than
refusing, and a class whose only static member is a block. +6.

+41, +9, +6 — the steps get smaller because the population is one directory and
the shapes left in it are two known pieces of work. That is the argument for
widening rather than for grinding: see the run over all of `test/language`.

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

### Widened to all of `test/language` — 1,132 of 4,812

The lane had measured **one directory** for four runs. `test/language` is
23,726 scheduled files, 4,812 of them slice-1, against the 2,527 under
`expressions`. At `fc4cb1c3`:

| | files | |
| --- | ---: | --- |
| `strict-pass` | **1,132** | 542 of them in `expressions`, 229 in `statements`, 121 in `literals`, 84 in `identifiers`, 47 in `asi` |
| `unsupported` | 3,659 | 2,747 TypeScript, 898 lowering, 13 link |
| `frontend-crash` | 18 | unchanged; all in `expressions/syntax` |
| `threw Test262Error` | **3** | the same three as before |

3,659 + 1,132 + 18 + 3 = 4,812, and all three self-checks fired.

**Re-measured at `a33f93ba` once the two gaps this widening found were closed:
1,167**, with `unsupported` at 3,624 and nothing lost.

| | `fc4cb1c3` | `a33f93ba` |
| --- | ---: | ---: |
| `strict-pass` | 1,132 | **1,167** |
| `unsupported` | 3,659 | 3,624 |

+35, and the rows are named rather than inferred — every newly passing file is
matched against the refusal it used to carry:

```
  22  `a name from an enclosing scope`      module-scope destructuring
  11  `a label on something that is not a loop`
   2  (had not reached lowering before)
```

Both are gaps **only the widening could have shown**: 37 of the first and 14 of
the second, and not one of those 51 files is under `expressions`.

**The widening doubled the passing count and found no new wrong answers.** That
is the most useful thing it says. Three files in 4,812 compile, run, and answer
wrongly, and they are the two lone-surrogate comparisons and `"valueOf" in {}` —
already diagnosed, already carrying ✗ rows. The defects found the same evening
by hand-probing module-scope statements are *not* in this corpus: test262's
positive slice reaches them through assertions that hit a refusal first.

### And what the wider corpus blocks on that expressions never showed

Of the 898 lowering refusals, 473 are in the generated `dstr`/`class/elements`
families and 425 elsewhere. The rows that are new:

| files | first refusal |
| ---: | --- |
| 154 | `X`, a builtin this compiler does not provide — still mostly `eval` |
| 36 | a regular expression literal |
| 25 | an empty array literal in a position that does not say what it is |
| 14 | **a label on something that is not a loop** — *fixed 2026-09-18* |
| 13 | a conversion to string from unknown |
| 9 | a declaration without an initializer |
| 6 | a `using` declaration, whose scope-exit disposal — *newly refused, see the ledger* |

The label row is the one this widening was for. Not one of its 14 files is an
expression — they are `asi` and `statementList`, where a label on an expression
statement is the subject of the test — so four runs over `expressions` could
never have seen it. 11 of 14 now `strict-pass`.

### The non-generated backlog, attributed

414 lowering refusals sit outside the generated `dstr`/`class/elements`
families. Opened and grouped by **cause** rather than by message, since a cause
routinely wears two:

| files | | |
| ---: | --- | --- |
| 159 | `eval` and dynamic code | §13, and `docs/eval.md` has the design that is deliberately not built |
| 87 | everything else | a thin tail of ones and twos |
| 61 | the **wrapper objects** | `new Boolean/Number/String`; two messages until 2026-09-18, when the module-scope one started naming its type |
| 38 | regular expression literals | needs an engine |
| 26 | the **array-growth pair** | the empty-literal refusal stands in front of a growing index write that *aborts*; closing one alone is worse |
| 17 | an absence in a non-reference slot | `null`/`undefined` where the representation has no room |
| 13 | `String()` of something that may be an object | reasoned: an `unknown` may hold one, and object `toString` is §13 |
| 7 | array elisions | `[1, , 3]` |
| 6 | `using` | newly refused, having previously compiled and silently disposed of nothing |

**Nothing large is unexplained.** Of the 414, 250 are decisions the project has
already taken and written down, and the largest thing that is *work* is an
engine for regular expressions. That is the useful state for a backlog to be in,
and it took opening the files: four of these nine groups were reached by probing
a message down to the smallest program that reproduces it, and two of them turned
out to be one cause under two headings.

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

**Opened, the six reduce to two.** Each was probed to the smallest program that
reproduces it:

| shape | files | what it actually is |
| --- | ---: | --- |
| a method `next` with no declaration | 40 | the iterator protocol |
| a parameter of unrepresentable type | 20 | `Iterable` — the same |
| declared by `X` with no representation | 31 | a generator's return type — the same |
| an erased value where a concrete one is wanted | 40 | **cleared 2026-09-18** |
| a rest element with no name | 20 | **cleared 2026-09-18** |
| a static field this compiler gave no storage | 32 | a static field on an *anonymous* class expression |

So the generated families' remaining blockers are **the iterator protocol (~91
files) and anonymous-class statics (32)**, not six independent gaps. The second
is a refusal with a written rationale — a `static` is addressed by name from
source and a numbered stand-in is a name no source traces back to — and it has a
one-word workaround: `const C = class Named { static n = 5 }` compiles where
`const C = class { static n = 5 }` does not. Probed both ways; a private method
on an anonymous class expression is fine, so anonymity alone is not the
condition.

This is the difference between a table and a diagnosis, and it took opening the
files rather than ranking them.

The largest row left outside the generated families, after `eval` and the two
fixed that day, is **24 files of wrapper objects** — `new String`, `new Number`,
`new Boolean`, counted by opening them. They have a ✗ ledger row as of
2026-09-18: objects rather than primitives, needing a boxed representation and
`ToPrimitive` at every operator, for a construct no code written this decade
uses deliberately. test262 exercises them heavily because they are specified,
which is what puts them that high here and nowhere else.

The first is **`next` in all 40** — the iterator protocol, and it had a ✗
ledger row: `IteratorResult<T>` was "a union of two object types whose `value`
is `T` in one and `any` in the other, so they lay out differently and the union
has no representation", with `any` as its first blocker and `done?: false`
against `done: true` as an independent second. One known piece of work with a
design behind it, not 40 separate things — which is the useful thing a ranked
table can say, and only says if somebody opens the files.

**Closed 2026-09-19**, and both blockers dissolved rather than being worked
around: the layout is *provided* per instantiation, so no arm is decomposed and
the optional modifier is never met, and the return arm's `value` gets no slot,
so `TReturn`'s `any` is not represented at all. `typescript.md` carries the
account. **The 40 are not 40 fewer**: `Iterator<T>`, `Iterable<T>` and
`IterableIterator<T>` as annotations are still refused one link above, at
interface dispatch for a library interface, and this table's rows should be
re-ranked from a run rather than adjusted by reasoning.

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

### 1,243 of 4,812, and what the 839 lowering refusals actually are

Measured 2026-09-19 with the compiler pinned, over the same slice-1 population:

```text
  3548  unsupported     2747 do not typecheck, 800 refuse at lowering, 1 at emit
  1243  strict-pass
    18  frontend-crash
     3  threw           ran and answered wrongly
     0  crash
     0  invalid HIR     a file that emitted nothing and said nothing
```

**The bottom row is the one that moved last.** A separate pass over the same
population found **135 files** whose first diagnostic was *a value of type
`never` reached code generation* and **18** that emitted C and failed to link --
both of which mean the compiler exited 0, wrote no usable program and named no
construct. Every one is now a refusal that names something, and the pass count
did not move by a single file in either direction, which is what that conversion
should look like.

**1,175 -> 1,209 -> 1,243 over the same day**, in two steps of 34, and both are
attributed rather than assumed: every file moved `unsupported -> strict-pass`,
nothing moved the other way, and all of them are in `expressions/class` and
`statements/class` -- exactly the family the four links below were opened for.
The second 34 are the `class/dstr` files, whose getter hands out a method with a
**destructuring parameter**: that gives the read an anonymous function type
nothing else names, and a type reaching HIR without a layout is *invalid HIR*
rather than a refusal.

Up from 1,132 when the population was widened and 1,167 the round before. All
three self-checks passed.

**The two numbers worth reading are the bottom two.** The same slice measured
earlier the same day had **6 crashes and 8 wrong answers**; five of the eight
and all six crashes were closed, and the rest are named below. A run of this
went 1,179 in between, which was *higher* and less true: the harness was
comparing with `!==`, so every NaN assertion failed and every ±0 assertion
passed regardless of the answer. Fixing it cost five apparent passes and bought
three real ones.

**The 839 that reach lowering, ranked by file** -- each row is one file's *first*
refusal, so this is the chokepoint table rather than a diagnostic census. The
names are redacted to `X` in the rows, so the four largest were re-run
unredacted against a sample of their own files:

| files | refusal | what it really is |
| --- | --- | --- |
| 155 | `X`, a builtin this compiler does not provide | **85% `eval`** (22 of 26 sampled), with `Function` and `Object` behind it. A §13 non-goal, not a gap -- it should be classified `inapplicable` rather than sitting at the top of a backlog. |
| 96 | a method `X` with no declaration in the hierarchy | dispatch through a library interface, and generator-as-a-value. See `typescript.md`'s iteration-family section. |
| 88 | `X`, a static field this compiler gave no storage | every one sampled is `#method` -- a **private static method read as a value**. |
| 87 | `X`, declared by `X` with a type that has no representation (a function type) | the same cause, one modifier over: `return this.#method` on an instance. |
| 38 | a regular expression literal | needs an engine; `docs/` records QuickJS as the answer. |
| ~~176~~ 0 | a generator that yields nothing | **Cleared 2026-09-20: 125 of the 176 now pass.** It was the largest actionable row and the description of it here was half wrong — `expressions/class` and `statements/class` are 78 files each and `expressions/object` another 18, so it is not one matrix, and `*['constructor']() {}` is the smallest program showing it. `function* g() {}` is ordinary JavaScript: it returns an iterator that is immediately done. The refactor this row said was needed is what it took, and the count was right — **four** derivations, not three: whether `Generator<T>` represents at all, the concrete frame's slot, the read out of the frame, and the abstract `Generator<…>` a frame extends, plus the `IteratorResult` layout whose `value` receives what the slot holds. `suspend::yielded_slot` is the one rule and all five ask it. The 51 that remain publish the blocker behind them: **40** a generator method used as a value, 7 an array literal with a hole, 4 an absent member. |
| 36 | an array literal with a hole in it | `[,]`, `[1, , 3]`. A hole reads as `undefined`, which a dense array of numbers has no room for, so this is the same representation question as sparse growth. |

**88 and 87 are one cause, and it is 175 files: a method used as a value.**
*(Opened 2026-09-19, in four links -- a method used as a value, calling the
result of a getter, `g.next()` on a generator held rather than walked, and the
getter's own function type needing a layout. **68 files cleared**, 34 at each of
the last two. What is left is 36 `private-gen-meth-*`, refused by name: a
generator's frame type is synthetic and per-declaration while the call site sees
the abstract `Generator<…>` a wrapping closure is declared with, and without the
refusal the emitted C does not compile. Each link revealed the next, which is
what "the compiler reports one blocker at a time" looks like from outside.)*
Probed down to the smallest program, a *public* method refuses the same way --

```ts
class C { twice(n: number): number { return n * 2; } }
const g = new C().twice;   // refused
```

-- so the private modifier and the `static` modifier are both incidental, and
the feature is a bound-method closure: a function value carrying the receiver
alongside the code. That is one piece of work for both rows and for a good part
of the 96 above it, which is worth knowing before anyone starts at the top of
the table.

### The eight that ran and answered wrongly

Six of the crashes and four of the throws were **sparse fills** --
`var exponents = []; exponents[3] = …` -- reached because a module-scope
untyped array had just begun taking the type its writes settled. Growth is by
one, so the first write aborted. Guarded the same day: a refusal replaced by an
abort is a worse answer, and `written_as_a_dense_prefix` is the guard.

Of what is left:

- `applying-the-exp-operator_A4.js` -- **`1 ** NaN` answered 1**. C99 makes
  `pow(+1, y)` return 1 for any `y`, even a NaN, and the specification says NaN
  before it looks at the base. Fixed; `examples/math` carries the arm.
- `less-than/S11.8.1_A4.12_T1.js` and `greater-than/S11.8.2_A4.12_T1.js` -- a
  matched pair, and both reduce to **lone surrogates**: `"\uD800" < "\uDC00"`.
  Every other case in both files agrees. This is the UTF-16 representation
  question `docs/icu-i18n.md` covers, not a comparison bug.
- `in/S8.12.6_A2_T1.js` -- `"valueOf" in {}`, where the receiver is an
  *unannotated* empty object literal. `typescript.md` carries why that one shape
  is excluded and what it would take.

**Three remain**, and they are the last two of those plus the `in` receiver --
the lone-surrogate pair and `"valueOf" in {}`. Both are recorded decisions with
a named next step rather than unexplained wrong answers, which is the state this
column is meant to reach. Nothing crashes.

The harness fix also exposed three files nobody could have seen: `-0` handed to
an erased slot came back `+0`, because `zero_sign::observed` did not look
through an `Erase` and `width_of` judged an arithmetic result by its operands
alone. `typescript.md`'s `negative-zero` row carries it. Those three were
**reported as passes** for as long as the census has existed.



### 1,575 of 4,812, and a day measured end to end

Measured 2026-09-20, compiler pinned at `b260a52c`, over all of `test/language`,
slice 1. **1,569 → 1,575**: six improved, **none regressed**. Four
`statements/variable` from the module-global slot, one `statements/for`, and
`statementList/class-block.js` — the file the last census lost to a `cc`
internal compiler error, back on its own, which is what "transient" looks like
when the message is kept.

The day, each step diffed per file against the one before it:

| | |
| --- | ---: |
| start | 1,534 |
| anonymous-class statics | 1,539 |
| `never[]` literals | 1,548 |
| parentheses, `void 0`, `throw` | 1,558 |
| `in`, `hasOwnProperty`, unwritten names | 1,569 |
| `null` slots, bigint globals, module globals | **1,575** |

**+41, and the more useful number is 0 regressions across six censuses.** Two
changes were backed out before they landed — a comparison that read `void` as an
erasable absence, and a tuple position that gave a literal a layout to prefer —
and both were caught by an arm nobody wrote for them: four examples in the gate
corpus, and a control added only because the previous revert had taught the
lesson.

#### What the instruments learned, which outlasts the count

Three refusal channels stopped lying this day, and each was found by a defect it
had mis-sorted rather than by review:

| channel | it said | it meant |
| --- | --- | --- |
| `storable` | "holding a reference" | neither a scalar nor a reference |
| census `link` | a compiler refusal | a `cc` timeout, or an ICE |
| `probe.sh` | `C DID NOT COMPILE` | a backend *decline*, or no compiler at all |

The first re-sorted five files into the fix they needed the moment it was
corrected. The second explained three censuses' worth of unreproducible rows.
The third would have turned one wrong `NTS_BIN` path into a confident, wrong
bracket — both arms "failing to compile" reads exactly like agreement.

### 1,569 of 4,812, and the third `link` row, named at last

Measured 2026-09-20, compiler pinned at `7f213b3b`, over all of `test/language`,
slice 1. **1,558 → 1,569**: twelve improved, across `statements/class`,
`block-scope/syntax`, `statements/let`, `for-in`, `for`, and both logical
operators.

One row moved to `link` — the **third** census in a row to report exactly one —
and this time it said what happened:

```
statementList/class-block.js   quickjs/dtoa.c:1353:8:
                               internal compiler error: Segmentation fault
```

`cc` segfaulted on a *runtime* source the program does not contain, in a census
sharing the machine with a gate. The file passes on its own, twice — and so did
the two before it, which is all anyone could say until the message was kept one
section ago.

So the classification gains a third outcome. A toolchain that crashes, is killed,
or runs out of memory is `infrastructure-error` — the bucket the runner already
has for "this run could not measure anything" — rather than `unsupported`, where
it reads as a refusal the compiler made. Five branches now separate:

| what happened | bucket |
| --- | --- |
| `SIGTERM` / `ETIMEDOUT` | `timeout/link` |
| ICE, `Killed`, out of memory | `infrastructure-error` |
| a `cc` error | `unsupported/link`, with the line |
| an `ld` undefined reference | `unsupported/link`, with the line |
| anything else | `unsupported/link` |

Three censuses spent one row each on this and two investigations ended in "does
not reproduce". The cost was never the compiler; it was a `catch {}`.

### 1,558 of 4,812, and the `link` row that was never a refusal

Measured 2026-09-20, compiler pinned at `edcad5e2`, over all of `test/language`,
slice 1. **1,548 → 1,558**: eleven improved — three each of `statements/const`,
`statements/let` and `statements/variable`, plus `expressions/grouping` and
`statements/class`.

One row moved to `link`, and it is the **second** census in three to report
exactly one such row, on a different file each time, and **neither reproduces** —
three runs apiece in isolation, all `strict-pass`. Both full runs overlapped a
gate.

#### A refusal and an unmeasurable run must not look alike

`run262.mjs` linked with a 180-second timeout and `catch {}`. So a row reading
`link` meant *either* "the toolchain refused this C" *or* "the toolchain did not
finish while a gate had the machine", with nothing to tell them apart and no
message kept. Two investigations ended in "does not reproduce", which is the
cost of the missing distinction rather than a fact about the compiler.

It now separates them — a `SIGTERM` or `ETIMEDOUT` is `timeout/link`, not
`unsupported/link` — and keeps the first line the toolchain said, with paths
stripped so the row ranks. `tooling/differential` already draws this line for its
own timeouts and says why: *"A refused construct and an unmeasurable one must not
look alike."* The census did not, one instrument over.

Both changes are of a kind with the `named` field two sections up: **record what
failed, not only that it did.** Three rows in this ledger have now been opened by
that one move.

### 1,548 of 4,812, and a claim that needed qualifying

Measured 2026-09-20, compiler pinned at `d3dcb637`, over all of `test/language`,
slice 1. **1,539 → 1,548: nine improved, none regressed.** Five
`statements/for-of`, three `statementList`, one `expressions/class`.

The `never[]` row is **gone — 15 to 0** — and nine passing out of fifteen is the
number that matters, because the other six moved to a different refusal and that
refutes half of the argument the fix was made on.

#### "Unobservable" was true of the program and false of the compiler

The fix reasons that an array literal the checker typed `never[]` can take any
element width, because no value of type `never` exists and so no program can read
an element out of one. That part holds. What does not is the step after it:

```js
for (const [[x] = [1]] of [[]]) {}    // a number where an array is wanted
for (const [{ q } = {}] of [[]]) {}   // a number where an object is wanted
```

The *lowering* carries the element type into a destructuring pattern's
expectations, and a pattern that wants a shape rejects a width. Six files refuse
that way now. It is a better refusal — it names what the pattern wanted instead
of the literal — and it is still a refusal, and the sentence "the element width
is unobservable" had to be narrowed in both the compiler and the example to say
which observer.

What would close those six: take the element type from the pattern's own
**default**, which over an empty array is the only thing that ever runs.

The seventh advanced to *a conditional of unrepresentable type (any)*, which is
the `any` question and not this one.

### 1,539 of 4,812, and the row that was 95% a non-goal

Measured 2026-09-20, compiler pinned at `23666c14`, over all of
`test/language`, slice 1. **1,534 → 1,539**: six improved, all the
`static #x` files that the anonymous-class row was holding, and one regressed to
a `link` failure that does not reproduce on the current binary — recorded as
unexplained rather than attributed, in a run that overlapped three full gates.

Two corrections to the previous section while they are cheap. The 18
`frontend-crash` files are **not new**: census 12 had the same 18, all
`import defer`, and a summary that said "crashes at zero" was reading the
headline rather than the rows. And the `never[]` row below was fixed *after* this
census pinned its compiler, so its 15 are already gone — `pinCompiler` copies the
binary at start, which is what makes a census reproducible and what makes its
number one commit old the moment a fix lands.

#### The redaction that makes a row rankable deletes what it contains

`run262.mjs` replaces quoted identifiers with `X` so that a hundred files naming
a hundred names rank as one shape. Correct for ranking, and it took the content
out of the largest row: **147 files of ``\`X\`, a builtin this compiler does not
provide``**, where *which* builtin is the entire row. Recording the names beside
the shape answers it in one line:

| files | builtin |
| ---: | --- |
| 140 | `eval` |
| 4 | `Function` |
| 2 | `Object` |
| 2 | `RegExp` |

So the biggest actionable row was never actionable: 140 of 147 are `eval`, a
declared non-goal, and the whole row is worth eight files. Ranking by reach put
it first for two censuses.

With the non-goals taken out by *name* rather than by message — `eval`, `RegExp`,
boxed primitives, `any` — the 504 lowering refusals are **280 non-goal and 224
actionable**.

Those two numbers were first published as 191 and 313, and the correction is the
same lesson one turn later: the first pass filtered non-goals by *message text*,
which does not match `a `new` of unrepresentable type (`Boolean`)`. 28 files of
`new Boolean`, `new Number`, `new String` and `new Object` sat in the actionable
column until the filter asked `named` instead. **A filter over redacted text is
the same mistake as a ranking over redacted text**, and both were made here
within an hour.

Ranked, after the correction:

| files | first refusal |
| ---: | --- |
| files | first refusal | what it actually is |
| ---: | --- | --- |
| 36 | a parameter of unrepresentable type | **all 36 are `Iterable`** |
| ~~15~~ | an empty array literal in a position that does not say what it holds | closed after this census pinned its compiler |
| 13 | a conversion to string from unknown | a decision, not a gap — see below |
| 12 | `X` or `X` where what it stands in for is not a reference | all 12 are `null` / `undefined` |
| 11 | `X`, where an array has only `X` | 7 `toString`, 4 `constructor` — prototype identity |
| 10 | a module-scope variable of unrepresentable type | |
| 9 | a declaration without an initializer | `{ { var f; } var f }` |
| 9 | a value called as a function, where the type does not say which function | |
| 9 | an array literal of unrepresentable type (an untyped node) | |
| 8 | a shorthand in an assignment pattern, whose name resolves to the property | |

#### What the three biggest rows are, measured rather than ranked

**All 36 of the top row are `Iterable`**, and the boundary is one token wide:

```ts
function g([...rest]: number[]) {}   // lowers
function g([...rest]) {}             // `a parameter of unrepresentable type (Iterable)`
```

An unannotated destructuring parameter with a rest element is typed `Iterable<T>`
by the checker, and test262 is JavaScript, so none of the 36 carries an
annotation. This is not a missing case: an `Iterable` parameter must accept an
array *and* a generator, and this compiler represents an array as `NtsArray *`
rather than as an object with methods, so it is a question about representing a
union of representations. `specialize.rs` is not the lever — it chooses integer
widths and says plainly that signatures are not specialised.

**The 13 `unknown`-to-string files are a decision with its reason written down.**
`as_string` converts an erased value through `nts_value_to_string`, which spells
six tags exactly and `abort()`s on the seventh; the seventh is an object, which
needs `toString` off a prototype chain that a tag cannot resolve. `spells_itself`
is the predicate that keeps the refusal honest — a union of scalars and absences
converts, one that can hold an object does not. Closing it means giving the
*runtime* a way to reach a class's `toString` from an erased value.

**The 11 array-member files want prototype identity**, not a member:
`array.toString !== Array.prototype.toString` and `array.constructor === Array`.
Both need `Array` and its prototype as comparable values, which is a different
feature from the member access the message names.

#### A negative result worth keeping: the `_value` family clears nothing here

`lower_array_method` refuses eight array methods on an array of erased elements
and names the missing runtime family precisely — `push`, `slice`, `reverse`,
`join`, `splice`, `fill`, `index_of`, `includes`, beside five `_value` helpers
that do exist. It is a four-site change with two siblings to copy from, and the
comment beside it counts 27 of 29 sites in the **node profile**.

In this population it blocks **zero files**. Measured before building it, which
is the only reason it was not built: `[,,,].toString()` reaches it, and the
test262 file that looked like it needed it is blocked on `Array.prototype.toString`
one step earlier. A named work item in one corpus can be worth nothing in
another, and the message is identical in both.

### 1,534 of 4,812, and what is left after the non-goals

Measured 2026-09-20, compiler pinned at `22bbf635`, over all of
`test/language`, slice 1.

The progression over one night, each figure from a run whose three self-checks
held: **1,167 → 1,253 → 1,378 → 1,458 → 1,506 → 1,534**. Every step was diffed
against the run before it, per file rather than by headline — which is how the
one regression of the night was found: a change that gated green took 1,506 to
1,502, four files that read a `for` head's `var` after the loop, and nothing in
the gate could have said so. See "the gate is a floor" below.

`an emitter refusal` and `a link failure` both read 0. The first was 7, and
those seven were not a gap: the verifier was checking stores that **no block
executes**, which dead-code elimination leaves in `Func::values` while every
pass that repairs a type walks `block.ops`. `emit-c` wrote nothing and exited 0
for all seven.

| | files | |
| --- | ---: | --- |
| selected | 4,812 | |
| `strict-pass` | **1,534** | compiled **and ran**, agreeing with the expectation |
| `unsupported` | 3,257 | refused, by TypeScript or by lowering |
| `threw` | 3 | ran and threw — the wrong-answer column |
| `frontend-crash` | 18 | a `tsgo` panic; **closed 2026-09-20** --- see the correction above |

Of the refusals:

| | files | |
| --- | ---: | --- |
| a TypeScript error | 2,747 | before lowering is reached |
| a lowering refusal | 510 | **this is the census** |
| an emitter refusal | 0 | |
| a link failure | 0 | |

#### The ranked list is not a work list until the non-goals come out of it

| | files | |
| --- | ---: | --- |
| a builtin — 138 of them `eval` | 147 | |
| a regular-expression literal | 39 | |
| `new Boolean` / `Number` / `String` | 28 | |
| `any`, and `unknown` conversions | 74 | |
| **everything else** | **222** | the actionable list |

`eval` is the largest single row in the census and will never be built: an
ahead-of-time compiler has no answer for dynamic code. Boxed primitives need
`ToPrimitive`, which this compiler does not have and has refused to
approximate everywhere else it comes up. A regular-expression literal needs an
engine, and `quickjs` is the recorded answer rather than a Rust crate.

**`any` is not in that company.** `docs/any-unknown.md` is explicit that it is
*not started* rather than declined — `NeedsRepresentation` is the named design
and has no occurrences in the compiler. It is counted apart here because it is
one piece of work rather than a list of gaps, not because nobody will do it.

Top of what is left:

| files | first refusal |
| ---: | --- |
| 36 | a parameter of unrepresentable type (`X`) |
| 16 | a module-scope variable of unrepresentable type (`X`) |
| 15 | an empty array literal in a position that does not say what it holds |
| 12 | `X` or `X` where what it stands in for is not a reference |
| 11 | `X`, where an array has only `X` |
| 9 | a declaration without an initializer |
| 9 | `X`, a value of type `X` called as a function, where the type does not say which function it is |
| 9 | an array literal of unrepresentable type (an untyped node) |
| 8 | a shorthand in an assignment pattern, whose name resolves to the property |
| 7 | a static field of an anonymous class |
| 6 | a method `X` with no declaration in the hierarchy |
| 6 | a `X` declaration, whose scope-exit disposal |

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

**1,534 of 4,812 as of 2026-09-20**, up from 1,167 the day before; 510 lowering
refusals, of which **222 are actionable** once `eval`, boxed primitives, regular
expressions and `any` are taken out. The section above carries the numbers so a
stale claim here is a diff rather than a re-reading.

### The gate is a floor, not a comparison

`backend_examples` asserts *"at least N examples agree with node"*. Raising the
floor proves the corpus grew; it cannot prove that nothing already in it moved,
and it says nothing at all about programs outside `examples/`. The `blockers`
step asserts refusals are *present*, which a new **over**-refusal satisfies. So
a working program that starts refusing trips neither — unless an example
happens to write exactly that shape.

On 2026-09-20 one did not, and a gated-green commit cost four files. What found
it was this census, diffed row by row against the previous run. **That diff is
the only instrument in the repository that compares against a previous state
rather than a floor**, and it belongs after any change to scoping or
representation:

```sh
node tooling/census/run262.mjs --nts target/release/nts \
  --selection selection.jsonl --slice1 --rows rows-new.jsonl
# then: old bucket == strict-pass && new bucket != strict-pass
```

A headline moving by four reads as noise. The per-file diff names them.

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
against three controls. (That gap closed on 2026-09-20 and the 7 are expected
back on the next census. The account is kept in the past tense it was written
in, because what it records is how an instrument's first run was refuted, and
that reading is what the row is here to preserve.)

So the check now prints **what the files refuse with** beside the flag, because
that single line is what refutes it. It is a pointer to something worth reading,
not a verdict: the compiler reports one blocker at a time, so a refusal in a
file declaring feature A very often names feature B.

## Census 19 — what the crash fixes cost and bought

Run 2026-09-20/21 over the same 4,812 slice-1 files, diffed **per file** against
census 18 rather than against its headline. The compiler moved by the closure
globals and the two tsgo crash fixes; the spread and enumeration work landed
after this run pinned its binary and is not in it.

```text
                        18       19
  strict-pass         1577     1576     (-1)
  frontend-crash        18        0    (-18)
  unsupported         3214     3232    (+18)
  infrastructure-error   0        1     (+1)

  gained 0    regressed 1
```

**The bucket that emptied is the result.** All 18 crashes were
`import.defer(...)`, and they are now TypeScript errors (`TS18060`, and a second
diagnostic for a fixture module that does not resolve). None of them passes, and
none was ever going to: the point is that a compile of an unrelated file no
longer ends with a Go stack trace and no diagnostic. The `+18` in `unsupported`
is exactly that bucket moving, which is why the two numbers match.

**The one regression is the instrument, and it says so.** The single file that
moved is `identifiers/part-unicode-7.0.0-escaped.js`, and it moved to
`infrastructure-error` — the bucket added on 2026-09-20 to separate a harness
failure from a compiler one. Compiled directly it is clean and instant on *both*
binaries, so what it recorded is contention: this census ran alongside a full
gate and several hundred probe compilations. Without that bucket it would have
landed in `threw` and read as a correctness regression.

**Zero gained, and that was predicted rather than excused.** The closure-global
work was filed against a row of 5 files; all 5 are still `unsupported`, the one
in this slice now stopping on something else. A row's size is what it would
clear *if nothing stood behind it*, and the compiler reports one blocker at a
time.

A third of what is left is out of reach by design: **148 of the 467
non-TypeScript refusals are `eval`**, against 39 for regular-expression literals
and 32 for `Iterable` as a parameter.

### The shorthand assignment row, closed 2026-09-21

`({ x } = p)` was **10 files** of the slice-1 population, refused as *"a
shorthand in an assignment pattern, whose name resolves to the property"*. The
refusal named a real hazard --- the symbol on that node is the property's, so a
store through it lands where nothing reads --- and treated the remedy as
unavailable, needing `getShorthandAssignmentValueSymbol` from the frontend.

It was available. The object *literal* path resolves the identical node by name
with `shorthand_value_symbol`: local first because a local shadows, and a
refusal when two bindings of the name are in scope rather than a coin toss that
compiles. The assignment path asks the same question, so it now calls the same
function, and `place_of`'s tail was split into `place_for_symbol` so "where does
this name write" has one derivation reached two ways.

Whether those 10 now pass is the next census and is not claimed here --- the
compiler reports one blocker at a time, and the previous row of 5 taught that
lesson the expensive way.

### Boxed primitives: 30 files, declined on purpose

`new Boolean(true)`, `new Number(1)`, `new String("x")` --- 30 files of the
slice, concentrated in the coercion suites (`bitwise-not`,
`greater-than-or-equal`, and their neighbours). Every one of them uses the
wrapper only in a position that immediately coerces it back:

```js
if (~new Boolean(true) !== -2) { … }
```

**The cheap version is a wrong answer.** Lowering `new Boolean(v)` to `v` makes
all 30 pass and makes `typeof new Boolean(true)` answer `"boolean"` where the
language says `"object"`, and `new Boolean(false)` truthy-test as false where an
object is always truthy. That is trading a measurable number for an unmeasurable
defect, in a profile whose whole argument is that the compiled answer is the
same answer.

The honest version is a wrapper object plus `ToPrimitive` dispatching through
`valueOf` --- representation work for three constructs that exist for
specification coverage and are absent from real code. It is not on the
work-list, and this row says so rather than reading as an oversight each time
the census is ranked.

### The method-arity family, swept 2026-09-21

Every array and string method that takes an optional extra argument **refuses**
rather than ignoring it, which is the direction that matters --- none of these
is a wrong answer:

```text
  "abcabc".lastIndexOf("a", 2)     a string method with this many arguments
  [1,2,1].indexOf(1, 1)            an array method with this many arguments
  [1,2,1].lastIndexOf(1, 1)        "
  [1,2,3].includes(1, 1)           "
  [1,4].splice(1, 0, 2, 3)         "
  [1,2,3].fill(0, 1)               "
```

The mechanism is one table: `numeric_array_method` and its string twin answer
`(helper, arity, type)`, missing arguments are padded with `Infinity`, and a
count the helper cannot take is refused. So each of these is a runtime
signature, not a lowering gap.

Two are cheaper than the rest and worth knowing. `indexOf` with a position
already works --- `nts_str_index_of_from` exists and the table routes two
arguments to it --- and `includes(s, pos)` is `index_of_from(...) !== -1`, so it
needs a comparison after the call rather than a new helper. The others need a
helper each, on C, LLVM and the JVM, which is what makes this a sitting's work
rather than a line.

Census value is approximately zero --- `test/language` does not exercise these
--- so the reason to do it is the node lanes, not this file.

## Census 20 — 1,576 to 1,590, and every file attributed

Same 4,812 slice-1 files, diffed per file against census 19.

```text
                        19       20
  strict-pass         1576     1590    (+14)
  unsupported         3232     3219    (-13)
  infrastructure-error   1        0     (-1)

  gained 14    regressed 0
```

**Thirteen of the fourteen are real and each is attributed to a row.**

- **9** in `statements/for/dstr/*-ary-ptrn-elem-*`: `const [x = 23] = []`, a
  destructuring default over an empty array **inside a function**. The local
  declaration path intercepted an empty literal before `lower_array_literal`
  could reach it and demanded an annotation, so the stand-in that already
  answered at module scope was never asked. All three keyword spellings ---
  `const`, `let`, `var` --- moved together, which is what says the fix is the
  path and not the construct.
- **4** in `statements/for-of/dstr/`: `for ({ x } of …)` and `for ([{ x }] of …)`,
  the shorthand in an assignment pattern, resolved by the same
  `shorthand_value_symbol` the object-literal path has always used.

The fourteenth is `identifiers/part-unicode-7.0.0-escaped.js`, which census 19
recorded as `infrastructure-error` under load and which compiles clean and
instant on every binary. **Not a gain**, and counting it as one would be the
instrument reporting on its own contention.

**The shorthand row was priced at 10 and 4 moved.** That is the same lesson the
closure row taught at 5-and-0: a row's size is what it would clear if nothing
stood behind it, and the compiler reports one blocker at a time. The remaining
six now stop on something else, which the next census will name.

One caveat, stated because the numbers cannot show it: this census pinned its
binary at `cb3d6afe`, which carried a regression corrected an hour later --- an
empty-literal fall-through that also caught bare identifiers and emitted
uncompilable C for `const xs = []; xs.push("a")`. It cannot have produced these
gains: all nine `for/dstr` files are *patterns*, which the correction kept, and
six of the fourteen were re-run against the corrected binary and still pass.

### What the shorthand row cleared into, 2026-09-21

Ten files refused as *"a shorthand in an assignment pattern"*. Four passed once
the one-child form worked; six moved to *"a shorthand property of unexpected
shape"*, which is the `({ x = 1 } = o)` spelling; one of those passed once the
three-child node shape was matched. The remaining five stop on **three
different** things, none of them shorthand:

```text
  obj-id-init-assignment-missing   destructuring something with no fields
  obj-id-init-in                   destructuring something with no fields
  obj-id-init-order                destructuring something with no fields
  obj-id-init-assignment-undef     a conditional of unrepresentable type
  obj-id-init-evaluation           `x`, which `an anonymous type` does not declare
```

That is one row of ten becoming five passes and three new rows, which is what a
work-list looks like from underneath and why a row's size is never a forecast.

**The `no fields` three are `for ({ x = 1 } of [{}])`** --- a bare `{}` as the
source. Probed in four spellings, and the split is *not* where it looks:

```text
  ({ x = 1 } = {} as { x?: number })   works
  ({ x = 1 } = {})                     works
  const { y = 2 } = {} as { y?: number }   works
  const { y = 2 } = {}                 REFUSED
```

So it is not assignment-versus-binding and not the default. `pattern_element_read`
and `read_for_pattern` have the *same* structure and the same refusal, which
means what differs is the type the checker gives the `{}` --- contextual in
three of the four spellings and the bare `{}` type in the fourth. The next step
is `nts types` on the two binding spellings, not a change to either walk.
