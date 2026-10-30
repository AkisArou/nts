/*---
description: Map.forEach visits a wide integer entry appended during the first callback.
features: [ts-proof-element-kind, ts-route-callback, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-arrow-functions, ts-closures, ts-strings, ts-typeof-operator, ts-conversions, ts-null-undefined]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the callback appends above 32 bits; node visits the new entry and returns its exact value through the original .get.
function read(map: Map<string, number>): unknown { return map.get("added"); }
function check(n: number): void {
  const map = new Map<string, number>([["start", 1]]);
  let trace = "", visits = 0;
  map.forEach((value, key, self) => {
    assert.sameValue(self, map);
    visits++;
    trace += key + ":" + typeof value + ":" + String(value) + ";";
    if (key === "start" && n > 0) self.set("added", 4294967296 + n);
  });
  assert.sameValue(trace, n > 0 ? "start:number:1;added:number:" + (4294967296 + n) + ";" : "start:number:1;");
  assert.sameValue(visits, n > 0 ? 2 : 1);
  assert.sameValue(read(map), n > 0 ? 4294967296 + n : undefined);
  assert.sameValue(map.has("added"), n > 0);
  assert.sameValue(map.size, n > 0 ? 2 : 1);
}
for (const n of [-1, 0, 1, 3, 7]) check(n);
