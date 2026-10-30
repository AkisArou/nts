/*---
description: A fractional Set insertion survives the exception thrown immediately after it.
features: [ts-proof-element-kind, ts-route-exception, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-errors, ts-unknown, ts-instanceof]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the positive path inserts a fraction and then throws before reaching the common reader.
function read(items: Set<number>): number {
  let last = 0;
  for (const value of items) last = value;
  return last;
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  let caught = false;
  try {
    if (n > 0) { items.add(n + 0.5); throw new Error("inserted"); }
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    assert.sameValue(error.message, "inserted");
    caught = true;
  }
  assert.sameValue(caught, n > 0);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n > 0 ? n + 0.5 : 2);
}
