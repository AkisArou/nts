/*---
description: An object-constrained generic return preserves each WeakRef target and its aliases by identity.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-generics, ts-generic-constraints, ts-functions, ts-objects, ts-arrays, ts-class, ts-class-fields, ts-iteration]
---*/
// WeakRef<T> returns from an object-constrained helper; node dereferences the original object, including aliases and equal-content distinct targets.
function retain<T extends object>(target: T): WeakRef<T> { return new WeakRef(target); }
class Item { value: number; constructor(value: number) { this.value = value; } }
const shared = { value: 1 }, equal = { value: 1 };
const targets: object[] = [shared, equal, shared, [1], () => 1, new Item(1)];
const original = retain(shared), distinct = retain(equal);
assert.sameValue(original.deref(), shared);
assert.sameValue(distinct.deref(), equal);
assert.sameValue(shared === equal, false);
for (const target of targets) {
  const reference = retain(target), alias = target;
  assert.sameValue(reference.deref(), target);
  assert.sameValue(reference.deref(), alias);
  assert.sameValue(alias, target);
}
