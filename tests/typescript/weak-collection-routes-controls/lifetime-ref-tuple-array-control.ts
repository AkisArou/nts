/*---
description: Control for lifetime-ref-tuple-array using plain holders in the same tuple array elements.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-tuples, ts-arrays, ts-objects, ts-functions, ts-class, ts-class-fields, ts-iteration]
---*/
// Plain target holders cross the same tuple array elements; node reads the exact paired strong targets, preserving aliases and equal-content separation.
class Item { value: number; constructor(value: number) { this.value = value; } }
const shared = { value: 1 };
const targets: object[] = [shared, { value: 1 }, shared, [1], () => 1, new Item(1)];
const pairs: [object, { target: object }][] = [];
for (const target of targets) pairs.push([target, { target }]);
for (let index = 0; index < pairs.length; index++) {
  const [target, reference] = pairs[index];
  assert.sameValue(reference.target, target);
  assert.sameValue(reference.target, targets[index]);
}
assert.sameValue(targets[0], targets[2]);
assert.sameValue(targets[0] === targets[1], false);
