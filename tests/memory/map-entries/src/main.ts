// A `Map`'s entries collected into an array: `Array.from(map)`, a pair per
// live entry.
//
// The pairs are the answer -- the language makes each one fresh -- so they
// cannot be zero. What the case is about is that nothing else is built to
// arrive at them: one array sized at the live count, one pair per entry, and
// no array grown on the way.

export function work(n: number): number {
  const totals = new Map<number, number>();
  for (let i = 0; i < 16 + n; i++) {
    totals.set(i * 3, i);
  }
  const pairs = Array.from(totals);
  return pairs.length + pairs[pairs.length - 1][1];
}
