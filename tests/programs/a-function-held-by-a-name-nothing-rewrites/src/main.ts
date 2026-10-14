// `let step = (n: number) => n + 1` at module scope, which was refused as *"a
// module-scope `let` holding a function, which may be reassigned with a closure
// of another layout"*.
//
// The refusal is right about the thing it names. A global's slot has one type,
// a closure's type **is its captures**, so `let f = a; f = b` wants two layouts
// in one slot -- and that arrived as clang declining to assign an
// `NtsObj_Closure0 *` to an `NtsObj_Fn2 *`, well past the point anything could
// say why.
//
// It was also refusing the case where there is no second closure. `may be
// reassigned` was read off the **keyword**, and the keyword is not the
// question: a `let` that nothing ever writes again holds exactly the object its
// initializer built, which is the same one-layout slot a `const` gets. So
// `closure_typed_global` asks the program instead, and `const` is no longer a
// special case so much as the case that is always trivially true.
//
// # Why the walk goes upwards
//
// There was a walk for this already -- `assigned_symbols`, which takes an
// assignment and reports the names it writes -- and reusing it would have been
// wrong in the expensive direction. It reports a **bare identifier** only, by
// design, because writing through `box.cell` leaves `box` alone. So
//
//     [step] = [other];
//
// writes `step` through an array literal, and that walk reports nothing
// written. Widening a slot the program does reassign is the one outcome worse
// than the refusal, so this starts from each *reference* and walks up to ask
// whether it stands on a target side -- which covers destructuring at any depth
// without enumerating its shapes, and treats anything it does not recognise as
// a write.
//
// # And a `function` expression is the same closure
//
// `const e = function () { ... }` was refused too, for no reason that survived
// being looked at: one that mentions no `this` **is already a closure** --
// `is_closure` has said so since the refusal for it was removed -- so the
// layout existed and only the gate's `ARROW_FUNCTION` test stood in the way.
// Admitting it needs no second `this` test either, because the gate looks the
// node up in the closure table and a `this`-binding form was never put there.
//
// The arms below are the ones that now compile. Those that must still be
// refused are `blockers/a-function-held-by-a-name-that-is-rewritten`, including
// the destructured write -- the case that would have passed had this been built
// on `assigned_symbols`.

let step = (n: number): number => n + 1;

const offset = 10;
let shifted = (n: number): number => n + offset;

// A `const` arrow, unchanged by any of this and here to stay that way.
const doubled = (n: number): number => n * 2;

// The `function` spelling of the same thing, in both keywords.
const halved = function (n: number): number {
  return n / 2;
};
let negated = function (n: number): number {
  return -n;
};

// Read, passed and called -- none of which is a write, and each of which the
// upward walk has to keep saying so about.
function applyTwice(f: (n: number) => number, n: number): number {
  return f(f(n));
}

export function stepOnce(n: number): number {
  return step(n);
}

export function shiftedBy(n: number): number {
  return shifted(n);
}

export function throughACall(n: number): number {
  return applyTwice(step, n);
}

export function alongsideAConst(n: number): number {
  return doubled(step(n));
}

export function throughAFunctionExpression(n: number): number {
  return halved(negated(n));
}
