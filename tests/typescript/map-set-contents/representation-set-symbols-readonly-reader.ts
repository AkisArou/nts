/*---
description: An unknown-element readonly Set view retains two same-description symbol identities and their insertion order.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-symbols, ts-spread, ts-arrow-functions]
---*/
// Write: Set<symbol>.add; read: a readonly unknown-element view.
// Node preserves the exact stored values, runtime kinds and insertion order.
function check(label: string): void {
  const first = Symbol(label), second = Symbol(label);
  const set = new Set<symbol>(); set.add(first); set.add(second); set.add(first);
  const reader: ReadonlySet<unknown> = set;
  assert.sameValue(reader.size, 2);
  assert.sameValue(reader.has(first), true); assert.sameValue(reader.has(second), true);
  assert.compareArray<unknown>([...reader], [first, second]);
  assert.compareArray([...reader].map(value => typeof value), ["symbol", "symbol"]);
}
for (const label of ["", "7", "contents"]) check(label);
