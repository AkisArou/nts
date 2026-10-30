/*---
description: A destructuring default getter writes a string through a widened Map view.
features: [ts-proof-element-kind, ts-route-accessor, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-objects, ts-accessors, ts-closures, ts-destructuring, ts-optional-properties, ts-strings, ts-typeof-operator]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the missing property invokes the getter; node retains the string when a for-of reader uses the original Map.
function read(map: Map<string, number>): unknown {
  for (const [key, value] of map) if (key === "item") return value;
  return undefined;
}
function after(n: number): Map<string, number> {
  const map = new Map<string, number>([["item", 7]]);
  const writable: Map<string, unknown> = map;
  const gate = {
    get token(): number { writable.set("item", "getter:" + n); return 5; }
  };
  const source: { token?: number } = n > 0 ? {} : { token: 9 };
  const { token = gate.token } = source;
  assert.sameValue(token, n > 0 ? 5 : 9);
  return map;
}
for (const n of [-1, 0, 1, 3, 7]) {
  const value = read(after(n));
  assert.sameValue(value, n > 0 ? "getter:" + n : 7);
  assert.sameValue(typeof value, n > 0 ? "string" : "number");
}
