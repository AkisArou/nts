/*---
description: "indexOf returns the right strict-equality result for dense empty and singleton arrays. (control)"
features: [ts-array-method-routes, ts-array-method-route-reads, ts-arrays, ts-functions, ts-iteration, ts-numbers, ts-map-set, ts-type-aliases, ts-unions, ts-strings, ts-null-undefined, ts-readonly, ts-tuples, ts-destructuring, ts-narrowing]
---*/

function localIndexOf<T>(items: readonly T[], value: T, from: number = 0): number {
  if (from === Infinity) return -1;
  const whole = from !== from || from === -Infinity ? 0 : from - from % 1;
  let start = whole < 0 ? items.length + whole : whole;
  if (start < 0) start = 0;
  for (let index = start; index < items.length; index++) if (items[index] === value) return index;
  return -1;
}
// indexOf returns the right strict-equality result for dense empty and singleton arrays. Route: guarded Map.get reads of named union arrays. Node prints reads-index-of-map-boundaries:ok.
type SearchValue = number | string | null | undefined;
const groups: Map<string, readonly SearchValue[]> = new Map<string, readonly SearchValue[]>([
  ["empty", []], ["zero", [0]], ["nan", [NaN]], ["text", ["x"]], ["null", [null]], ["undefined", [undefined]]
]);
const rows: readonly [string, SearchValue, number][] = [["empty", undefined, -1], ["zero", -0, 0], ["nan", NaN, -1], ["text", "x", 0], ["null", null, 0], ["undefined", undefined, 0]];
for (const [key, needle, expected] of rows) {
  const items = groups.get(key); assert.sameValue(items === undefined, false);
  if (items !== undefined) {
    const found = localIndexOf(items, needle);
    assert.sameValue(found, expected);
  }
}
console.log("reads-index-of-map-boundaries:ok");
