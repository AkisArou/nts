// `new C(n)` through `const C: new (n: number) => Sized = Sized` runs `Sized`'s
// constructor, whose union parameter has no representation, so the site takes the
// copy over the member it passes, as `new Sized(n)` does. The checker resolves the
// site to the annotation's signature, which has no body; planned against it, the
// site called a declared constructor lowered only as its copies.
// Control: tests/programs/a-constructor-reached-through-a-typed-const-alias.
class Sized {
  readonly size: number;
  constructor(value: number | string | ArrayLike<number>) {
    this.size = typeof value === "number" ? value : value.length;
  }
}
const C: new (n: number) => Sized = Sized;
export function probe(n: number): number {
  return new C(n).size + new Sized(n).size;
}
