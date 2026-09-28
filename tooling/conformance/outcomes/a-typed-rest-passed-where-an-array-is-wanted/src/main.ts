// The control for an-untyped-rest-passed-where-an-array-is-wanted, differing in
// the annotation only: `[...x]: number[]` is an array, the call passes one, and
// the program agrees with node. So the destructuring and the call are not the
// defect; the `Iterable` an unannotated pattern implies is.
function lengthOf(xs: number[]): number {
  return xs.length;
}
var f;
f = ([...x]: number[]) => lengthOf(x);
observe("length", String(f([1, 2])));
done();
