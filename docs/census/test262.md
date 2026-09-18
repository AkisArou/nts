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

**Reading a name before it is bound** is the temporal dead zone, and the ledger
already has a ✅ row for it (line 619) — which says, in its own words, that
*"no example and no blocker fixture mentions NTS1004, so this refusal is
asserted and not exercised"*. These 36 files are the first thing that exercises
it. **Which direction they point is undetermined**: slice 1 excludes negative
tests, so a positive test should not legitimately read a name before binding,
which makes an over-eager refusal the more likely reading — but that has not
been established and is not claimed here.

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

## What this census cannot see

Printed by the instrument on every run, not left to a reader.

1. **Nothing is executed.** `lowers` is not `correct`.
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
