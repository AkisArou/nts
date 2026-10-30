/*---
description: Map.forEach visits an explicitly undefined entry added during its first callback.
features: [ts-proof-element-kind, ts-route-callback, ts-map-set, ts-functions, ts-iteration, ts-arrays, ts-numbers, ts-unknown, ts-arrow-functions, ts-closures, ts-strings, ts-typeof-operator, ts-conversions, ts-null-undefined]
---*/
// Fact: initial Map values are small integers (docs/language/types.md, Decisions).
// Route: the start callback inserts undefined; node visits that present key even though .get alone matches the absent-key control.
function read(map: Map<string, number>): unknown { return map.get("added"); }
function check(n: number): void {
  const map = new Map<string, number>([["start", 1]]);
  let trace = "", visits = 0;
  let observed: unknown = "not visited";
  map.forEach((value, key, self) => {
    assert.sameValue(self, map);
    visits++;
    trace += key + ":" + typeof value + ":" + String(value) + ";";
    if (key === "added") observed = value;
    if (key === "start" && n > 0) {
      const writable: Map<string, unknown> = self;
      writable.set("added", undefined);
    }
  });
  assert.sameValue(trace, n > 0 ? "start:number:1;added:undefined:undefined;" : "start:number:1;");
  assert.sameValue(visits, n > 0 ? 2 : 1);
  assert.sameValue(observed, n > 0 ? undefined : "not visited");
  assert.sameValue(read(map), undefined);
  assert.sameValue(map.has("added"), n > 0);
  assert.sameValue(map.has("missing"), false);
  assert.sameValue(map.size, n > 0 ? 2 : 1);
}
for (const n of [-1, 0, 1, 3, 7]) check(n);
