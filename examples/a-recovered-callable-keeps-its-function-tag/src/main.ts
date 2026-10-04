function plus(n: number): number { return n + 1; }
function minus(n: number): number { return n - 1; }
function choose(n: number): (n: number) => number { return n > 0 ? plus : minus; }
function describe(value: unknown): number { return typeof value === "function" ? 1 : 0; }
function erased(n: number): unknown { return choose(n); }
export function parameter(n: number): number { return describe(choose(n)); }
export function returned(n: number): number { const value = erased(n); return typeof value === "function" ? 3 : 4; }
export function array(n: number): number { const values: unknown[] = [choose(n)]; return typeof values[0] === "function" ? 5 : 6; }

class Holder { constructor(public number: number) {} }
function record(n: number): unknown { return new Holder(n); }
export function objectControl(n: number): number {
  const value = record(n);
  return typeof value === "object" ? 7 : 8;
}
export function closureControl(n: number): number {
  const value: unknown = (input: number) => input + n;
  return typeof value === "function" ? 9 : 10;
}
function mixed(n: number): unknown { return n > 0 ? choose(n) : new Holder(n); }
export function mixedControl(n: number): number {
  const value = mixed(n);
  return typeof value === "function" ? 11 : 12;
}
