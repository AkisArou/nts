// An uncovered named literal must not let class inference open a slot.
interface Sink { take(x: number): number }
interface Thenable { take(x: number | string): number }
class Exact { take(x: number): number { return x - 1; } }
const literal: Thenable = { take(x: number | string): number { return typeof x === "number" ? x + 1 : 0; } };
export function mixed(n: number): number {
  const all: Sink[] = [new Exact(), literal];
  let total = 0;
  for (const s of all) total = total * 10 + s.take(n);
  return total;
}
