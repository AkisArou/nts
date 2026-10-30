/*---
description: A later loop iteration pushes negative zero into an initially integral array.
features: [ts-proof-element-kind, ts-route-loop, ts-functions, ts-iteration, ts-arrays, ts-numbers]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a back edge carries -0 to the next push; a separate read keeps its sign.
function readLast(xs: number[]): number { return xs[xs.length - 1]; }
function observe(turns: number): number {
  const xs = [1, 2];
  let value = 0;
  for (let i = 0; i < turns; i++) {
    xs.push(value);
    value = -0;
  }
  return readLast(xs);
}
for (const n of [0, 1, 2, 3, 7]) {
  assert.sameValue(observe(n), n === 0 ? 2 : n === 1 ? 0 : -0);
}
