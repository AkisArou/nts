// `{}` — a type that erases and a value that does not.
//
// As a **type**, `{}` is every value except `null` and `undefined`: a number is
// assignable to it. So `representation_within` gives it `Erased`, and it says
// why — representing it as a layout made `const x: {} = n` fail with a number
// where an object was wanted, the checker being right and the representation
// disagreeing with it. That rule is correct and is untouched; `numberInAnEmptySlot`
// below is the arm that holds it.
//
// The **literal** is not that. `{}` written down is an object with no fields,
// and it was refused as `an object literal that is not an object` because the
// type it was built at had erased. It is now built as the object it is and
// erased afterwards — the same two steps the union-member arm beside it takes,
// for the same reason.
//
// `options = {}` is node's sentinel for "no options were passed", and it is
// under `net.createServer` at 91 of 148 failing files and `http.createServer` at
// 241 of 405.

/** The bare literal, and that it is an object at run time. */
export function sentinel(n: number): number {
  const raw = {};
  return typeof raw === "object" ? n + 1 : n - 1;
}

/** The idiom the corpus writes: default an `unknown` to `{}`. The result is
 *  still erased, so the arms have to be told apart by `typeof`. */
export function defaulted(n: number): number {
  const value: unknown = n > 3 ? undefined : n;
  const raw = value === undefined ? {} : value;
  if (typeof raw === "number") {
    return raw + 10;
  }
  return typeof raw === "object" ? 1 : 2;
}

/** `??` rather than a ternary, which is a different node reaching the same
 *  binding. */
export function nullish(n: number): number {
  const value: unknown = n > 3 ? undefined : n;
  const raw = value ?? {};
  return typeof raw === "number" ? raw + 20 : 3;
}

/** One literal, two names: the same object, so `===` holds. An erased value
 *  that had been rebuilt rather than shared would answer the other way. */
export function identity(n: number): number {
  const a = {};
  const b = a;
  return a === b ? n : -1;
}

/** Two literals are two objects. `{} === {}` is false in JavaScript, and a
 *  representation that folded them to one constant would say true — which is
 *  the arm that makes `identity` above mean something. */
export function distinct(n: number): number {
  const a = {};
  const b = {};
  return (a === b ? 100 : 0) + n;
}

/** Crossing a call boundary, where the parameter's slot is erased. */
function receives(v: unknown): number {
  return typeof v === "object" ? 7 : 8;
}

export function passed(n: number): number {
  return receives({}) + n;
}

/** **The control, and it is the rule this change must not break.** A number in
 *  a `{}` slot: the type erases, so this is a number in an erased slot and has
 *  nothing to do with object literals. */
export function numberInAnEmptySlot(n: number): number {
  const x: {} = n;
  return typeof x === "number" ? n + 1 : -1;
}
