/*---
description: Map.forEach skips a deleted numeric entry and visits an object inserted by the callback.
features: [ts-proof-element-kind, ts-route-callback, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-arrow-functions, ts-closures, ts-strings, ts-typeof-operator, ts-conversions, ts-class, ts-class-fields, ts-objects, ts-instanceof]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the start callback deletes item and appends a Token; node records the full changed live order and object payload.
class Token {
  code: number;
  constructor(code: number) { this.code = code; }
}
function describe(value: unknown): string { return value instanceof Token ? "Token(" + value.code + ")" : String(value); }
function read(map: Map<string, number>): unknown { return map.get("added"); }
function check(n: number): void {
  const map = new Map<string, number>([["start", 1], ["item", 7]]);
  let trace = "", visits = 0;
  map.forEach((value, key, self) => {
    assert.sameValue(self, map);
    visits++;
    trace += key + ":" + typeof value + ":" + describe(value) + ";";
    if (key === "start" && n > 0) {
      self.delete("item");
      const writable: Map<string, unknown> = self;
      writable.set("added", new Token(n));
    }
  });
  assert.sameValue(trace, n > 0 ? "start:number:1;added:object:Token(" + n + ");" : "start:number:1;item:number:7;");
  assert.sameValue(visits, 2);
  const value = read(map);
  assert.sameValue(value instanceof Token, n > 0);
  if (value instanceof Token) assert.sameValue(value.code, n);
  else assert.sameValue(value, undefined);
  assert.sameValue(map.get("item"), n > 0 ? undefined : 7);
  assert.sameValue(map.size, 2);
}
for (const n of [-1, 0, 1, 3, 7]) check(n);
