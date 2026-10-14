// A class whose base holds fewer fields than an interface it is held as a
// prefix of: `Point`'s storage sits between `Derived` and `Base`, a chain
// forced by their lengths and agreed by every holder, so it compiles and
// agrees with node. interface-below-a-vtable is the same chain where `Base`
// has virtual methods, which is refused.
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
