/*---
description: A nullish branch stores undefined while a non-null control bypasses the write.
features: [ts-proof-element-kind, ts-route-merge, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-null-undefined, ts-unions, ts-expressions]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the ?? right operand performs the undefined store; node keeps the existing entry in Array.from(map).
function read(map: Map<string, number>): unknown { return Array.from(map)[0][1]; }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const writable: Map<string, unknown> = map;
  const supplied: number | undefined = n > 0 ? undefined : 9;
  const result = supplied ?? (writable.set("item", undefined), 5);
  assert.sameValue(result, n > 0 ? 5 : 9);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const map = after(n);
  assert.sameValue(map.has("item"), true);
  assert.sameValue(map.size, 1);
  assert.sameValue(read(map), n > 0 ? undefined : 7);
  assert.sameValue(map.has("missing"), false);
}
