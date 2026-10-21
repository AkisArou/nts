// **A tuple of references destructured by a walk.** `for (const [, p] of
// pairs)` over `[string, Point][]` refused in lowering on every backend:
// the tuple was an array of its first element's type, so `p` bound as a
// string, and `.x` read as an array's member. With the tuple an array of
// erased values, `p` unerases to `Point`. Found by the Wasm lane collecting
// a `Map`'s entries (2026-10-21).

class Point {
  x: number;
  constructor(x: number) {
    this.x = x;
  }
}

export function total(n: number): number {
  const pairs: [string, Point][] = [];
  for (let i = 0; i < 4; i++) pairs.push(["p" + i, new Point(i * n)]);
  let sum = 0;
  for (const [, p] of pairs) sum += p.x;
  return sum;
}
