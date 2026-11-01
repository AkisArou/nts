// Control for tests/programs/a-union-constructor-reached-through-a-typed-const-alias:
// the constructor's parameter is a `number`, not a union.
class Sized {
  readonly size: number;
  constructor(value: number) {
    this.size = value;
  }
}
const C: new (n: number) => Sized = Sized;
export function probe(n: number): number {
  return new C(n).size + new Sized(n).size;
}
