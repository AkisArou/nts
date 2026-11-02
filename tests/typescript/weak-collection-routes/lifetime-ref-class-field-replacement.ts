/*---
description: A WeakRef in a class field retains its original target when the strong field and then the reference field are replaced.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-class, ts-class-fields, ts-objects, ts-arrays, ts-functions, ts-iteration]
---*/
// WeakRef crosses a class field and an alias; node returns the exact retained target, then the new field's target, without retargeting the alias.
class Item { value: number; constructor(value: number) { this.value = value; } }
class RefCell {
  live: object;
  reference: WeakRef<object>;
  constructor(target: object) { this.live = target; this.reference = new WeakRef(target); }
}
const shared = { value: 1 };
const targets: object[] = [shared, shared, { value: 1 }, [1], () => 1, new Item(1)];
for (const target of targets) {
  const cell = new RefCell(target), alias = cell.reference, replacement = { value: 2 };
  assert.sameValue(cell.reference.deref(), target);
  cell.live = replacement;
  assert.sameValue(cell.reference.deref(), target);
  cell.reference = new WeakRef(cell.live);
  assert.sameValue(cell.reference.deref(), replacement);
  assert.sameValue(alias.deref(), target);
  assert.sameValue(cell.live, replacement);
  assert.sameValue(target === replacement, false);
}
