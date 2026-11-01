/*---
description: Control for representation-booleans-parameter-reader; writer and reader use one declared array type.
features: [ts-array-contents, ts-array-representation, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unknown]
---*/
// Only reader declarations change; inputs, writes, reads and assertions are identical.
function observe(values: boolean[], first: boolean): void {
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
