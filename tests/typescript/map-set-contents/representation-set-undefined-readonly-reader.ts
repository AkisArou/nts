/*---
description: A readonly unknown-element Set view distinguishes an undefined member from its later absence.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-unions, ts-null-undefined, ts-numbers, ts-spread, ts-arrow-functions]
---*/
// Write: Set<number | undefined>.add and delete; read: a readonly unknown-element view.
// Node preserves the exact stored values, runtime kinds and insertion order.
function check(n: number): void {
  const set = new Set<number | undefined>(); set.add(n); set.add(undefined);
  const reader: ReadonlySet<unknown> = set;
  assert.sameValue(reader.size, 2); assert.sameValue(reader.has(undefined), true);
  assert.compareArray<unknown>([...reader], [n === 0 ? 0 : n, undefined]);
  assert.compareArray([...reader].map(value => typeof value), ["number", "undefined"]);
  assert.sameValue(set.delete(undefined), true);
  assert.sameValue(reader.has(undefined), false); assert.sameValue(reader.size, 1);
  assert.compareArray<unknown>([...reader], [n === 0 ? 0 : n]);
}
for (const n of [-0, 0, 7]) check(n);
