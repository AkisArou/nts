/*---
description: Array is called through a typed variable value.
features: [ts-builtin-identity, ts-builtin-value, ts-iteration, ts-arrays, ts-functions, ts-call-signatures]
---*/
// Route: a typed variable holds the real Array; node keeps both supplied elements.
function check(n: number): void {
  const Target: ArrayConstructor = Array;
  const result: number[] = Target<number>(n, n + 1);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(result instanceof Array, true);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
