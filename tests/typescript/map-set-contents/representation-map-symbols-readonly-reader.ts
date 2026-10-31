/*---
description: An unknown-valued readonly Map view keeps the identities of two symbols with equal descriptions.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-symbols, ts-spread]
---*/
// Write: Map<string, symbol>.set; read: a readonly unknown-valued view.
// Node preserves the exact stored values, runtime kinds and insertion order.
function check(label: string): void {
  const first = Symbol(label), second = Symbol(label);
  const map = new Map<string, symbol>();
  map.set("first", first); map.set("second", second);
  const reader: ReadonlyMap<string, unknown> = map;
  assert.sameValue(reader.get("first"), first); assert.sameValue(reader.get("second"), second);
  assert.notSameValue(reader.get("first"), reader.get("second"));
  assert.sameValue(typeof reader.get("first"), "symbol");
  assert.sameValue(typeof reader.get("second"), "symbol");
  assert.sameValue(reader.size, 2);
  assert.compareArray([...reader.keys()], ["first", "second"]);
  assert.compareArray<unknown>([...reader.values()], [first, second]);
}
for (const label of ["", "7", "contents"]) check(label);
