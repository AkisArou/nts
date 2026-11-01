// expect: NTS1001 a `new` whose constructor builds something other than the type its site holds is not supported by this lowering yet
//
// A factory constructed through a cast builds what it returns, a `Map`, which
// the site holds as the array the cast claims: read as one, node answers NaN.
// Control: tests/programs/a-cast-factory-returning-the-array-it-claims.
function Maker(): Map<string, number> {
  return new Map([["a", 1]]);
}
const C = Maker as unknown as { new (): number[] };
function count(xs: number[]): number {
  return xs.length;
}
export function probe(n: number): number {
  return count(new C()) + n;
}
