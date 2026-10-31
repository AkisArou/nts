/*---
description: A readonly unknown-valued Map view distinguishes stored undefined from a missing key while preserving numeric payloads.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unknown, ts-unions, ts-null-undefined, ts-numbers, ts-spread]
---*/
// Write: Map<string, number | undefined>.set; read: a readonly unknown-valued view.
// Node preserves the exact stored values, runtime kinds and insertion order.
function check(n: number): void {
  const map = new Map<string, number | undefined>();
  map.set("present", undefined); map.set("number", n);
  const reader: ReadonlyMap<string, unknown> = map;
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
