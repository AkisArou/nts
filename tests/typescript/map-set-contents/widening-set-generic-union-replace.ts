/*---
description: A generic union writer replaces a numeric Set member with a string through the same entry route.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-unions, ts-spread, ts-arrow-functions]
---*/
// Write/read route: a generic number|string writer removes and adds members read from a numeric Set; node keeps the exact contents and order.
function write<V>(set: Set<V>, remove: V, value: V): void {
  set.delete(remove);
  set.add(value);
}
function check(n: number): void {
  const set = new Set<number>([n, n + 1]);
  const text = "item:" + String(n);
  write<number | string>(set, n, text);
  const values = [...set];
  assert.compareArray<unknown>(values, [n + 1, text]);
  assert.compareArray(values.map(value => typeof value), ["number", "string"]);
  assert.sameValue(set.has(n), false);
  for (const value of values) assert.sameValue(set.has(value), true);
  assert.sameValue(set.size, 2);
}
for (const n of [-3, 2, 7]) check(n);
