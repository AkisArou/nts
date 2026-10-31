/*---
description: Map keys() preserves live deletions, later additions and current size through differently typed writers and readers.
features: [ts-map-set-contents, ts-contents-enumeration, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-unknown, ts-numbers, ts-strings, ts-unsound-bivariance, ts-null-undefined]
---*/
// Write through a union map alias; read narrow keys(); node keeps actual types and complete order.
function check(n: number): void {
  const map = new Map<number, number>([[n, n], [n + 1, n + 1], [n + 2, -0]]);
  const writer: Map<number | string | undefined, number> = map;
  const seen: unknown[] = [], types: string[] = [], sizes: number[] = [];
  for (const value of map.keys()) {
    seen.push(value); types.push(typeof value); sizes.push(map.size);
    if (seen.length === 1) { writer.delete(n + 1); writer.set("late:" + n, n + 10); writer.set(n + 3, n + 3); }
  }
  assert.compareArray(seen, [n, n + 2, "late:" + n, n + 3]);
  assert.compareArray(types, ["number", "number", "string", "number"]);
  assert.compareArray(sizes, [3, 4, 4, 4]);
  assert.sameValue(map.size, 4);
  assert.sameValue(map.has(n + 1), false);
}
for (const n of [2, 9, 40]) check(n);
