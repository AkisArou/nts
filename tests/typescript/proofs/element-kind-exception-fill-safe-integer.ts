/*---
description: An interrupted fill leaves an element past the safe-integer limit.
features: [ts-proof-element-kind, ts-route-exception, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-errors]
---*/
// Fact: safe whole elements can use int64 (docs/foundations/numbers.md, Integers proved from doubles).
// Route: a throw skips rollback after filling with 2^53; the reader sees gap 0.
function nextGap(xs: number[]): number {
  const x = xs[0];
  return (x + 1) - x;
}
function observe(n: number): number {
  const xs = [9007199254740991];
  try {
    xs.fill(9007199254740992);
    if (n > 0) throw new Error('retain fill');
    xs.fill(9007199254740991);
  } catch {
  }
  return nextGap(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? 0 : 1);
}
