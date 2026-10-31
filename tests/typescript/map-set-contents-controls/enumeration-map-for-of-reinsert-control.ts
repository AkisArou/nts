/*---
description: Control for enumeration-map-for-of-reinsert; use one collection type for every writer and reader.
features: [ts-map-set-contents, ts-contents-enumeration, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-unknown, ts-numbers, ts-strings, ts-unsound-bivariance, ts-destructuring]
---*/
// Paired case: ../map-set-contents/enumeration-map-for-of-reinsert.ts.
// Only the collection type is unified; writes, reads and expectations are unchanged.
function check(n: number): void {
  const map = new Map<string, number | string>([["zero", -0], ["item", n], ["nan", NaN], ["other", n + 1]]);
  const writer: Map<string, number | string> = map;
  writer.delete("item"); writer.set("item", "late:" + n); writer.delete("nan"); writer.set("nan", NaN);
  const seen: unknown[] = [], types: string[] = [], sizes: number[] = [];
  const keys: string[] = [];
  for (const [key, value] of map) {
    seen.push(value); types.push(typeof value); sizes.push(map.size);
    keys.push(key);
  }
  assert.compareArray(seen, [-0, n + 1, "late:" + n, NaN]);
  assert.compareArray(types, ["number", "number", "string", "number"]);
  assert.compareArray(sizes, [4, 4, 4, 4]);
  assert.compareArray(keys, ["zero", "other", "item", "nan"]);
  assert.sameValue(map.size, 4);
  assert.sameValue(map.has("item"), true);
}
for (const n of [2, 9, 40]) check(n);
