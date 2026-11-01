/*---
description: A widened interface reader retains bigint signs and payload bits beyond number precision and machine widths.
features: [ts-array-contents, ts-array-representation, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unknown, ts-bigint, ts-interfaces, ts-objects]
---*/
// Concrete writes cross a wider reader; node keeps exact values, runtime kinds and slot presence.
interface ArrayContentsBigintView { values: readonly unknown[]; }
function check(n: bigint): void {
  const values: bigint[] = [];
  const view: ArrayContentsBigintView = { values };
  values.push(n, -n, n << 65n, (n << 96n) + 1n);
  assert.sameValue(view.values.length, 4);
  assert.compareArray(view.values, [n, -n, n << 65n, (n << 96n) + 1n]);
  for (let i = 0; i < view.values.length; i++) {
    assert.sameValue(typeof view.values[i], "bigint");
    assert.sameValue(Object.hasOwn(view.values, i), true); assert.sameValue(i in view.values, true);
  }
}
for (const n of [1n, 7n, 65537n]) check(n);
