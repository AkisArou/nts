// `super(n)` in a class extending `const Base: new (n: number) => Sized = Sized`
// runs `Sized`'s constructor, as `lower_super` finds it, and takes the copy over
// the member it passes. The checker resolves the call to the annotation's signature.
// Control: tests/programs/a-constructor-reached-by-super-through-a-typed-const-alias.
class Sized {
  readonly size: number;
  constructor(value: number | string | ArrayLike<number>) {
    this.size = typeof value === "number" ? value : value.length;
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
