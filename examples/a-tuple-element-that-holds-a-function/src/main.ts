// Calling a function held in a **tuple element**: `t[1]()`.
//
// A tuple's layout spells its fields `_0`, `_1` -- because `v->1` is not C --
// and `t[1]` arrives as a member named `1`. The *read* path turned that number
// back into the position it always was; the **call** path asked `index_of("1")`,
// found nothing, and refused with
//
//     a method `1` with no declaration in the hierarchy
//
// for a tuple element holding a closure. Both paths now go through one
// `field_named`, which answers a tuple position, a name and a symbol key in that
// order -- two derivations of "which field is this name" would have differed on
// exactly the spelling neither author writes by hand.
//
// This is `[state, setState]`: the shape `useState`, `useReducer`,
// `useTransition` and `useActionState` return, and the React lane's reduction is
// what found it.
//
// # Controls
//
//     readsTheOtherElement       a non-function element still reads
//     throughAnObjectField       the shape that worked before, for comparison
//     destructuresThenCalls      `const [a, f] = t; f()`, which is how the
//                                hook's result is actually written
//
// The last is the one that matters for React and it takes a different path --
// destructuring reads the field and then calls a *value* -- so a fixture with
// only `t[1]()` would pass while the hook's own spelling refused.
//
// # What is still refused, named rather than hidden
//
// A tuple whose *first* element is also a function -- `[() => number, () => number]`
// -- fails in the backend with `NTS2006 an object type with no layout`. That
// predates this and is not about the call: it is a layout for the tuple type that
// nothing builds. Left out of this fixture deliberately, because an example must
// compile, and named here so the next reader does not rediscover it.

function helper(): number {
  return 2;
}

/** The subject: a call through a tuple element. */
export function callsThroughATupleElement(n: number): number {
  const t: [number, () => number] = [n, helper];
  return t[0] + t[1]();
}

/** **Control.** The other element, which is not a function. */
export function readsTheOtherElement(n: number): number {
  const t: [number, () => number] = [n, helper];
  return t[0] * 3;
}

/** **Control.** The same call through an object field, which lowered before. */
export function throughAnObjectField(n: number): number {
  const o: { v: number; get: () => number } = { v: n, get: helper };
  return o.v + o.get();
}

/** **Control, and React's own spelling**: destructure, then call the value. */
export function destructuresThenCalls(n: number): number {
  const t: [number, () => number] = [n, helper];
  const [first, f] = t;
  return first + f();
}
