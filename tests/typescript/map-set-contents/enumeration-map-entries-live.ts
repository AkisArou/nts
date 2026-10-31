/*---
description: Map entries() preserves live deletions, later additions and current size through differently typed writers and readers.
features: [ts-map-set-contents, ts-contents-enumeration, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-arrays, ts-unions, ts-unknown, ts-numbers, ts-strings, ts-unsound-bivariance, ts-null-undefined, ts-destructuring]
---*/
// Write through a union map alias; read narrow entries(); node keeps actual types and complete order.
function check(n: number): void {
  const map = new Map<string, number>([["first", n], ["gone", n + 1], ["zero", -0]]);
  const writer: Map<string, number | string | undefined> = map;
  const seen: unknown[] = [], types: string[] = [], sizes: number[] = [];
  const keys: string[] = [];
  for (const [key, value] of map.entries()) {
    seen.push(value); types.push(typeof value); sizes.push(map.size);
    keys.push(key);
    if (seen.length === 1) { writer.delete("gone"); writer.set("late", "late:" + n); writer.set("empty", undefined); }
  }
  assert.compareArray(seen, [n, -0, "late:" + n, undefined]);
  assert.compareArray(types, ["number", "number", "string", "undefined"]);
  assert.compareArray(sizes, [3, 4, 4, 4]);
  assert.compareArray(keys, ["first", "zero", "late", "empty"]);
  assert.sameValue(map.size, 4);
  assert.sameValue(map.has("gone"), false);
  assert.sameValue(map.has("empty"), true);
  assert.sameValue<unknown>(map.get("empty"), undefined);
  assert.sameValue(map.has("missing"), false);
  assert.sameValue<unknown>(map.get("missing"), undefined);
}
for (const n of [2, 9, 40]) check(n);
