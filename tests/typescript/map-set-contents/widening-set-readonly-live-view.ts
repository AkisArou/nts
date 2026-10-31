/*---
description: A readonly numeric Set view observes deleting and reinserting a string through a union alias.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-readonly, ts-unions, ts-spread, ts-arrow-functions]
---*/
// Write/read route: a mutable union alias adds and removes strings read from a ReadonlySet<number>; node keeps the exact contents and order.
function check(n: number): void {
  const mutable = new Set<number>([n, n + 1]);
  const view: ReadonlySet<number> = mutable;
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
