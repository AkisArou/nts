// expect: NTS1001 a `new` through `C`, which holds a class rather than naming one -- the constructor would be chosen from the declared type and not from the value is not supported by this lowering yet
//
// A class whose constructor takes a union with no representation, passed as a
// value: the callee's `new C(n)` is refused by name at that site, as for any
// class, and never calls the declared constructor, which is lowered only as its
// copies here.
// Control: tests/programs/a-union-constructor-reached-through-a-typed-const-alias,
// where the binding names the class.
class Sized {
  readonly size: number;
  constructor(value: number | string | ArrayLike<number>) {
    this.size = typeof value === "number" ? value : value.length;
  }
}
function make(C: new (n: number) => Sized, n: number): number {
  return new C(n).size;
}
export function probe(n: number): number {
  return make(Sized, n) + new Sized(n).size;
}
