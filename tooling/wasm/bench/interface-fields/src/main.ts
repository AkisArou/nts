// Field reads through an interface: one whose every owner is a prefix
// receiver (a positional read on its own storage), and one that an owner of
// another field order also reaches (a family call through the row, the
// default for the prefix receivers). Against node running the same TypeScript.
interface Point { x: number; y: number }
interface Pair { a: number; b: number }
class P1 { x = 0; y = 0; z = 0; constructor(v: number) { this.x = v; this.y = v + 1; } }
class P2 { x = 0; y = 0; constructor(v: number) { this.x = v * 2; this.y = v; } }
class Q1 { a = 0; b = 0; constructor(v: number) { this.a = v; this.b = v + 1; } }
// Another field order: `Pair` reaches it through a view, with a row.
class Swapped { b = 0; a = 0; constructor(v: number) { this.a = v + 3; this.b = v; } }

const points: Point[] = [new P1(1), new P2(2), new P1(3), new P2(4)];
const pairs: Pair[] = [new Q1(1), new Swapped(2), new Q1(3), new Swapped(4)];
const prefixPairs: Pair[] = [new Q1(1), new Q1(2), new Q1(3), new Q1(4)];

export function prefixOnly(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) { const p = points[i & 3]; total += p.x - p.y; }
  return total;
}
export function withAnotherOrder(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) { const p = pairs[i & 3]; total += p.a - p.b; }
  return total;
}
export function prefixThroughDispatch(n: number): number {
  let total = 0;
  for (let i = 0; i < n; i++) { const p = prefixPairs[i & 3]; total += p.a - p.b; }
  return total;
}
