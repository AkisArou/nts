// A noncapturing direct literal body uses the same interface table contract
// as a declared class. Its wider input is adapted without a storage cast.
interface Sink { take(x: number): number }
interface Wide { take(x: number | string): number }
class Exact implements Sink {
  take(x: number): number { return x - 1; }
}
const literal: Wide = {
  take(x: number | string): number { return typeof x === "number" ? x + 1 : 0; },
};
export function mixed(n: number): number {
  const all: Sink[] = [new Exact(), literal];
  let sum = 0;
  for (const item of all) sum = sum * 10 + item.take(n);
  return sum;
}
