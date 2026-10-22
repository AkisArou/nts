// The rest of a tuple read past its end, bound at module scope: test262's
// `dstr/ary-ptrn-rest-id-exhausted`, in its `var`, `let` and `const` forms.
//
// `let [, , ...x] = [1, 2]` gives `x` the type `[]`. Empty tuples formerly had
// an object layout, so slicing the source produced an array that could not be
// stored in the module variable: invalid HIR. They now share the uninhabited
// array representation. An exhausted rest is still built at the target's
// width, because slicing a source of strings would keep its string width.
//
// Control, one difference: `[, ...kept] = [1, 2]` leaves one element, so the
// rest is `[number]`, an array of one representation, and it always compiled.
// The same exhausted rest in a function compiled too, because a local takes
// whatever representation arrives; it is built the same way now, and agrees.

var [, , ...declaredWithVar] = [1, 2];
let [, , ...declaredWithLet] = [1, 2];
const [, , ...declaredWithConst] = [1, 2];
const [, ...kept] = [1, 2];

/** The three declaration forms: each an array, and empty. */
export function exhaustedAtModuleScope(n: number): number {
  const v = (Array.isArray(declaredWithVar) ? 1 : 0) + declaredWithVar.length * 10;
  const l = (Array.isArray(declaredWithLet) ? 1 : 0) + declaredWithLet.length * 10;
  const c = (Array.isArray(declaredWithConst) ? 1 : 0) + declaredWithConst.length * 10;
  return v + l * 100 + c * 10000 + n * 0;
}

/** The control: one element left, an array of length one. */
export function oneLeftAtModuleScope(n: number): number {
  return (Array.isArray(kept) ? 1 : 0) + kept.length * 10 + kept[0] * 100 + n * 0;
}

/** The same exhausted rest in a function, where it always compiled. */
export function exhaustedInAFunction(n: number): number {
  const [, , ...rest] = [n, n + 1];
  return rest.length + (Array.isArray(rest) ? 1 : 0) + n * 0;
}
