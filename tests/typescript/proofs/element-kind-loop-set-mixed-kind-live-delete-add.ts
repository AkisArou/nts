/*---
description: A live Set loop skips a deleted integer and visits the string appended in its place.
features: [ts-proof-element-kind, ts-route-loop, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-strings, ts-spread, ts-typeof-operator]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the live for-of deletes the unvisited 2 and appends one string on the visit to 1.
function read(items: Set<number | string>): number | string {
  const values = [...items];
  return values[values.length - 1];
}
function observe(n: number): number | string {
  const items = new Set<number | string>([1, 2]);
  let visits = 0;
  for (const value of items) {
    assert.sameValue(value, visits === 0 ? 1 : n > 0 ? "item:" + n : 2);
    visits++;
    if (value === 1 && n > 0) { items.delete(2); items.add("item:" + n); }
  }
  assert.sameValue(visits, 2);
  assert.sameValue(items.size, 2);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(typeof result, n > 0 ? "string" : "number");
  assert.sameValue(result, n > 0 ? "item:" + n : 2);
}
