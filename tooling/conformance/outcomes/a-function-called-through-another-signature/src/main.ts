// **FIXED by `519195e49` and kept as a guard.** `through another return type`
// answered `not an element` while `through its own signature` answered `box` --
// the same value read two ways, which is the whole of the defect in one line.
// The erased entry converts at the callee, so both now answer `box`. Recorded
// as `agrees`; the second arm was always the control and is why this fixture
// could say what was wrong rather than only that something was.
//
// **A function carried as `unknown` and called back through a signature whose
// return representation differs reads the result wrong.** `Counter` returns a
// pointer to an `Elem`; called through `(props, secondArg) => unknown` the result is
// read as a tagged value, so `out instanceof Elem` is false and nts answers "not an
// element" where node answers "box".
//
// **Arity is not the variable**, which the React lane established with a second
// probe: the same function called at a *different arity* with a matching return
// representation is correct on C -- extra arguments are harmless there. So what a
// fix has to convert is the result, and the parameter direction is untested.
//
// JavaScript makes such a call legal and meaningful: extra arguments are ignored,
// missing ones are `undefined`, and the result is a value. So this cannot be closed
// by refusing the cast -- that would refuse every component call in a compiled
// React, where `fiber.type` holds the component as `unknown` and `renderWithHooks`
// calls it as `(props, secondArg) => unknown`. What it needs is a conversion: either
// the erasure boxes the function into a uniform-signature thunk, or the call through
// another signature converts the result.
//
// It is also the counterexample to a design I had written down: that a checked
// unerase should *exempt* function types, because a check can establish
// closure-ness and never the signature, so exempting them "loses nothing a check
// would have caught". This is what it loses.
//
// The control is the same value called through the signature it was written at, in
// the same program.
class Elem {
  name: string;

  constructor(name: string) {
    this.name = name;
  }
}

function Counter(_props: unknown, _secondArg: unknown): Elem {
  return new Elem("box");
}

function throughAnotherReturn(): string {
  const type: unknown = Counter;
  const render = type as (props: unknown, secondArg: unknown) => unknown;
  const out = render(null, null);
  return out instanceof Elem ? out.name : "not an element";
}

function throughItsOwnSignature(): string {
  const type: unknown = Counter;
  const render = type as (props: unknown, secondArg: unknown) => Elem;
  return render(null, null).name;
}

observe("through another return type", throughAnotherReturn());
observe("through its own signature", throughItsOwnSignature());
done();
