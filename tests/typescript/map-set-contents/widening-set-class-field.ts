/*---
description: A widened class field writes string contents later read through the original numeric Set.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-class, ts-class-fields, ts-objects, ts-structural-typing, ts-unions, ts-spread, ts-arrow-functions]
---*/
// Write/read route: a widened class field writes and its original narrow holder reads; node keeps the exact contents and order.
class Holder {
  contents: Set<number>;
  constructor(contents: Set<number>) { this.contents = contents; }
}
function check(n: number): void {
  const holder = new Holder(new Set<number>([n]));
  const writer: { contents: Set<number | string> } = holder;
  const text = "item:" + String(n);
  writer.contents.add(text);
  const values = [...holder.contents];
  assert.compareArray<unknown>(values, [n, text]);
  assert.compareArray(values.map(value => typeof value), ["number", "string"]);
  for (const value of values) assert.sameValue(holder.contents.has(value), true);
  assert.sameValue(holder.contents.size, 2);
}
for (const n of [-3, 2, 7]) check(n);
