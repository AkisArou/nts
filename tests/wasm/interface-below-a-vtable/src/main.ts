// `Point` holds `Derived` as a prefix, and `Derived`'s base `Base` is shorter
// than `Point`, so `Point`'s storage would sit between them. `Base` has
// virtual methods, so its descriptor field is its own vtable type, and an
// interface below it would hold the root descriptor there: invalid Wasm. It
// is refused by name. interface-fields-shorter-base is the control: the same
// chain with a `Base` that has no virtual methods, which agrees.
interface Point {
  x: number;
  y: number;
}
class Base {
  x = 1;
  constructor(x: number) { this.x = x; }
  describe(): number { return this.x; }
}
class Derived extends Base {
  y = 2;
  constructor(x: number, y: number) { super(x); this.y = y; }
  describe(): number { return this.x + this.y; }
}
function sum(p: Point): number {
  return p.x * 10 + p.y;
}
// Exported, so nothing bounds the classes `b` can hold and the call keeps its
// table: two known classes would make it direct (`class_sets`), and the vtable
// this fixture needs would not be emitted.
export function describe(b: Base): number {
  return b.describe();
}
export function both(n: number): number {
  return sum(new Derived(n, 5)) + describe(new Base(n)) + describe(new Derived(n, 1));
}
