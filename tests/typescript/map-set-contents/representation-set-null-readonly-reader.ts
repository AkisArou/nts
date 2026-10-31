/*---
description: A readonly unknown-element Set view retains null as a member alongside numeric payloads.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-unions, ts-null-undefined, ts-numbers, ts-spread, ts-arrow-functions]
---*/
// Write: Set<number | null>.add; read: a readonly unknown-element view.
// Node preserves the exact stored values, runtime kinds and insertion order.
function check(n: number): void {
  const set = new Set<number | null>(); set.add(n); set.add(null);
  const reader: ReadonlySet<unknown> = set;
  assert.sameValue(reader.size, 2); assert.sameValue(reader.has(null), true);
  assert.compareArray<unknown>([...reader], [n === 0 ? 0 : n, null]);
  assert.compareArray([...reader].map(value => typeof value), ["number", "object"]);
}
for (const n of [-0, NaN, 7]) check(n);
