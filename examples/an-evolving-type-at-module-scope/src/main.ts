// `var x;` with no annotation, at module scope.
//
// The declaration says nothing about the type. The checker fills it in from the
// assignments that follow — an *evolving* type — and every later mention of the
// name carries what it settled on. `evolved_type` reads one back, and the two
// sites in `lower_variable_statement` have asked it from the beginning.
//
// `collect_module_scope` asked `type_of` alone. So the same three lines were an
// ordinary local inside a function and refused one scope out:
//
//     var x;
//     x = -1;
//     x += -1;   // fine in a function, refused at module scope
//
// Two derivations of one question, and the narrower one was the module-scope
// half. That is the shape this repository keeps finding: not a rule that is
// wrong, but a rule asked in two places and only completed in one.
//
// # It ranked twice, under a name that was not its own
//
// 36 of the 413 files that reach lowering in the slice-1 test262 population are
// this, and they appeared in the ranked table as **`reading a name before it is
// bound`** — which is the *read* that follows the missing global, not the
// reason the global is missing. The census report named that row "the temporal
// dead zone" and pointed at a ✅ ledger row for it; it is neither. `NTS1004` is
// the dead-zone diagnostic, it is about cross-module evaluation order, and it
// never fires on a single-file program.
//
// The root — `a module-scope variable of unrepresentable type` — ranked 36 too,
// on the same 36 files. A table that ranks first-diagnostics counts one cause
// twice and names it wrongly both times.

// # What the control prints
//
// On the compiler before this fix, `nts check` over this file says
//
//     refused: NTS1001 a module-scope variable of unrepresentable type
//     refused: NTS1001 reading a name before it is bound
//     checked 1 cases across 1 function(s)
//     agreed on every case
//
// and exits 0. One case out of four, and the last line says agreement — the
// `annotated` control is the one that survived. Reading only the verdict is how
// a fixture that measures a quarter of itself passes for a whole one.
//
// # Why each value is read into an annotated constant
//
// An evolving type settles **in the flow**. Reading one from inside a function
// is `TS7005 Variable 'x' implicitly has an 'any' type` — the read has no flow
// relationship to the assignments, so TypeScript will not use what they
// settled on. The first version of this file exported `return counted;`
// directly and did not typecheck at all, on any compiler.
//
// So each value is read at module scope, where the flow analysis applies, into
// a constant with a written type. That is also what the test262 files do: they
// assert at module scope rather than wrapping the subject in a function.

// `+=` on an evolving number, which is what the compound-assignment tests are.
var counted;
counted = -1;
counted += -1;
const countedSettled: number = counted;

export function readCounted(): number {
  return countedSettled;
}

// `let` as well as `var`: the evolution is the checker's, not the kind's.
let scaled;
scaled = 5;
scaled = scaled * 2;
const scaledSettled: number = scaled;

export function readScaled(): number {
  return scaledSettled;
}

// A string, so the settled type is not always a number and the fixture is not
// quietly testing one representation.
var joined;
joined = "a";
joined += "b";
const joinedSettled: string = joined;

export function readJoined(): string {
  return joinedSettled;
}

// **The control.** An annotated declaration with no initializer has always
// worked: `type_of` answers at the declaration and `evolved_type` is never
// reached. It passes on the compiler that refused the three above, which is
// what makes it a control rather than a fourth copy of the finding.
var annotated: number;
annotated = 7;
annotated += 1;

export function readAnnotated(): number {
  return annotated;
}

