/*---
description: A getter fills an array with negative zero before a separate read.
features: [ts-proof-element-kind, ts-route-accessor, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-accessors, ts-objects]
---*/
// Fact: integer-only number[] is narrowable (docs/foundations/objects.md, Arrays).
// Route: a getter fills with -0; the reader observes -0 rather than integer 0.
function readSecond(xs: number[]): number { return xs[1]; }
function observe(n: number): number {
  const xs = [1, 2, 3];
  const hook = {
    get touch(): number {
      if (n > 0) xs.fill(-0);
      return 0;
    }
  };
  hook.touch;
  return readSecond(xs);
}
for (const n of [0, 1, 3, 4, 7]) {
  assert.sameValue(observe(n), n > 0 ? -0 : 2);
}
