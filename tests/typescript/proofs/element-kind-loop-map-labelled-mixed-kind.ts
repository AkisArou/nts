/*---
description: A labelled loop exit preserves a string written into an initially numeric Map.
features: [ts-proof-element-kind, ts-route-loop, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-spread, ts-typeof-operator, ts-strings]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the inner loop widens the entry before breaking both loops; node reads the string through a spread of the original values.
function read(map: Map<string, number>): unknown { return [...map.values()][0]; }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const writable: Map<string, unknown> = map;
  outer: for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      if (n > 0 && i === 1 && j === 0) {
        writable.set("item", "loop:" + n);
        break outer;
      }
    }
  }
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const value = read(after(n));
  assert.sameValue(value, n > 0 ? "loop:" + n : 7);
  assert.sameValue(typeof value, n > 0 ? "string" : "number");
}
