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
