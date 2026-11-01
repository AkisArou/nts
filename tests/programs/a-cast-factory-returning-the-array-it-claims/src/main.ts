// Control for tests/refusals/a-cast-factory-used-as-the-array-it-claims: the factory
// returns the array the cast claims.
function Maker(): number[] {
  return [1, 2, 3];
}
const C = Maker as unknown as { new (): number[] };
function count(xs: number[]): number {
  return xs.length;
}
export function probe(n: number): number {
  return count(new C()) + n;
}
