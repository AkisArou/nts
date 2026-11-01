/*---
description: "An array pattern over a past-end element of a declared nested array fails before iterator acquisition."
features: [ts-destructuring-routes, ts-destructuring-route-order, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-symbols, ts-errors, ts-destructuring]
---*/
// Pattern [first = fallback()] reads OrderValue[][] by a dynamic index; node traces a present inner iterator and throws TypeError for an undefined inner array.
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
for (const input of orderInputs) for (const index of [0, 1, 5]) {
  const log: unknown[] = [], inner: OrderValue[] = [input]; trace(inner, log); const rows: OrderValue[][] = [inner];
  function fallback(): OrderValue { log.push("default.first", orderFallback); return orderFallback; }
  function run(): void {
    const [first = fallback()] = rows[index];
    same(first, input === undefined ? orderFallback : input); log.push("bound", first);
  }
  if (index === 0) run(); else assert.throws(TypeError, run);
  const expected: unknown[] = [];
  if (index === 0) {
    expected.push("iterator", 0, "next", 0, false, input); if (input === undefined) expected.push("default.first", orderFallback);
    expected.push("return", 0, true, undefined, "bound", input === undefined ? orderFallback : input);
  }
  assert.compareArray(log, expected);
}
