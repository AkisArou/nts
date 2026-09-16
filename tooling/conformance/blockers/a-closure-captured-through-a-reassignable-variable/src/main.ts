// expect: a closure captured through a reassignable variable
//
// A `const` bound to an arrow has that closure's layout, so capturing it in
// another closure works -- `examples/a-closure-capturing-a-closure`. A `let`
// does not: two arrows are two layouts, and there is no single field type for
// the slot. clang says it directly where the shape reaches it,
// `assigning to 'NtsObj_Closure2 *' from 'NtsObj_Closure3 *'`.
//
// **What this fixture guards is the message, not the refusal.** Before it was
// named here the capture took the checker's type, the field had no layout, and
// the C backend refused with
//
//     NTS2006 an object type with no layout: type 4
//
// which is true, names an internal id, and says nothing about the one `let` that
// caused it. The export was dropped either way; only the reader's chance of
// acting on it differed.
//
// The general fix is a representation for a function value that does not name
// one closure -- the same thing `blockers/a-function-value-called-with-no-closures`
// and the five `withResolvers` value-use sites want.

export function f(n: number): number {
  let inner = (k: number): number => k + 1;
  if (n > 2) {
    inner = (k: number): number => k + 2;
  }
  const outer = (): number => inner(n);
  return outer();
}
