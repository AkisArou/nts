/*---
description: A default-parameter call stores undefined in an existing numeric Map entry.
features: [ts-proof-element-kind, ts-route-call, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-default-parameters, ts-arrow-functions, ts-null-undefined]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the omitted parameter invokes the writer; node retains the key and the undefined value in Map.forEach.
function write(map: Map<string, unknown>, n: number): number {
  if (n > 0) map.set("item", undefined);
  return 3;
}
function invoke(map: Map<string, number>, n: number, ticket = write(map, n)): number { return ticket; }
function read(map: Map<string, number>): unknown {
  let result: unknown = "missing entry";
  map.forEach((value, key) => { if (key === "item") result = value; });
  return result;
}
function after(n: number, supplied: boolean): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  assert.sameValue(invoke(map, n, supplied ? 9 : undefined), supplied ? 9 : 3);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const map = after(n, false);
  assert.sameValue(map.has("item"), true);
  assert.sameValue(map.size, 1);
  assert.sameValue(read(map), n > 0 ? undefined : 7);
  assert.sameValue(read(after(n, true)), 7);
}
