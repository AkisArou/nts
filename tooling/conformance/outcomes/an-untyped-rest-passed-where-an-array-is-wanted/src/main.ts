// An unannotated rest pattern `[...x]` gives the parameter the `Iterable` its
// pattern implies. Until 50f358df5, passed where an array is declared, it was
// cast to `NtsArray *`: `emit-c` exited 0 and `cc` rejected the C with
// `'NtsObj_Iterable_N_' has no member named 'length'`. It is refused now -- a
// length is read only from a type that keeps one -- and this record holds that
// refusal, so a return to the cast reads as CHANGED. The annotated
// `[...x]: number[]` agrees: a-typed-rest-passed-where-an-array-is-wanted,
// which differs from this in the annotation only.
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
