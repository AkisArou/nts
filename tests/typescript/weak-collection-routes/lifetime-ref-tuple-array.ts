/*---
description: WeakRef values stored in tuple array elements retain the exact separately held target for every element.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-tuples, ts-arrays, ts-objects, ts-functions, ts-class, ts-class-fields, ts-iteration]
---*/
// WeakRef crosses a tuple element in an array; node returns its paired strong target for objects, arrays, functions, instances and repeated aliases.
class Item { value: number; constructor(value: number) { this.value = value; } }
const shared = { value: 1 };
const targets: object[] = [shared, { value: 1 }, shared, [1], () => 1, new Item(1)];
const pairs: [object, WeakRef<object>][] = [];
for (const target of targets) pairs.push([target, new WeakRef(target)]);
for (let index = 0; index < pairs.length; index++) {
  const [target, reference] = pairs[index];
  assert.sameValue(reference.deref(), target);
  assert.sameValue(reference.deref(), targets[index]);
}
assert.sameValue(targets[0], targets[2]);
assert.sameValue(targets[0] === targets[1], false);
