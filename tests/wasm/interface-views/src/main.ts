// An interface reached by a prefix receiver and by an owner of another field
// order, against node. Under Materialize every read and write through `Pair`
// is a family call: the reordered owner's row answers it, and the prefix
// receiver takes the default, the interface's own positional access. The
// reordered owner reaches `Pair` through a view, which is the object itself.
interface Pair {
  a: number;
  b: number;
}
class InOrder {
  a = 0;
  b = 0;
  constructor(v: number) { this.a = v; this.b = v * 2; }
}
// A base fixes the field order: `Shifted` is laid out base first, `b` before
// `a`, so it cannot be reordered to match `Pair` and is not its prefix.
class Leading {
  b = 0;
  constructor(v: number) { this.b = v - 1; }
}
class Swapped extends Leading {
  a = 0;
  constructor(v: number) { super(v); this.a = v + 3; }
}
function read(p: Pair): number {
  return p.a * 100 + p.b;
}
function bump(p: Pair, by: number): Pair {
  p.a += by;
  p.b -= by;
  return p;
}
export function inOrder(n: number): number {
  return read(bump(new InOrder(n), 1));
}
export function swapped(n: number): number {
  return read(bump(new Swapped(n), 2));
}
export function mixed(n: number): number {
  const pairs: Pair[] = [];
  pairs.push(new InOrder(n));
  pairs.push(new Swapped(n));
  pairs.push({ a: n, b: -n });
  let total = 0;
  for (const p of pairs) total += read(bump(p, 1));
  return total;
}
