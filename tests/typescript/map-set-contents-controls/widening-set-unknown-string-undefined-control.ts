/*---
description: Control for widening-set-unknown-string-undefined; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-null-undefined, ts-spread, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/widening-set-unknown-string-undefined.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
function write(set: Set<unknown>, value: unknown): void { set.add(value); }
function check(n: number): void {
  const set = new Set<unknown>([n]);
  const text = "item:" + String(n);
  write(set, text);
  write(set, undefined);
  const values = [...set];
  assert.compareArray<unknown>(values, [n, text, undefined]);
  assert.compareArray(values.map(value => typeof value), ["number", "string", "undefined"]);
  assert.sameValue(set.size, 3);
  for (const value of values) assert.sameValue(set.has(value), true);
  assert.sameValue(set.has(n + 1), false);
}
for (const n of [-3, 2, 7]) check(n);
