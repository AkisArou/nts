/*---
description: A finally block stores undefined while a numeric return is pending.
features: [ts-proof-element-kind, ts-route-exception, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-errors, ts-arrow-functions, ts-null-undefined]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the pending return still runs the widening finally store; node returns the ticket and preserves the present undefined entry.
function finish(map: Map<string, unknown>, n: number): number {
  try { return 9; }
  finally { if (n > 0) map.set("item", undefined); }
}
function read(map: Map<string, number>): unknown {
  let result: unknown = "missing entry";
  map.forEach((value, key) => { if (key === "item") result = value; });
  return result;
}
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  assert.sameValue(finish(map, n), 9);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const map = after(n);
  assert.sameValue(read(map), n > 0 ? undefined : 7);
  assert.sameValue(map.has("item"), true);
  assert.sameValue(map.size, 1);
  assert.sameValue(map.has("missing"), false);
}
