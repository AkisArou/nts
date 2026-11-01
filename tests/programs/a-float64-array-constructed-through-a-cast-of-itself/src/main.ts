// Control for tests/refusals/a-typed-array-cast-to-another-element-type: the cast names the builtin it constructs.
const C = Float64Array as unknown as Float64ArrayConstructor;
function width(values: Float64Array): number {
  return values.byteLength;
}
export function probe(n: number): number {
  return width(new C((n & 7) + 1));
}
