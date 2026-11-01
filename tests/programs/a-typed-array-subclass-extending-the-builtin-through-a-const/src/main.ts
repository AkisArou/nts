// Control for tests/refusals/a-typed-array-subclass-extending-a-cast-class: `B` is the builtin itself, through a `const`.
class Own {
  constructor(readonly size: number) {}
}
const B = Uint8Array;
class Sub extends B {}
export function probe(n: number): number {
  const made: object = new Sub(n & 7);
  return made instanceof Own ? 1 : 0;
}
