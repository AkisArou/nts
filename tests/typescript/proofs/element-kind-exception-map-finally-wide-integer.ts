/*---
description: A finally block widens a Map value after a caught exception.
features: [ts-proof-element-kind, ts-route-exception, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-errors, ts-spread, ts-instanceof]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the finally store runs after catch; node retains the exact wide value in a spread of the original values.
function read(map: Map<string, number>): unknown { return [...map.values()][0]; }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  let caught = false;
  try {
    if (n > 0) throw new Error("run finally");
  } catch (error: unknown) {
    if (!(error instanceof Error)) throw error;
    assert.sameValue(error.message, "run finally");
    caught = true;
  } finally {
    if (n > 0) map.set("item", 1099511627776 + n);
  }
  assert.sameValue(caught, n > 0);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  assert.sameValue(read(after(n)), n > 0 ? 1099511627776 + n : 7);
}
