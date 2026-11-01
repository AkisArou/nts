/*---
description: A readonly unknown-element parameter reads concrete boolean storage without changing false or true.
features: [ts-array-contents, ts-array-representation, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unknown]
---*/
// Concrete writes cross a wider reader; node keeps exact values, runtime kinds and slot presence.
function observe(values: readonly unknown[], first: boolean): void {
  assert.sameValue(values.length, 3);
  assert.compareArray(values, [first, !first, first]);
  for (let i = 0; i < values.length; i++) {
    assert.sameValue(typeof values[i], "boolean");
    assert.sameValue(Object.hasOwn(values, i), true); assert.sameValue(i in values, true);
  }
}
function check(first: boolean): void {
  const values: boolean[] = [];
  values.push(first, !first, first);
  observe(values, first);
}
for (const first of [false, true, false]) check(first);
