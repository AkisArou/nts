/*---
description: Control for widening-map-generic-writer-instantiations; all collection accesses use one declared type.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-unions, ts-spread, ts-numbers, ts-strings]
---*/
// Paired case: ../map-set-contents/widening-map-generic-writer-instantiations.ts.
// Only collection/generic declarations are unified; writes, reads and assertions are unchanged.
function write(map: Map<string, number | string>, value: number | string): void { map.set("value", value); }
function check(n: number): void {
  const numbers = new Map<string, number | string>([["keep", -0]]);
  const strings = new Map<string, number | string>([["keep", "start"]]);
  const text = "item:" + String(n);
  write(numbers, n);
  write(strings, text);
  const numberValue = numbers.get("value");
  const stringValue = strings.get("value");
  assert.sameValue<unknown>(numberValue, n);
  assert.sameValue(typeof numberValue, "number");
  assert.sameValue<unknown>(stringValue, text);
  assert.sameValue(typeof stringValue, "string");
  assert.sameValue(numbers.size, 2);
  assert.sameValue(strings.size, 2);
  assert.compareArray([...numbers.keys()], ["keep", "value"]);
  assert.compareArray([...strings.keys()], ["keep", "value"]);
  assert.compareArray<unknown>([...numbers.values()], [-0, n]);
  assert.compareArray<unknown>([...strings.values()], ["start", text]);
}
for (const n of [-0, NaN, 2147483649]) check(n);
