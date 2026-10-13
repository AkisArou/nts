// A class whose base holds fewer fields than an interface it is held as a
// prefix of: `Derived` would need `Point`'s storage between itself and
// `Base`'s, and `Pixel`, held by `Point` too, has no `Base` above it. Wasm
// gives a struct one parent, so this is refused by name, not given one by
// guess. interface-fields is the control, with a base that holds both fields.
interface Point {
  x: number;
  y: number;
}
class Pixel {
  x = 0;
  y = 0;
  constructor(x: number) { this.x = x; }
}
class Base {
  x = 1;
  constructor(x: number) { this.x = x; }
}
class Derived extends Base {
  y = 2;
  constructor(x: number, y: number) { super(x); this.y = y; }
}
function sum(p: Point): number {
  return p.x * 10 + p.y;
}
export function both(n: number): number {
  return sum(new Pixel(n)) + sum(new Derived(n, 5));
}
