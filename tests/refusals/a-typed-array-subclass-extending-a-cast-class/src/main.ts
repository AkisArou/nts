// expect: NTS1001 a subclass of a builtin with a class in its chain that declares fields or is not that builtin's storage is not supported by this lowering yet
//
// `Sub` extends `Own` cast to a typed-array constructor, so its type is a view
// while its `super` runs `Own`. Built as the view, `instanceof Own` was false
// where node says true.
// Control: tests/programs/a-typed-array-subclass-extending-the-builtin-through-a-const.
class Own {
  constructor(readonly size: number) {}
}
const B = Own as unknown as Uint8ArrayConstructor;
class Sub extends B {}
export function probe(n: number): number {
  const made: object = new Sub(n & 7);
  return made instanceof Own ? 1 : 0;
}
