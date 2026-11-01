// Control for tests/refusals/a-class-extending-a-cast-error-constructor: `B` is `Error` itself, through a `const`.
class Own {
  constructor(readonly note: string) {}
}
const B = Error;
class Sub extends B {}
export function probe(n: number): number {
  const made: object = new Sub("m" + n);
  return made instanceof Own ? 1 : 0;
}
