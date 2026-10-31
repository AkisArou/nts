/*---
description: An unknown-element readonly view reads both booleans and their input-dependent Set order.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-spread, ts-arrow-functions]
---*/
// Write: Set<boolean>.add; read: a readonly unknown-element view.
// Node preserves the exact stored values, runtime kinds and insertion order.
function check(flag: boolean): void {
  const set = new Set<boolean>();
  set.add(flag); set.add(!flag);
  const reader: ReadonlySet<unknown> = set;
  assert.sameValue(reader.size, 2);
  assert.sameValue(reader.has(flag), true);
  assert.compareArray<unknown>([...reader], [flag, !flag]);
  assert.compareArray([...reader].map(value => typeof value), ["boolean", "boolean"]);
}
for (const flag of [false, true]) check(flag);
