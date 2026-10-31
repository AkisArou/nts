/*---
description: Control for value-map-array-call; use the direct Array target at the invocation.
features: [ts-builtin-identity, ts-builtin-value, ts-iteration, ts-arrays, ts-functions, ts-map-set, ts-narrowing, ts-call-signatures]
---*/
// Paired case: ../builtin-identity/value-map-array-call.ts.
// Change: Use the direct Array target at the invocation.
function check(n: number): void {
  const targets = new Map<string, ArrayConstructor>([["make", Array]]);
  const Target = targets.get("make");
  if (Target === undefined) throw new Error("missing constructor");
  const result: number[] = Array<number>(n, n + 1);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(result instanceof Array, true);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
