// A generic whose type parameter is mentioned **only inside a union**, pinned by
// the call.
//
// `unify` had arms for a type parameter, an array's element, a same-generic
// instantiation's arguments, and a signature's parameters and result -- and none
// for a union. So `f<S>(v: S | null)` called with a `Tagged` bound nothing and the
// declaration refused as "a generic function no call pins down".
//
// **Every arm here keeps `S` out of the return type, and that is the whole trick
// of the fixture.** A generic that mentions `S` in its return pins from *there*
// through the arm that already existed, so the obvious spelling --
// `orDefault<S>(v: S | null, fallback: S): S` -- compiles on both binaries and
// measures nothing. Written that way first; the control caught it.
//
// React's hooks are the shape that found it: `useState<S>(initialState: (() => S)
// | S)`, with `mountState`, `mountStateImpl`, `updateState`, `updateReducer`,
// `dispatchSetStateInternal` and `useStateThroughDispatcher` refusing behind it.
// Four of those seven instantiate on this change, measured on that lane's probe.
// The three that remain mention `S` only in a **tuple** return, which `unify` has
// no arm for either -- the same defect one type constructor over, and the next
// thing to do.
//
// # The rule is agreement, not first match
//
// Each member is unified against the argument on its own copy, and a binding is
// taken only where the members that produce one agree. `(() => S) | S` against a
// `Tagged` is one answer: the function member binds nothing and the bare member
// binds `S = Tagged`. The same union against a *function* is two answers -- `S`
// through the signature's return, and `S` = the whole function through the bare
// member -- which disagree, so nothing is bound and the call stays unpinned
// exactly as it was. A wrong binding names a copy the call does not make, which is
// worse than a missing one; `unify`'s comment about instantiation arguments says
// the same thing about a different descent.
//
// **No arm here reaches that branch, and it is written down rather than assumed.**
// An arm was written for it -- `ambiguous<S>(value: (() => S) | S)` called with an
// arrow -- and it *compiled*, so it asserted nothing: by the time `unify` sees the
// call, the checker has resolved the signature, and both members' bindings agree.
// The branch stays because it is the conservative answer if that ever stops being
// true, and this paragraph is the record that nothing exercises it.

class Tagged {
  constructor(readonly width: number) {}
}

class Other {
  constructor(readonly depth: number) {}
}

/** The subject: `S` appears only inside a union, and not in the return. */
function present<S>(value: S | null): boolean {
  return value !== null;
}

/** Two arguments of different types must make two copies, not one. */
export function twoCopies(n: number): number {
  const one = present(new Tagged(n)) ? 1 : 0;
  const two = present(new Other(n)) ? 2 : 0;
  return one + two;
}

/** React's shape: a union one of whose members is a function type. */
function lazyOrValue<S>(value: (() => S) | S): boolean {
  return typeof value === "function";
}
export function theReactShape(n: number): number {
  return lazyOrValue(new Tagged(n)) ? n : -1;
}

/** The union on the *second* parameter, so the walk is not order-dependent. */
function eitherSlot<S>(flag: boolean, value: null | S): boolean {
  return flag && value !== null;
}
export function unionSecond(n: number): number {
  return eitherSlot(n > 0, new Tagged(n)) ? n : -1;
}

/** **Control.** A bare `S`, which pinned before this and must still. */
function bare<S>(v: S): S {
  return v;
}
export function stillPinsABareParameter(n: number): number {
  return bare(n) + bare(new Tagged(1)).width;
}
