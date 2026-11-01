/*---
description: "Control for order-tuple-default-mutates-next-slot; explicit reads preserve the same order, effects and failure."
features: [ts-destructuring-routes, ts-destructuring-route-order, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-tuples, ts-symbols]
---*/
// Explicit reads replace the pattern; the same typed sources, input values, full hook log and exact outcomes remain.
type OrderValue = number | string | bigint | boolean | undefined | null | { id: number };
const orderMarker = { id: 7 }, orderFallback = { id: 99 };
const orderInputs: OrderValue[] = [0, -0, NaN, 0n, "", "hi", "😀", undefined, null, false, orderMarker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function trace(source: OrderValue[], log: unknown[]): void {
  const iterator = source[Symbol.iterator](), originalNext = iterator.next;
  iterator.next = function() { const result = originalNext.call(iterator); log.push("next", arguments.length, result.done, result.value); return result; };
  iterator.return = function() { log.push("return", arguments.length, true, undefined); return { done: true, value: undefined }; };
  source[Symbol.iterator] = function() { log.push("iterator", arguments.length); return iterator; };
}
for (const input of orderInputs) for (const missing of [false, true]) {
  const log: unknown[] = [], initial = missing ? undefined : input;
  const source: [OrderValue, OrderValue] = [initial, input]; trace(source, log);
  function replace(): OrderValue { source[1] = orderMarker; log.push("default.first", false, "write.second", orderMarker); return false; }
  const iterator = source[Symbol.iterator](), firstStep = iterator.next();
  const firstRead = firstStep.done ? undefined : firstStep.value, first = firstRead === undefined ? replace() : firstRead;
  const secondStep = firstStep.done ? firstStep : iterator.next(), second = secondStep.done ? undefined : secondStep.value;
  if (!secondStep.done && iterator.return !== undefined) iterator.return();
  same(first, initial === undefined ? false : input); same(second, initial === undefined ? orderMarker : input);
  same(source[0], initial); same(source[1], initial === undefined ? orderMarker : input); same(source.length, 2);
  const expected: unknown[] = ["iterator", 0, "next", 0, false, initial];
  if (initial === undefined) expected.push("default.first", false, "write.second", orderMarker);
  expected.push("next", 0, false, initial === undefined ? orderMarker : input, "return", 0, true, undefined);
  assert.compareArray(log, expected);
}
