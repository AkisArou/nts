/*---
description: "Control for order-nested-object-failure-closes-outer; explicit reads preserve the same order, effects and failure."
features: [ts-destructuring-routes, ts-destructuring-route-order, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-interfaces, ts-symbols, ts-errors]
---*/
// Explicit reads replace the pattern; the same typed sources, input values, full hook log and exact outcomes remain.
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
    const iterator = source[Symbol.iterator](), firstStep = iterator.next(); first = firstStep.done ? undefined : firstStep.value;
    const secondStep = firstStep.done ? firstStep : iterator.next();
    try { if (secondStep.done) throw new TypeError("missing nested object"); chosen = secondStep.value.value; }
    finally { if (!secondStep.done && iterator.return !== undefined) iterator.return(); }
  }
  assert.throws(TypeError, run); same(first, firstSlot); same(firstSlot.value, input); same(chosen, orderFallback); same(index, 2);
  assert.compareArray(log, ["outer.iterator", 0, "outer.next", 0, false, firstSlot, "outer.next", 0, false, undefined, "outer.return", 0, true, undefined]);
}
