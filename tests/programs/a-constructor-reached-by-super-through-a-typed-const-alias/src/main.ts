// Control for tests/programs/a-union-constructor-reached-by-super-through-a-typed-const-alias:
// the constructor's parameter is a `number`, not a union.
class Sized {
  readonly size: number;
  constructor(value: number) {
    this.size = value;
  }
}
const Base: new (n: number) => Sized = Sized;
class Sub extends Base {
  constructor(n: number) {
    super(n);
  }
}
export function probe(n: number): number {
  return new Sub(n).size;
}
