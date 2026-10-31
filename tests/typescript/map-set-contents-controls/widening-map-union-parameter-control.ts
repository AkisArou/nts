/*---
description: Control for widening-map-union-parameter; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unions, ts-spread, ts-numbers, ts-strings, ts-arrow-functions]
---*/
// Paired case: ../map-set-contents/widening-map-union-parameter.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
function write(map: Map<string, number | string>, text: string): void {
  map.set("replace", text);
  map.set("added", text + "!");
}
function check(n: number): void {
  const map = new Map<string, number | string>([["replace", n + 1], ["keep", n]]);
  const text = "value:" + String(n);
  write(map, text);
  const value = map.get("replace");
  assert.sameValue<unknown>(value, text);
  assert.sameValue(typeof value, "string");
  assert.sameValue(map.get("keep"), n);
  assert.sameValue(typeof map.get("keep"), "number");
  assert.sameValue(map.size, 3);
  assert.compareArray([...map.keys()], ["replace", "keep", "added"]);
  assert.compareArray<unknown>([...map.values()], [text, n, text + "!"]);
  assert.compareArray([...map.values()].map(value => typeof value), ["string", "number", "string"]);
}
for (const n of [-0, NaN, 2147483649]) check(n);
