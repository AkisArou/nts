/*---
description: A catch edge inserts a string derived from a narrowed thrown value into an initially numeric Set.
features: [ts-proof-element-kind, ts-route-exception, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-unions, ts-strings, ts-spread, ts-errors, ts-unknown, ts-narrowing, ts-typeof-operator]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: only the catch path, after narrowing the thrown unknown, adds the string.
function read(items: Set<number | string>): number | string {
  const values = [...items];
  return values[values.length - 1];
}
function observe(n: number): number | string {
  const items = new Set<number | string>([1, 2]);
  let caught = false;
  try { if (n > 0) throw n; }
  catch (error: unknown) {
    if (typeof error !== "number") throw error;
    items.add("caught:" + error);
    caught = true;
  }
  assert.sameValue(caught, n > 0);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(typeof result, n > 0 ? "string" : "number");
  assert.sameValue(result, n > 0 ? "caught:" + n : 2);
}
