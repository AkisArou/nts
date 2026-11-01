/*---
description: "A nested object-pattern failure closes the outer iterator after retaining earlier assignment targets."
features: [ts-destructuring-routes, ts-destructuring-route-order, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-interfaces, ts-symbols, ts-errors, ts-destructuring]
---*/
// Pattern [first, { value: chosen }] reads an Iterable<OrderSlot>; node retains the first assignment, throws on an undefined second item and closes the outer iterator.
type OrderValue = number | string | bigint | boolean | undefined | null | { id: number };
const orderMarker = { id: 7 }, orderFallback = { id: 99 };
const orderInputs: OrderValue[] = [0, -0, NaN, 0n, "", "hi", "😀", undefined, null, false, orderMarker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface OrderSlot { value: OrderValue; }
for (const input of orderInputs) {
  const log: unknown[] = [], firstSlot: OrderSlot = { value: input }, slots: OrderSlot[] = [firstSlot]; let index = 0;
  const source: IterableIterator<OrderSlot, undefined, unknown> = {
    [Symbol.iterator]() { log.push("outer.iterator", arguments.length); return this; },
    next() { const value = slots[index++]; log.push("outer.next", arguments.length, false, value); return { done: false, value }; },
    return() { log.push("outer.return", arguments.length, true, undefined); return { done: true, value: undefined }; }
  };
  let first: OrderSlot | undefined = undefined, chosen: OrderValue = orderFallback;
  function run(): void {
    [first, { value: chosen }] = source;
  }
  assert.throws(TypeError, run); same(first, firstSlot); same(firstSlot.value, input); same(chosen, orderFallback); same(index, 2);
  assert.compareArray(log, ["outer.iterator", 0, "outer.next", 0, false, firstSlot, "outer.next", 0, false, undefined, "outer.return", 0, true, undefined]);
}
