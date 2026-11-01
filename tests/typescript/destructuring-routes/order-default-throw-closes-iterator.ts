/*---
description: "A throwing array-binding default closes its iterator and preserves the original error even if close also throws."
features: [ts-destructuring-routes, ts-destructuring-route-order, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-symbols, ts-errors, ts-destructuring]
---*/
// Pattern [first, chosen = fail(first)] reads an Iterable<OrderValue>; node preserves first, closes after the default throws and keeps that RangeError over a closing SyntaxError.
type OrderValue = number | string | bigint | boolean | undefined | null | { id: number };
const orderMarker = { id: 7 }, orderFallback = { id: 99 };
const orderInputs: OrderValue[] = [0, -0, NaN, 0n, "", "hi", "😀", undefined, null, false, orderMarker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
for (const input of orderInputs) for (const closeThrows of [false, true]) {
  const log: unknown[] = [], values: OrderValue[] = [input, undefined], original = new RangeError("default", { cause: input }), closing = new SyntaxError("close"); let index = 0;
  const source: IterableIterator<OrderValue, undefined, unknown> = {
    [Symbol.iterator]() { log.push("iterator", arguments.length); return this; },
    next() { const value = values[index++]; log.push("next", arguments.length, false, value); return { done: false, value }; },
    return() {
      log.push("return", arguments.length);
      if (closeThrows) { log.push("return.throw", closing); throw closing; }
      log.push("return.result", true, undefined); return { done: true, value: undefined };
    }
  };
  function fail(value: OrderValue): OrderValue { same(value, input); log.push("default.throw", original, value); throw original; }
  function run(): void {
    try {
      const [first, chosen = fail(first)] = source;
      same(chosen, orderFallback);
    } catch (error: unknown) { same(error, original); throw error; }
  }
  assert.throws(RangeError, run); same(original.cause, input); same(index, 2);
  const expected: unknown[] = ["iterator", 0, "next", 0, false, input, "next", 0, false, undefined, "default.throw", original, input, "return", 0];
  if (closeThrows) expected.push("return.throw", closing); else expected.push("return.result", true, undefined);
  assert.compareArray(log, expected);
}
