/*---
description: String conversion in a computed key inserts a wide Set entry before the property value reads it.
features: [ts-proof-element-kind, ts-route-conversion, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-conversions, ts-to-primitive, ts-to-string, ts-computed-keys, ts-objects, ts-closures]
---*/
// Fact: only small integers are initially stored; all writers must license narrowing (docs/language/types.md, Decisions).
// Route: String(key) invokes toString while computing the property key, before its value expression.
function read(items: Set<number>): number {
  let last = 0;
  for (const value of items) last = value;
  return last;
}
function observe(n: number): number {
  const items = new Set<number>([1, 2]);
  const key = {
    toString(): string { if (n > 0) items.add(4294967296 + n); return "last"; }
  };
  const snapshot = { [String(key)]: read(items) };
  assert.sameValue("last" in snapshot, true);
  return snapshot.last;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const result = observe(n);
  assert.sameValue(result, n > 0 ? 4294967296 + n : 2);
}
