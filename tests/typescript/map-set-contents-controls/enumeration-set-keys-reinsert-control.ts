/*---
description: Control for enumeration-set-keys-reinsert; use one collection type for every writer and reader.
features: [ts-map-set-contents, ts-contents-enumeration, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-unknown, ts-numbers, ts-strings, ts-unsound-bivariance]
---*/
// Paired case: ../map-set-contents/enumeration-set-keys-reinsert.ts.
// Only the collection type is unified; writes, reads and expectations are unchanged.
function check(n: number): void {
  const set = new Set<number | string>([n, NaN, -0, n + 1]);
  const writer: Set<number | string> = set;
  writer.delete(n); writer.add("late:" + n); writer.add(n); writer.delete(NaN); writer.add(NaN);
  const seen: unknown[] = [], types: string[] = [], sizes: number[] = [];
  for (const value of set.keys()) {
    seen.push(value); types.push(typeof value); sizes.push(set.size);
  }
  assert.compareArray(seen, [0, n + 1, "late:" + n, n, NaN]);
  assert.compareArray(types, ["number", "number", "string", "number", "number"]);
  assert.compareArray(sizes, [5, 5, 5, 5, 5]);
  assert.sameValue(set.size, 5);
  assert.sameValue(set.has(NaN), true);
}
for (const n of [2, 9, 40]) check(n);
