/*---
description: A readonly unknown-valued Map view preserves null separately from a missing value and a numeric payload.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-unions, ts-null-undefined, ts-numbers, ts-spread]
---*/
// Write: Map<string, number | null>.set; read: a readonly unknown-valued view.
// Node preserves the exact stored values, runtime kinds and insertion order.
function check(n: number): void {
  const map = new Map<string, number | null>();
  map.set("null", null); map.set("number", n);
  const reader: ReadonlyMap<string, unknown> = map;
  assert.sameValue(reader.get("null"), null); assert.sameValue(typeof reader.get("null"), "object");
  assert.sameValue(reader.has("null"), true);
  assert.sameValue(reader.get("missing"), undefined); assert.sameValue(reader.has("missing"), false);
  assert.sameValue(reader.get("number"), n); assert.sameValue(typeof reader.get("number"), "number");
  assert.sameValue(reader.size, 2);
  assert.compareArray([...reader.keys()], ["null", "number"]);
  assert.compareArray<unknown>([...reader.values()], [null, n]);
}
for (const n of [-0, NaN, 7]) check(n);
