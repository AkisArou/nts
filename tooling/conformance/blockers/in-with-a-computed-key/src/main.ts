// expect: an `in` whose key is not a literal the compiler can see
//
// `"a" in row` lowers because the compiler can see which field is being asked
// about. `key in row` does not, because the answer depends on a value.
//
//     "a" in row    -> lowers
//     key in row    -> REFUSED
//
// `literalKey` is the control and must stay clean, or the diagnostic reads as
// "`in` is refused", which is false.
//
// Seven of `url`'s forty own-source roots are this, in
// `src/searchparams.ts`. It is the same representation decision as
// `computed-member-read` and `computed-member-write` -- a key known only at run
// time -- reached through a third operator, and filed separately because a fix
// for member access need not carry `in` with it.

interface Row {
  a: number;
  b: number;
}

// The control builds its own `Row` rather than taking one. An object
// *parameter* draws `takes an object, which crosses outward only`, which is a
// different blocker and would leave this control declined for a reason that has
// nothing to do with `in`.
export function literalKey(a: number): boolean {
  const row: Row = { a, b: 0 };
  return "a" in row;
}

export function computedKey(a: number, key: string): boolean {
  const row: Row = { a, b: 0 };
  return key in row;
}
