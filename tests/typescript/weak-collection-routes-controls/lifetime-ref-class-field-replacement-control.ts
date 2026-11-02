/*---
description: Control for lifetime-ref-class-field-replacement using a plain target holder in the same class fields.
features: [ts-weak-collection-routes, ts-weak-collection-route-lifetime, ts-class, ts-class-fields, ts-objects, ts-arrays, ts-functions, ts-iteration]
---*/
// Plain holders cross the same class field and alias; node returns the original target from the alias and the replacement from the new holder.
class Item { value: number; constructor(value: number) { this.value = value; } }
class RefCell {
  live: object;
  reference: { target: object };
  constructor(target: object) { this.live = target; this.reference = { target }; }
}
const shared = { value: 1 };
const targets: object[] = [shared, shared, { value: 1 }, [1], () => 1, new Item(1)];
for (const target of targets) {
  const cell = new RefCell(target), alias = cell.reference, replacement = { value: 2 };
  assert.sameValue(cell.reference.target, target);
  cell.live = replacement;
  assert.sameValue(cell.reference.target, target);
  cell.reference = { target: cell.live };
  assert.sameValue(cell.reference.target, replacement);
  assert.sameValue(alias.target, target);
  assert.sameValue(cell.live, replacement);
  assert.sameValue(target === replacement, false);
}
