/*---
description: A caught throw leaves a fractional Map store visible to a later reader.
features: [ts-proof-element-kind, ts-route-exception, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-errors, ts-instanceof]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the try body writes then throws; node keeps the fraction after catch rather than restoring the initial integer.
function read(map: Map<string, number>): unknown { return map.get("item"); }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  let caught = false;
  try {
    if (n > 0) { map.set("item", n + 0.25); throw new Error("stored fraction"); }
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    assert.sameValue(error.message, "stored fraction");
    caught = true;
  }
  assert.sameValue(caught, n > 0);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(read(after(n)), n > 0 ? n + 0.25 : 7);
}
