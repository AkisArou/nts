/*---
description: Converting a computed property key writes an object into an initially numeric Map.
features: [ts-proof-element-kind, ts-route-conversion, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-class, ts-class-fields, ts-objects, ts-closures, ts-computed-keys, ts-conversions, ts-to-primitive, ts-to-string, ts-strings, ts-instanceof]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the key conversion performs the widened store; node retains the object and its payload through the original Map read.
class Token {
  code: number;
  constructor(code: number) { this.code = code; }
}
function read(map: Map<string, number>): unknown { return map.get("item"); }
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const writable: Map<string, unknown> = map;
  const key = {
    toString(): string { if (n > 0) writable.set("item", new Token(n)); return "marker"; }
  };
  const record = { [String(key)]: 5 };
  assert.sameValue(record.marker, 5);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const value = read(after(n));
  assert.sameValue(value instanceof Token, n > 0);
  if (value instanceof Token) assert.sameValue(value.code, n);
  else assert.sameValue(value, 7);
}
