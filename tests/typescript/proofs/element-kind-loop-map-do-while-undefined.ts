/*---
description: A later do-while visit stores undefined without deleting the numeric Map entry.
features: [ts-proof-element-kind, ts-route-loop, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-destructuring, ts-null-undefined]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the second visit stores undefined; node keeps the key and size while entry iteration reads the actual undefined value.
function read(map: Map<string, number>): unknown {
  for (const [key, value] of map.entries()) if (key === "item") return value;
  return "missing entry";
}
function after(turns: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const writable: Map<string, unknown> = map;
  let turn = 0;
  do {
    if (turn === 1) writable.set("item", undefined);
    turn++;
  } while (turn < turns);
  return map;
}
for (const n of [0, 1, 2, 3, 7]) {
  const map = after(n);
  assert.sameValue(map.has("item"), true);
  assert.sameValue(map.has("missing"), false);
  assert.sameValue(map.size, 1);
  assert.sameValue(read(map), n > 1 ? undefined : 7);
}
