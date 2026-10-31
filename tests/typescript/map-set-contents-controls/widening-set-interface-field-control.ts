/*---
description: Control for widening-set-interface-field; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-interfaces, ts-objects, ts-structural-typing, ts-unions, ts-spread, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/widening-set-interface-field.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
interface Holder { contents: Set<number | string>; }
interface Writer { contents: Set<number | string>; }
function check(n: number): void {
  const holder: Holder = { contents: new Set<number | string>([n]) };
  const writer: Writer = holder;
  const text = "item:" + String(n);
  writer.contents.add(text);
  const values = [...holder.contents];
  assert.compareArray<unknown>(values, [n, text]);
  assert.compareArray(values.map(value => typeof value), ["number", "string"]);
  for (const value of values) assert.sameValue(holder.contents.has(value), true);
  assert.sameValue(holder.contents.size, 2);
}
for (const n of [-3, 2, 7]) check(n);
