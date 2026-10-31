/*---
description: Control for enumeration-map-keys-reinsert; use one collection type for every writer and reader.
features: [ts-map-set-contents, ts-contents-enumeration, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-unknown, ts-numbers, ts-strings, ts-unsound-bivariance]
---*/
// Paired case: ../map-set-contents/enumeration-map-keys-reinsert.ts.
// Only the collection type is unified; writes, reads and expectations are unchanged.
function check(n: number): void {
  const map = new Map<number | string, number>([[n, n], [n + 1, n + 1], [NaN, -0]]);
  const writer: Map<number | string, number> = map;
  writer.delete(n); writer.set("late:" + n, n + 10); writer.set(n, n); writer.delete(NaN); writer.set(NaN, -0);
  const seen: unknown[] = [], types: string[] = [], sizes: number[] = [];
  for (const value of map.keys()) {
    seen.push(value); types.push(typeof value); sizes.push(map.size);
  }
  assert.compareArray(seen, [n + 1, "late:" + n, n, NaN]);
  assert.compareArray(types, ["number", "string", "number", "number"]);
  assert.compareArray(sizes, [4, 4, 4, 4]);
  assert.sameValue(map.size, 4);
  assert.sameValue(map.has(NaN), true);
}
for (const n of [2, 9, 40]) check(n);
