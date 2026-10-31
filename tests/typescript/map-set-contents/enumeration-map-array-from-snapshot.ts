/*---
description: A Map array-from snapshot keeps mixed types and order after its source changes.
features: [ts-map-set-contents, ts-contents-enumeration, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-unknown, ts-numbers, ts-strings, ts-null-undefined, ts-unsound-bivariance, ts-destructuring]
---*/
// Write a union alias, copy the narrow map; node preserves a separate ordered snapshot including zero, NaN and undefined.
function check(n: number): void {
  const map = new Map<string, number>([["zero", -0], ["nan", NaN], ["drop", n]]);
  const writer: Map<string, number | string | undefined> = map;
  writer.delete("drop"); writer.set("text", "value:" + n); writer.set("empty", undefined);
  const copy = Array.from(map);
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
