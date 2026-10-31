/*---
description: Control for widening-set-class-field; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-class, ts-class-fields, ts-objects, ts-structural-typing, ts-unions, ts-spread, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/widening-set-class-field.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
class Holder {
  contents: Set<number | string>;
  constructor(contents: Set<number | string>) { this.contents = contents; }
}
function check(n: number): void {
  const holder = new Holder(new Set<number | string>([n]));
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
