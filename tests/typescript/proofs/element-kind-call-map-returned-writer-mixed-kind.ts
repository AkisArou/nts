/*---
description: A returned closure writes an object into an initially numeric Map.
features: [ts-proof-element-kind, ts-route-call, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-class, ts-class-fields, ts-objects, ts-closures, ts-arrow-functions, ts-function-types, ts-instanceof]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the factory returns the widening writer; node preserves the Token object through the original .get reader.
class Token {
  code: number;
  constructor(code: number) { this.code = code; }
}
function makeWriter(map: Map<string, unknown>, n: number): () => void {
  return () => { if (n > 0) map.set("item", new Token(n)); };
}
function read(map: Map<string, number>): unknown { return map.get("item"); }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const write = makeWriter(map, n);
  write();
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const value = read(after(n));
  assert.sameValue(value instanceof Token, n > 0);
  if (value instanceof Token) assert.sameValue(value.code, n);
  else assert.sameValue(value, 7);
}
