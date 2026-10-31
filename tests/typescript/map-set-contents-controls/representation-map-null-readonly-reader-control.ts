/*---
description: Control for representation-map-null-readonly-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-unions, ts-null-undefined, ts-numbers, ts-spread]
---*/
// Paired case: ../map-set-contents/representation-map-null-readonly-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function check(n: number): void {
  const map = new Map<string, number | null>();
  map.set("null", null); map.set("number", n);
  const reader: Map<string, number | null> = map;
  assert.sameValue(reader.get("null"), null); assert.sameValue(typeof reader.get("null"), "object");
  assert.sameValue(reader.has("null"), true);
  assert.sameValue(reader.get("missing"), undefined); assert.sameValue(reader.has("missing"), false);
  assert.sameValue(reader.get("number"), n); assert.sameValue(typeof reader.get("number"), "number");
  assert.sameValue(reader.size, 2);
  assert.compareArray([...reader.keys()], ["null", "number"]);
  assert.compareArray<unknown>([...reader.values()], [null, n]);
}
for (const n of [-0, NaN, 7]) check(n);
