/*---
description: "Control for order-object-past-end-element; explicit reads preserve the same order, effects and failure."
features: [ts-destructuring-routes, ts-destructuring-route-order, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-interfaces, ts-accessors, ts-errors]
---*/
// Explicit reads replace the pattern; the same typed sources, input values, full hook log and exact outcomes remain.
type OrderValue = number | string | bigint | boolean | undefined | null | { id: number };
const orderMarker = { id: 7 }, orderFallback = { id: 99 };
const orderInputs: OrderValue[] = [0, -0, NaN, 0n, "", "hi", "😀", undefined, null, false, orderMarker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface OrderSlot { value: OrderValue; }
for (const input of orderInputs) for (const index of [0, 1, 5]) {
  const log: unknown[] = [];
  const rows: OrderSlot[] = [{ get value(): OrderValue { log.push("get.value", input); return input; } }];
  function fallback(): OrderValue { log.push("default.value", orderFallback); return orderFallback; }
  function run(): void {
    const source = rows[index], readValue = source.value; const value = readValue === undefined ? fallback() : readValue;
    same(value, input === undefined ? orderFallback : input); log.push("bound", value);
  }
  if (index === 0) run(); else assert.throws(TypeError, run);
  const expected: unknown[] = [];
  if (index === 0) { expected.push("get.value", input); if (input === undefined) expected.push("default.value", orderFallback); expected.push("bound", input === undefined ? orderFallback : input); }
  assert.compareArray(log, expected);
}
