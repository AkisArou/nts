// run: check
// Wide stores its capturing method in a closure field. Calling it through
// Sink beside a declared implementer reaches a missing table entry.
interface Sink { take(x: number): number }
interface Wide { take(x: number | string): number }
class Exact implements Sink {
  take(x: number): number { return x - 1; }
}
export function mixed(n: number): number {
  const base = n;
  const literal: Wide = {
    take(x: number | string): number {
      return base + (typeof x === "number" ? x : 0);
    },
  };
  const all: Sink[] = [new Exact(), literal];
  let total = 0;
  for (const value of all) total = total * 10 + value.take(n);
  return total;
}
