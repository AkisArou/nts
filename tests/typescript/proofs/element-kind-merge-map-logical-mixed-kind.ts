/*---
description: A short-circuit branch stores an object into an initially numeric Map.
features: [ts-proof-element-kind, ts-route-merge, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-class, ts-class-fields, ts-objects, ts-instanceof]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the right side of && widens the entry; node retains the Token instance and its numeric payload after the join.
class Token {
  code: number;
  constructor(code: number) { this.code = code; }
}
function read(map: Map<string, number>): unknown { return map.get("item"); }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const writable: Map<string, unknown> = map;
  n > 0 && writable.set("item", new Token(n));
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const value = read(after(n));
  assert.sameValue(value instanceof Token, n > 0);
  if (value instanceof Token) assert.sameValue(value.code, n);
  else assert.sameValue(value, 7);
}
