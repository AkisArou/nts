/*---
description: A union-typed Set writer deletes and reinserts a numeric member around a string.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-spread, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Write/read route: a Set<number | string> parameter writes, then the numeric Set enumerates; node keeps the exact contents and order.
function write(set: Set<number | string>, n: number, text: string): void {
  set.delete(n);
  set.add(text);
  set.add(n);
}
function check(n: number): void {
  const set = new Set<number>([n, n + 1]);
  const text = "value:" + String(n);
  write(set, n, text);
  const values = [...set.values()];
  assert.compareArray<unknown>(values, [n + 1, text, n]);
  assert.compareArray(values.map(value => typeof value), ["number", "string", "number"]);
  assert.sameValue(set.size, 3);
  for (const value of values) assert.sameValue(set.has(value), true);
  assert.sameValue(set.has(n + 2), false);
}
for (const n of [-3, 2, 7]) check(n);
