/*---
description: Unknown Set writes retain distinct string and undefined members through a numeric view.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-null-undefined, ts-spread, ts-arrow-functions]
---*/
// Write/read route: a Set<unknown> parameter adds a string and undefined, then the numeric Set reads both; node keeps the exact contents and order.
function write(set: Set<unknown>, value: unknown): void { set.add(value); }
function check(n: number): void {
  const set = new Set<number>([n]);
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
