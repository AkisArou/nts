/*---
description: Readonly array values read through a readonly Map retain array identity, live length, negative zero and NaN.
features: [ts-map-set-contents, ts-contents-representation, ts-map-set, ts-readonly, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-numbers, ts-spread]
---*/
// Write: Map<string, number[]>.set; read: a readonly Map with readonly array values.
// Node preserves the exact stored values, runtime kinds and insertion order.
function check(n: number): void {
  const first = [n, -0, NaN], second = [n + 1];
  const map = new Map<string, number[]>();
  map.set("first", first); map.set("second", second);
  const reader: ReadonlyMap<string, readonly number[]> = map;
  first.push(n + 2);
  const value = reader.get("first");
  assert.sameValue(typeof value, "object");
  if (value === undefined) throw new Test262Error("array required");
  assert.sameValue(value, first); assert.sameValue(Array.isArray(value), true);
  assert.sameValue(value.length, 4);
  assert.compareArray(value, [n, -0, NaN, n + 2]);
  assert.sameValue(reader.size, 2);
  assert.compareArray([...reader.keys()], ["first", "second"]);
  assert.compareArray<unknown>([...reader.values()], [first, second]);
}
for (const n of [-3, 0, 7]) check(n);
