// Control for tests/refusals/a-typed-array-chain-with-a-class-declaring-fields: no class in the chain declares a field; the count moves to the site.
let made = 0;
class Base extends Uint8Array {}
class Middle extends Base {}
class Derived extends Middle {}
export function probe(n: number): number {
  made = 0;
  made += 1;
  return new Derived(n & 7).length * 10 + made;
}
