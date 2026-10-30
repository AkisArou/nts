/*---
description: A finally block stores a wide Set value while an exception unwinds to the caller.
features: [ts-proof-element-kind, ts-route-exception, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-spread, ts-errors, ts-unknown, ts-instanceof]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: the wide add occurs in finally after throw and before the caller catches the same error.
function read(items: Set<number>): number {
  const values = [...items];
  return values[values.length - 1];
}
function insert(items: Set<number>, n: number): void {
  try { if (n > 0) throw new Error("unwind"); }
  finally { if (n > 0) items.add(4294967296 + n); }
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  let caught = false;
  try { insert(items, n); }
  catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    assert.sameValue(error.message, "unwind");
    caught = true;
  }
  assert.sameValue(caught, n > 0);
  return read(items);
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n > 0 ? 4294967296 + n : 2);
}
