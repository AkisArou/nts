/*---
description: Control for widening-set-readonly-live-view; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unions, ts-spread, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/widening-set-readonly-live-view.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
function check(n: number): void {
  const mutable = new Set<number | string>([n, n + 1]);
  const view: Set<number | string> = mutable;
  const writer: Set<number | string> = mutable;
  const text = "item:" + String(n);
  writer.add(text);
  assert.compareArray<unknown>([...view], [n, n + 1, text]);
  writer.delete(text);
  writer.delete(n);
  writer.add(text);
  writer.add(n);
  const values = [...view];
  assert.compareArray<unknown>(values, [n + 1, text, n]);
  assert.compareArray(values.map(value => typeof value), ["number", "string", "number"]);
  assert.sameValue(view.size, 3);
  for (const value of values) assert.sameValue(view.has(value), true);
}
for (const n of [-3, 2, 7]) check(n);
