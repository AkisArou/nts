// expect: a `WithBase` where a `Slice` is wanted, which is a pointer cast
//         between two structs that do not agree about where their shared
//         fields are
//
// **Specialisation covers one of the five ways a value reaches an interface
// type, and the other four are the same refusal.**
//
// `record_structural_call` makes a copy of a callee per concrete argument type,
// which is why `asArgument` below lowers: `read@0obj<WithBase>` reads `b`
// through `WithBase`'s layout and no cast happens. Every other route to the
// same interface refuses, and they are all `coerce` being asked for a pointer
// cast the layouts do not support:
//
// ```text
// read(new WithBase())                     a call argument      LOWERS
// const s: Slice = new WithBase()          an annotated local   refuses
// function make(): Slice { return … }      a declared return    refuses
// this.slice = new WithBase()              a field at the type  refuses
// let s: Slice = …; s = new WithBase()     a later assignment   refuses
// ```
//
// Measured 2026-09-23 on `6943bcff`. The point of the table is that the four
// are not four defects: a copy re-types a **parameter**, so the one route that
// passes through a parameter is the one that works, and the machinery has
// nothing to say about a slot, a return, or a variable.
//
// A join of two *different* classes is a sixth thing and not in the table: it
// erases before it reaches here, and refuses as `an erased value where a
// concrete representation is wanted`. Written with one class on both arms it is
// arm 2 again, which is why the fifth arm is a reassignment instead -- a `let`
// has to hold its declared type across the branch, where a `const` has its
// initialiser in hand.
//
// ## Why no field order fixes this one
//
// `WithBase extends Base`, so slot 0 is owed to `Base` -- that is what
// base-first layout means and `put_bases_first` enforces it. `Slice` wants `b`
// at slot 0. One object has one linear layout and here two prefixes are
// claimed, so **no ordering convention reaches this case**, whatever it does
// for the option-bag families that share the diagnostic.
//
// Remove `extends Base` and it lowers, which is the control: `NoBase` holds
// exactly `b`, `Slice` is its prefix, and the cast is the no-op the refusal
// exists to protect.
//
// ## Where this sits in the corpus
//
// `a pointer cast between two structs …` is the largest cause on the compiled
// axis, 77 distinct sites over 25 `runtime/node` modules. `6943bcff` split the
// one sentence into the three facts it was covering; counted on `split2`:
//
//     the target declares more fields than the source holds     18 sites
//     the target names a field the source has no slot for       37 sites
//     every field is there and the order is wrong               23 sites
//
// (one site reports two of them.) So **55 of 77 are an absence** -- there is
// nothing at any offset to read -- and only 23 are an ordering question. This
// fixture is in the 23 and is still not orderable, for the reason above; the
// rest of that column is option bags, where `interface Wide extends Narrow`
// lists its own members before its inherited ones and the supertype is
// therefore not a prefix of the subtype.
//
// Related: `blockers/a-method-through-a-structural-interface` is the same
// question asked about *methods* and carries the reverted experiment that
// inferred `implements` edges; `blockers/an-options-bag-widened-by-assignment`
// is the widening column.

interface Slice {
  b: number;
}

class Base {
  a: number = 1;
}

/** Slot 0 is owed to `Base`, so `Slice`'s `b` cannot lead. */
class WithBase extends Base {
  b: number = 2;
}

/** The control: nothing owns slot 0, so `Slice` is already its prefix. */
class NoBase {
  b: number = 2;
}

function read(s: Slice): number {
  return s.b;
}

/** Lowers: the copy machinery re-types this parameter. */
export function asArgument(): number {
  return read(new WithBase()) + read(new NoBase());
}

/** Refuses. */
export function asAnnotatedLocal(): number {
  const s: Slice = new WithBase();
  return s.b;
}

function make(): Slice {
  return new WithBase();
}

/** Refuses, inside `make`. */
export function asReturn(): number {
  return make().b;
}

class Holder {
  slice: Slice;

  constructor(slice: Slice) {
    this.slice = slice;
  }
}

/** Refuses. */
export function asFieldStore(): number {
  return new Holder(new WithBase()).slice.b;
}

/** Refuses -- and only on the second assignment, `NoBase` being a prefix. */
export function asReassignment(which: boolean): number {
  let s: Slice = new NoBase();
  if (which) {
    s = new WithBase();
  }
  return s.b;
}
