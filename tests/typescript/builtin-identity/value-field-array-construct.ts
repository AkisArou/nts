/*---
description: Array is constructed through a typed field value.
features: [ts-builtin-identity, ts-builtin-value, ts-iteration, ts-arrays, ts-functions, ts-class, ts-class-fields, ts-construct-signatures]
---*/
// Route: a typed field holds the real Array; node keeps both supplied elements.
class Holder {
  target: ArrayConstructor;
  constructor(target: ArrayConstructor) { this.target = target; }
}
function check(n: number): void {
  const holder = new Holder(Array);
  const result: number[] = new holder.target<number>(n, n + 1);
  assert.sameValue(result.length, 2);
  assert.sameValue(result[0], n);
  assert.sameValue(result[1], n + 1);
  assert.sameValue(result instanceof Array, true);
}
for (const n of [-3, 0, 2.5, 7]) check(n);
