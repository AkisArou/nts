/*---
description: Control for representation-holes-undefined-interface-reader; writer and reader use one declared array type.
features: [ts-array-contents, ts-array-representation, ts-arrays, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unknown, ts-null-undefined, ts-unions, ts-interfaces, ts-objects, ts-numbers]
---*/
// Only reader declarations change; inputs, writes, reads and assertions are identical.
interface ArrayContentsSparseView { values: (number | undefined)[]; }
function check(n: number): void {
  const values: (number | undefined)[] = [n, undefined, -0, NaN, n + 1];
  const view: ArrayContentsSparseView = { values };
  delete values[4]; values.length = 7; values[5] = undefined;
  const expected: unknown[] = [n, undefined, -0, NaN, undefined, undefined, undefined];
  const present: boolean[] = [true, true, true, true, false, true, false];
  assert.sameValue(view.values.length, 7); assert.compareArray(view.values, expected);
  for (let i = 0; i < view.values.length; i++) {
    assert.sameValue(view.values[i], expected[i]); assert.sameValue(typeof view.values[i], typeof expected[i]);
    assert.sameValue(Object.hasOwn(view.values, i), present[i]); assert.sameValue(i in view.values, present[i]);
  }
}
for (const n of [-3, 0, 7]) check(n);
