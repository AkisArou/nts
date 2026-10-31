/*---
description: Control for enumeration-map-values-live; use one collection type for every writer and reader.
features: [ts-map-set-contents, ts-contents-enumeration, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-unknown, ts-numbers, ts-strings, ts-unsound-bivariance, ts-null-undefined]
---*/
// Paired case: ../map-set-contents/enumeration-map-values-live.ts.
// Only the collection type is unified; writes, reads and expectations are unchanged.
function check(n: number): void {
  const map = new Map<string, number | string | undefined>([["first", n], ["gone", n + 1], ["zero", -0]]);
  const writer: Map<string, number | string | undefined> = map;
  const seen: unknown[] = [], types: string[] = [], sizes: number[] = [];
  for (const value of map.values()) {
    seen.push(value); types.push(typeof value); sizes.push(map.size);
    if (seen.length === 1) { writer.delete("gone"); writer.set("late", "late:" + n); writer.set("empty", undefined); }
  }
  assert.compareArray(seen, [n, -0, "late:" + n, undefined]);
  assert.compareArray(types, ["number", "number", "string", "undefined"]);
  assert.compareArray(sizes, [3, 4, 4, 4]);
  assert.sameValue(map.size, 4);
  assert.sameValue(map.has("gone"), false);
  assert.sameValue(map.has("empty"), true);
  assert.sameValue<unknown>(map.get("empty"), undefined);
  assert.sameValue(map.has("missing"), false);
  assert.sameValue<unknown>(map.get("missing"), undefined);
}
for (const n of [2, 9, 40]) check(n);
