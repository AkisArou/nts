// run: check
// #921: a getter-returned closure is invoked directly inside a try. Its throw escapes.
// The control extracts the closure before invoking it. Found during #888 review.
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
  return attempt(() => new Holder(n & 7).m());
}
