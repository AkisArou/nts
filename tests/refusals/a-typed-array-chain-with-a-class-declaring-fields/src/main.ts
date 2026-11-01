// expect: NTS1001 a subclass of a builtin with a class in its chain that declares fields or is not that builtin's storage is not supported by this lowering yet
//
// A class between a typed-array subclass and its builtin that declares a field
// has no storage for it in the view: building the view from the builtin
// skipped `Middle`'s initializer, and `made` read 0 where node reads 1.
// Control: tests/programs/a-typed-array-chain-whose-classes-declare-no-fields.
let made = 0;
class Base extends Uint8Array {}
class Middle extends Base {
  readonly tag = (made += 1);
}
class Derived extends Middle {}
export function probe(n: number): number {
  made = 0;
  return new Derived(n & 7).length * 10 + made;
}
