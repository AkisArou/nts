/*---
description: A parameter typed `object` takes arrays, functions and plain objects, all of which Object.keys reads.
features: [ts-objects, ts-object-type]
---*/
function keyCount(value: object): number {
  return Object.keys(value).length;
}
function named(): void {}
assert.sameValue(keyCount({ a: 1, b: 2 }), 2);
assert.sameValue(keyCount([7, 8, 9]), 3);
assert.sameValue(keyCount(named), 0);
assert.sameValue(keyCount(new Map([[1, 2]])), 0);
