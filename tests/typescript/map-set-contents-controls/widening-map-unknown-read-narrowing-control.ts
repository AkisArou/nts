/*---
description: Control for widening-map-unknown-read-narrowing; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-unknown, ts-unions, ts-narrowing, ts-spread, ts-numbers, ts-strings]
---*/
// Paired case: ../map-set-contents/widening-map-unknown-read-narrowing.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
function store(map: Map<string, number | string>, value: number | string): void { map.set("value", value); }
function check(input: number | string): void {
  const map = new Map<string, number | string>();
  store(map, input);
  const value = map.get("value");
  assert.sameValue(value, input);
  assert.sameValue(typeof value, typeof input);
  if (typeof value === "number") {
    if (typeof input !== "number") throw new Test262Error("wrong numeric branch");
    assert.sameValue(value + 0.5, input + 0.5);
  } else if (typeof value === "string") {
    if (typeof input !== "string") throw new Test262Error("wrong string branch");
    assert.sameValue(value.slice(1), input.slice(1));
  } else throw new Test262Error("unexpected stored type");
  assert.sameValue(map.has("value"), true);
  assert.sameValue(map.size, 1);
  assert.compareArray([...map.keys()], ["value"]);
}
const inputs: (number | string)[] = [-0, NaN, 2147483649, "7", "", "wide"];
for (const input of inputs) check(input);
