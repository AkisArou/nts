// expect: NTS1001 a class extending a cast, whose base its type names something it does not run is not supported by this lowering yet
//
// `Sub`'s type extends `Error`, and its `extends` operand runs `Own`: laid out
// and initialized as an error, `instanceof Own` was false where node says true.
// Control: tests/programs/a-class-extending-the-error-constructor-through-a-const.
class Own {
  constructor(readonly note: string) {}
}
const B = Own as unknown as ErrorConstructor;
class Sub extends B {}
export function probe(n: number): number {
  const made: object = new Sub("m" + n);
  return made instanceof Own ? 1 : 0;
}
