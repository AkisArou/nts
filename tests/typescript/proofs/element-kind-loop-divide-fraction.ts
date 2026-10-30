/*---
description: A later compound division introduces a fraction into an initially integral slot.
features: [ts-proof-element-kind, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: the second iteration divides 7 by 2; a separate read must give 3.5.
function readFirst(xs: number[]): number { return xs[0]; }
function observe(turns: number): number {
  const xs = [7];
  for (let i = 0; i < turns; i++) {
    if (i === 1) xs[0] /= 2;
  }
  return readFirst(xs);
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(observe(n), n < 2 ? 7 : 3.5);
}
