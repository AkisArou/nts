/*---
description: Each instance's `accessor` storage is initialised separately, in field order with the plain fields.
features: [ts-accessor-fields, ts-class, ts-class-fields]
---*/
const order: string[] = [];
function note(label: string, value: number): number {
  order.push(label);
  return value;
}
class Counter {
  before = note("before", 1);
  accessor count = note("count", 10);
  after = note("after", 2);
}
const a = new Counter();
const b = new Counter();
a.count++;
assert.sameValue(a.count, 11);
assert.sameValue(b.count, 10);
assert.compareArray(order, ["before", "count", "after", "before", "count", "after"]);
