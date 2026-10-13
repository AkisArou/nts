// Interfaces with fields, held by object literals and by classes whose
// fields begin with the interface's, read through the interface, against
// node. Each layout the core names as a prefix receiver extends the
// interface's storage, so a positional read through the interface is valid.
interface Point {
  x: number;
  y: number;
}
class Pixel {
  x: number;
  y: number;
  color: number;
  constructor(x: number, y: number, color: number) {
    this.x = x;
    this.y = y;
    this.color = color;
  }
}
// A base that already holds the interface's fields: `Base` extends `Point`'s
// storage, and `Derived` extends `Base`'s.
class Base {
  x = 1;
  y = 2;
  constructor(x: number, y: number) { this.x = x; this.y = y; }
}
class Derived extends Base {
  z = 3;
  constructor(x: number, y: number) { super(x, y); this.z = x + y; }
}
function sum(p: Point): number {
  return p.x * 10 + p.y;
}
function moved(p: Point, by: number): Point {
  p.x += by;
  return p;
}
export function literal(n: number): number {
  return sum({ x: n, y: n + 1 });
}
export function aClassWithMoreFields(n: number): number {
  return sum(new Pixel(n, 2, 9));
}
export function aClassThroughItsBase(n: number): number {
  return sum(new Derived(n, 5));
}
export function mixed(n: number): number {
  const points: Point[] = [];
  points.push({ x: 1, y: 2 });
  points.push(new Pixel(n, 3, 4));
  points.push(new Derived(n, n));
  let total = 0;
  for (const p of points) total += sum(moved(p, 1));
  return total;
}
export function chosen(n: number): number {
  let p: Point;
  if (n > 0) p = new Pixel(n, 1, 2);
  else p = { x: -n, y: 7 };
  return sum(moved(p, 3));
}
