/*---
description: Control for representation-map-undefined-readonly-reader; reader and writer use one concrete collection type.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-unions, ts-null-undefined, ts-numbers, ts-spread]
---*/
// Paired case: ../map-set-contents/representation-map-undefined-readonly-reader.ts.
// Only the reader annotation changes; all runtime operations and checks are identical.
function check(n: number): void {
  const map = new Map<string, number | undefined>();
  map.set("present", undefined); map.set("number", n);
  const reader: Map<string, number | undefined> = map;
  assert.sameValue(reader.get("present"), undefined);
  assert.sameValue(typeof reader.get("present"), "undefined");
  assert.sameValue(reader.has("present"), true);
  assert.sameValue(reader.get("missing"), undefined);
  assert.sameValue(typeof reader.get("missing"), "undefined");
  assert.sameValue(reader.has("missing"), false);
  assert.sameValue(reader.get("number"), n);
  assert.sameValue(typeof reader.get("number"), "number");
  assert.sameValue(reader.size, 2);
  assert.compareArray([...reader.keys()], ["present", "number"]);
  assert.compareArray<unknown>([...reader.values()], [undefined, n]);
}
for (const n of [-0, 0, 7]) check(n);
