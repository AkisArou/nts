/*---
description: Set keys() preserves live deletions, later additions and current size through differently typed writers and readers.
features: [ts-map-set-contents, ts-contents-enumeration, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-unknown, ts-numbers, ts-strings, ts-unsound-bivariance, ts-null-undefined]
---*/
// Write through a union set alias; read narrow keys(); node keeps actual types and complete order.
function check(n: number): void {
  const set = new Set<number>([n, n + 1, -0]);
  const writer: Set<number | string | undefined> = set;
  const seen: unknown[] = [], types: string[] = [], sizes: number[] = [];
  for (const value of set.keys()) {
    seen.push(value); types.push(typeof value); sizes.push(set.size);
    if (seen.length === 1) { writer.delete(n + 1); writer.add("late:" + n); writer.add(undefined); }
  }
  assert.compareArray(seen, [n, 0, "late:" + n, undefined]);
  assert.compareArray(types, ["number", "number", "string", "undefined"]);
  assert.compareArray(sizes, [3, 4, 4, 4]);
  assert.sameValue(set.size, 4);
  assert.sameValue(set.has(n + 1), false);
  assert.sameValue(writer.has(undefined), true);
}
for (const n of [2, 9, 40]) check(n);
