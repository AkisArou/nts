/*---
description: Later compound additions make an initially integral array slot fractional.
features: [ts-proof-element-kind, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: later loop updates add 0.25; a separate reader retains each fraction.
function readFirst(xs: number[]): number { return xs[0]; }
function observe(turns: number): number {
  const xs = [7];
  for (let i = 0; i < turns; i++) {
    if (i === 0) xs[0] += 1;
    else xs[0] += 0.25;
  }
  return readFirst(xs);
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(observe(n), n === 0 ? 7 : 8 + (n - 1) * 0.25);
}
