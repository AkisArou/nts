// Control: extract the getter-returned closure before calling it.
class Holder {
  readonly n: number;
  constructor(n: number) { this.n = n; }
  get m(): () => number {
    const n = this.n;
    return () => {
      if (n > 2) { throw new RangeError("getter's callable"); }
      return n * 10;
    };
  }
}
function attempt(run: () => number): number {
  try { return run(); } catch { return -1; }
}
export function probe(n: number): number {
  const method = new Holder(n & 7).m;
  return attempt(() => method());
}
