/*---
description: Control for representation-map-symbols-readonly-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-symbols, ts-spread]
---*/
// Paired case: ../map-set-contents/representation-map-symbols-readonly-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function check(label: string): void {
  const first = Symbol(label), second = Symbol(label);
  const map = new Map<string, symbol>();
  map.set("first", first); map.set("second", second);
  const reader: Map<string, symbol> = map;
  assert.sameValue(reader.get("first"), first); assert.sameValue(reader.get("second"), second);
  assert.notSameValue(reader.get("first"), reader.get("second"));
  assert.sameValue(typeof reader.get("first"), "symbol");
  assert.sameValue(typeof reader.get("second"), "symbol");
  assert.sameValue(reader.size, 2);
  assert.compareArray([...reader.keys()], ["first", "second"]);
  assert.compareArray<unknown>([...reader.values()], [first, second]);
}
for (const label of ["", "7", "contents"]) check(label);
