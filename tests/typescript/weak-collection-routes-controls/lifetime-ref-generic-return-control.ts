/*---
description: Control for lifetime-ref-generic-return using object-constrained generic plain holders.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-generics, ts-generic-constraints, ts-functions, ts-objects, ts-arrays, ts-class, ts-class-fields, ts-iteration]
---*/
// Plain target holders return through the same generic helper; node reads each original object and preserves aliases and distinct equal-content objects.
function retain<T extends object>(target: T): { target: T } { return { target }; }
class Item { value: number; constructor(value: number) { this.value = value; } }
const shared = { value: 1 }, equal = { value: 1 };
const targets: object[] = [shared, equal, shared, [1], () => 1, new Item(1)];
const original = retain(shared), distinct = retain(equal);
assert.sameValue(original.target, shared);
assert.sameValue(distinct.target, equal);
assert.sameValue(shared === equal, false);
for (const target of targets) {
  const reference = retain(target), alias = target;
  assert.sameValue(reference.target, target);
  assert.sameValue(reference.target, alias);
  assert.sameValue(alias, target);
}
