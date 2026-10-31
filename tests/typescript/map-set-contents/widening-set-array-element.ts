/*---
description: A widened array element writes string contents later read through the original numeric Set.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-spread, ts-arrow-functions]
---*/
// Write/read route: a widened array element writes and its original narrow holder reads; node keeps the exact contents and order.
function check(n: number): void {
  const holders: Set<number>[] = [new Set<number>([n])];
  const writers: Set<number | string>[] = holders;
  const text = "item:" + String(n);
  writers[0].add(text);
  const values = [...holders[0]];
  assert.compareArray<unknown>(values, [n, text]);
  assert.compareArray(values.map(value => typeof value), ["number", "string"]);
  for (const value of values) assert.sameValue(holders[0].has(value), true);
  assert.sameValue(holders[0].size, 2);
}
for (const n of [-3, 2, 7]) check(n);
