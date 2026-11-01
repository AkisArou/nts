// expect: NTS1001 a `new` whose constructor builds something other than the type its site holds is not supported by this lowering yet
//
// `Uint8Array` cast to `Float64ArrayConstructor` builds a byte view that the site
// holds as a view of doubles.
// Control: tests/programs/a-float64-array-constructed-through-a-cast-of-itself.
const C = Uint8Array as unknown as Float64ArrayConstructor;
function width(values: Float64Array): number {
  return values.byteLength;
}
export function probe(n: number): number {
  return width(new C((n & 7) + 1));
}
