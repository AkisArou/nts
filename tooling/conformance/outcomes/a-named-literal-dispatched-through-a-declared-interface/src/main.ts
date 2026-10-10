// run: check
// A named-type literal has no entry in the other interface's slot, even
// beside a declared class implementer. Part 1c owns the missing literal row.
interface Sink { take(x: number): number }
interface Thenable { take(x: number | string): number }
class Exact implements Sink { take(x: number): number { return x - 1; } }
const literal: Thenable = { take(x: number | string): number { return typeof x === "number" ? x + 1 : 0; } };
export function mixed(n: number): number {
  const all: Sink[] = [new Exact(), literal];
  let total = 0;
  for (const s of all) total = total * 10 + s.take(n);
  return total;
}
