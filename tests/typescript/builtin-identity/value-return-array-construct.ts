/*---
description: Array is constructed through a typed return value.
features: [ts-builtin-identity, ts-builtin-value, ts-iteration, ts-arrays, ts-functions, ts-construct-signatures]
---*/
// Route: a typed return holds the real Array; node keeps both supplied elements.
function factory(): ArrayConstructor { return Array; }
function check(n: number): void {
  const Target: ArrayConstructor = factory();
  const result: number[] = new Target<number>(n, n + 1);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(result instanceof Array, true);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
