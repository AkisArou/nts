/*---
description: A generic Map writer preserves independent number and string instantiations.
features: [ts-map-set-contents, ts-contents-widening, ts-map-set, ts-functions, ts-iteration, ts-typeof-operator, ts-generics, ts-unions, ts-spread, ts-numbers, ts-strings]
---*/
// Write/read route: the same generic writer is instantiated for numeric and string contents; node keeps the exact contents and order.
function write<V>(map: Map<string, V>, value: V): void { map.set("value", value); }
function check(n: number): void {
  const numbers = new Map<string, number>([["keep", -0]]);
  const strings = new Map<string, string>([["keep", "start"]]);
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
