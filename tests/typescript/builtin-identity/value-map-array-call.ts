/*---
description: Array is called through a typed map value.
features: [ts-builtin-identity, ts-builtin-value, ts-iteration, ts-arrays, ts-functions, ts-map-set, ts-narrowing, ts-call-signatures]
---*/
// Route: a typed map holds the real Array; node keeps both supplied elements.
function check(n: number): void {
  const targets = new Map<string, ArrayConstructor>([["make", Array]]);
  const Target = targets.get("make");
  if (Target === undefined) throw new Error("missing constructor");
  const result: number[] = Target<number>(n, n + 1);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(result instanceof Array, true);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
