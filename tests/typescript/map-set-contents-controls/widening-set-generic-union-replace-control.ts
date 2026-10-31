/*---
description: Control for widening-set-generic-union-replace; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-unions, ts-spread, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/widening-set-generic-union-replace.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
function write(set: Set<number | string>, remove: number | string, value: number | string): void {
  set.delete(remove);
  set.add(value);
}
function check(n: number): void {
  const set = new Set<number | string>([n, n + 1]);
  const text = "item:" + String(n);
  write(set, n, text);
  const values = [...set];
  assert.compareArray<unknown>(values, [n + 1, text]);
  assert.compareArray(values.map(value => typeof value), ["number", "string"]);
  assert.sameValue(set.has(n), false);
  for (const value of values) assert.sameValue(set.has(value), true);
  assert.sameValue(set.size, 2);
}
for (const n of [-3, 2, 7]) check(n);