// # The same question, one type further in: `var xs = []`
//
// An empty array literal is the evolving type's other half. The declaration
// types it `never[]` — *unsettled*, not wrong — and the element comes from the
// writes, exactly as a bare `var x` takes its type from the assignments above.
//
// `collect_module_scope` took `type_of` and stopped, and `type_of` answers
// `never[]`, which is a `Some` — so the `or_else(evolved_type)` beside it never
// ran and the global was declared to hold nothing. **26 files** of the slice-1
// `test/language` population are `var bases = []; bases[0] = …`.
//
// `is_an_unsettled_array` is the one place `never[]` is recognised, asked by
// three readers that each used to spell it themselves: the literal will not
// build one, `evolved_type` must not let one veto a settled sibling, and the
// module scope must not take one as a global's type.
//
// # And a second derivation, found by instrumenting rather than reading
//
// Settling the type was not enough, because `refused_initializers` lowers every
// module initializer a second time to decide which symbols to mark unsupported
// -- with a bare `lower_expression`, so with **no expectation**. The real
// lowering in `lower_module_binding` passes the global's type. The two
// disagreed: the probe refused the literal for want of a type the global
// already had, marked the symbol unsupported, and the lowering that knew better
// never ran. Both now read the same `module.types` entry.
//
// # What still refuses, and why it is not an oversight
//
// `var xs = []; xs[0] = "a"` stays refused. Those writes all grow the array --
// there is no slot 0 to write to -- and growth is not supported for a counted
// element: `rc.rs` pairs each store with a load of what the slot was holding,
// and at `index == length` there is nothing to load. Letting the type settle
// would build the literal and then **abort** at the first write, exit 134 with
// no diagnostic. `growth_can_fill` is that refusal, and a strings-by-index arm
// is deliberately absent below for the reason `an-array-grown-by-index` gives
// about its own sparse case.
//
// # And a sparse fill turns the refusal into an *abort*, which is worse
//
// `growth_can_fill` was not enough on its own, and the census is what said so:
// six `test/language` files went from `unsupported` to **SIGABRT** the first
// time a settled type reached them. `applying-the-exp-operator_A11.js` opens
//
//     var exponents = [];
//     exponents[3] = Infinity;
//     exponents[2] = 1.7976931348623157E308;
//     exponents[1] = 1;
//     exponents[0] = 0.000000000000001;
//
// — dense when it is finished and sparse at every step of the way. Growth is by
// *one*: `xs[3] = v` on an empty array wants three holes, a hole reads as
// `undefined`, and a dense array of numbers has no room for one, so the runtime
// aborts with no diagnostic. A refusal replaced by an abort is a worse answer,
// not a better one.
//
// `written_as_a_dense_prefix` is the second filter: every indexed write must be
// a constant, and each must be the next slot after the last. That is what the
// corpus writes, and every one of those writes is an append. A compound
// assignment is rejected outright rather than skipped — `xs[9] += 1` *reads*
// the slot before writing it, so it could never be the write that creates one.
//
// **The population that still aborts is untouched by this and was never
// refused**: an annotated `const xs: number[] = []; xs[3] = v` and the same
// inside a function both abort today and did before any of this, which
// `an-array-grown-by-index` records as the sparse half of its own row.
//
// **The guard is the element type, not the write**, so `var words = [];
// words.push("a")` stays refused as well -- a `push` needs no growth and would
// be safe. That is a refusal wider than its hazard, and it is deliberate for
// now: narrowing it means asking whether any write to the name goes through an
// index, which is a second question about the same symbol and worth having a
// reason to ask. Nothing regressed by it -- every untyped empty literal at
// module scope refused before this -- and an arm for it is left out rather than
// carried, because an example arm that refuses measures nothing.
//
// A `.length`-only program stays refused too: the checker widens an evolving
// array at an *element* read, so with nothing reading one there is no settled
// type to find. Asking the writes instead would be a second derivation of the
// element type competing with the checker's, which is the shape this file
// already carries a finding about.

var bases = [];
bases[0] = 11;
bases[1] = 22;
const firstBase: number = bases[0]!;
const secondBase: number = bases[1]!;
const baseCount: number = bases.length;

export function readBases(n: number): number {
  return baseCount * 1000 + firstBase * n + secondBase;
}

// Booleans, so the settled element is not always a number here either.
var flags = [];
flags[0] = true;
flags[1] = false;
const firstFlag: boolean = flags[0]!;
const flagCount: number = flags.length;

export function readFlags(n: number): number {
  return (firstFlag ? 1 : 0) * n + flagCount;
}

// **The control.** The annotated spelling, which lowered before any of this and
// must keep lowering unchanged -- it reaches the global's type at the
// declaration and never asks the writes.
var annotatedList: number[] = [];
annotatedList[0] = 3;
annotatedList[1] = 4;

export function readAnnotatedList(n: number): number {
  return annotatedList.length * 100 + annotatedList[1]! * n;
}
