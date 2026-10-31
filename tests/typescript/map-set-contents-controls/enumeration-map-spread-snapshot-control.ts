/*---
description: Control for enumeration-map-spread-snapshot; use one collection type for every writer and reader.
features: [ts-map-set-contents, ts-contents-enumeration, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-unknown, ts-numbers, ts-strings, ts-null-undefined, ts-unsound-bivariance, ts-destructuring, ts-spread]
---*/
// Paired case: ../map-set-contents/enumeration-map-spread-snapshot.ts.
// Only the collection type is unified; writes, reads and expectations are unchanged.
function check(n: number): void {
  const map = new Map<string, number | string | undefined>([["zero", -0], ["nan", NaN], ["drop", n]]);
  const writer: Map<string, number | string | undefined> = map;
  writer.delete("drop"); writer.set("text", "value:" + n); writer.set("empty", undefined);
  const copy = [...map];
  writer.set("text", "changed:" + n); writer.delete("zero");
  const keys: string[] = [], values: unknown[] = [], types: string[] = [];
  for (const [key, value] of copy) { keys.push(key); values.push(value); types.push(typeof value); }
  assert.compareArray(keys, ["zero", "nan", "text", "empty"]);
  assert.compareArray(values, [-0, NaN, "value:" + n, undefined]);
  assert.compareArray(types, ["number", "number", "string", "undefined"]);
  assert.sameValue(copy.length, 4);
  assert.sameValue(map.size, 3);
  assert.sameValue(map.has("empty"), true); assert.sameValue<unknown>(map.get("empty"), undefined);
  assert.sameValue(map.has("missing"), false); assert.sameValue<unknown>(map.get("missing"), undefined);
}
for (const n of [2, 9, 40]) check(n);
