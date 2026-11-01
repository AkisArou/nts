/*---
description: "Repeated keys in an object pattern perform one distinct getter read for every binding."
features: [ts-destructuring-routes, ts-destructuring-route-order, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-interfaces, ts-accessors, ts-destructuring]
---*/
// Pattern { value: first, value: second, value: third } reads OrderGetter; node returns three successive values and never caches the property.
type OrderValue = number | string | bigint | boolean | undefined | null | { id: number };
const orderMarker = { id: 7 }, orderFallback = { id: 99 };
const orderInputs: OrderValue[] = [0, -0, NaN, 0n, "", "hi", "😀", undefined, null, false, orderMarker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface OrderGetter { value: OrderValue; }
for (const input of orderInputs) {
  const log: unknown[] = [], values: OrderValue[] = [input, orderMarker, false]; let reads = 0;
  const source: OrderGetter = { get value(): OrderValue { const value = values[reads++]; log.push("get.value", reads, value); return value; } };
  const { value: first, value: second, value: third } = source;
  same(first, input); same(second, orderMarker); same(third, false); same(reads, 3);
  assert.compareArray(log, ["get.value", 1, input, "get.value", 2, orderMarker, "get.value", 3, false]);
}
