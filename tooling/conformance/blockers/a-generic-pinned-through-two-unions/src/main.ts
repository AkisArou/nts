// expect: NTS1003 `direct` cannot be compiled because it calls `outer<f64>`
//
// **The copy's name is the assertion.** `outer<f64>` in that sentence is what
// this fixture is for: the union arm of `unify` used to answer `outer<erased>`
// here, and a `<erased>` copy is a wrong copy rather than a missing one.
//
// `outer(start)` with `start: number` unifies `(() => S) | S` against the type
// the checker resolved for the call, which is a **union too**:
// `(() => number) | number`. Unifying each generic member against the *whole*
// actual union bound the bare `S` member to that union, whose representation is
// `Erased`. One member bound, nothing disagreed, and `S = erased`.
//
// The rule is TypeScript's -- subtract, then pair. The members both sides hold
// identically are dropped; the members whose *kind* is unique on each side are
// paired, so `() => S` meets `() => number` and the signature arm binds
// `S = number`; and what is left is unified one-to-one. Never by position: union
// member order comes from the checker, so a positional pairing would bind `S` to
// whichever member came first.
//
// # What this fixture is still a blocker for
//
// `inner` gets no copy, and **it has no line of its own** -- every caller says
// "it calls `inner`, which was refused above" and there is nothing above.
// `uninstantiated` reports a generic with no copy only when it is *exported*; a
// non-exported one with nothing unpinned is silent, so the cause of this whole
// cascade is invisible. That is the third report of a hidden root in as many days
// and this is its smallest reproduction: four functions, no dispatcher, no
// function value, no nesting required (`direct` and `nested` fail alike).
//
// The reduction is the React lane's, from `useState<S>(initialState: (() => S) |
// S)` -- the shape of `useState`, `useReducer`, `useTransition` and
// `useActionState`.

class Box {
  v: unknown = null;
}

/** `S` is mentioned only inside a union, and nowhere in the return. */
function inner<S>(initial: (() => S) | S): number {
  const b = new Box();
  b.v = initial;
  return 1;
}

/** The same shape one call out, which is where the copy's name is decided. */
function outer<S>(initial: (() => S) | S): number {
  return inner(initial);
}

function render(component: () => number): number {
  return component();
}

/** **Control.** The same call inside a nested function passed as a value. */
export function nested(start: number): number {
  function Counter(): number {
    return outer(start);
  }
  return render(Counter);
}

/** The subject: a direct call, so nesting is ruled out as the cause. */
export function direct(start: number): number {
  return outer(start);
}
