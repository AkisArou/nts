// `emit-c` exits 0 and `cc` rejects the C: `'NtsObj_Iterable_N_' has no member
// named 'length'`. An unannotated rest pattern `[...x]` gives the parameter the
// `Iterable` its pattern implies, and passed where an array is declared it is
// cast to `NtsArray *` -- neither converted nor refused. Reading `x.length`
// directly refuses honestly (`length`, which `Iterable` does not declare), and
// the annotated `[...x]: number[]` agrees: a-typed-rest-passed-where-an-array-
// is-wanted, which differs from this in the annotation only.
//
// Found by test262: 23 files calling `assert.compareArray` on a destructured
// rest (a non-generic `readonly unknown[]` stand-in), and 14 more reaching the
// same cast through a generator (`NtsObj_Generator0`) once raising was removed.
function lengthOf(xs: number[]): number {
  return xs.length;
}
var f;
f = ([...x]) => lengthOf(x);
observe("length", String(f([1, 2])));
done();
