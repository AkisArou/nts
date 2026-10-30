/*---
description: A catch block writes a string through a widened Map parameter view.
features: [ts-proof-element-kind, ts-route-exception, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-errors, ts-destructuring, ts-strings, ts-typeof-operator]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the thrown marker selects the catch writer; node retains the string when the original numeric Map is traversed.
function read(map: Map<string, number>): unknown {
  for (const [key, value] of map) if (key === "item") return value;
  return undefined;
}
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  try {
    if (n > 0) throw "widen";
  } catch (error: unknown) {
    if (error !== "widen") throw error;
    const writable: Map<string, unknown> = map;
    writable.set("item", "caught:" + n);
  }
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const value = read(after(n));
  assert.sameValue(value, n > 0 ? "caught:" + n : 7);
  assert.sameValue(typeof value, n > 0 ? "string" : "number");
}
