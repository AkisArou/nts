/*---
description: Map.forEach observes a fractional replacement of a not-yet-visited entry.
features: [ts-proof-element-kind, ts-route-callback, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-arrow-functions, ts-closures, ts-strings, ts-typeof-operator, ts-conversions]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the start callback replaces item before its visit; node records the fractional value in the full live trace and original .get.
function read(map: Map<string, number>): unknown { return map.get("item"); }
function check(n: number): void {
  const map = new Map<string, number>([["start", 1], ["item", 7]]);
  let trace = "", visits = 0;
  map.forEach((value, key, self) => {
    assert.sameValue(self, map);
    visits++;
    trace += key + ":" + typeof value + ":" + String(value) + ";";
    if (key === "start" && n > 0) self.set("item", n + 0.25);
  });
  const expected = n > 0 ? n + 0.25 : 7;
  assert.sameValue(trace, "start:number:1;item:number:" + expected + ";");
  assert.sameValue(visits, 2);
  assert.sameValue(read(map), expected);
  assert.sameValue(map.size, 2);
}
for (const n of [-1, 0, 1, 3, 7]) check(n);
