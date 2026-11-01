/*---
description: "A throwing nested array default closes the inner iterator before closing the outer iterator."
features: [ts-destructuring-routes, ts-destructuring-route-order, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-interfaces, ts-generics, ts-symbols, ts-errors, ts-destructuring]
---*/
// Pattern [[first, chosen = fail(first)]] crosses nested typed Iterable values; node preserves the first value, logs inner return before outer return and keeps the original RangeError.
type OrderValue = number | string | bigint | boolean | undefined | null | { id: number };
const orderMarker = { id: 7 }, orderFallback = { id: 99 };
const orderInputs: OrderValue[] = [0, -0, NaN, 0n, "", "hi", "😀", undefined, null, false, orderMarker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
interface OrderCursor<T> extends IterableIterator<T, undefined, unknown> { return(): IteratorResult<T, undefined>; }
for (const input of orderInputs) {
  const log: unknown[] = [], original = new RangeError("nested default", { cause: input });
  function cursor<T>(label: string, values: T[]): OrderCursor<T> {
    let index = 0;
    return {
      [Symbol.iterator]() { log.push(label + ".iterator", arguments.length); return this; },
      next() { const value = values[index++]; log.push(label + ".next", arguments.length, false, value); return { done: false, value }; },
      return() { log.push(label + ".return", arguments.length, true, undefined); return { done: true, value: undefined }; }
    };
  }
  const inner = cursor<OrderValue>("inner", [input, undefined]), outer = cursor<Iterable<OrderValue, undefined, unknown>>("outer", [inner]);
  function fail(value: OrderValue): OrderValue { same(value, input); log.push("default.throw", original, value); throw original; }
  function run(): void {
    try {
      const [[first, chosen = fail(first)]] = outer;
      same(chosen, orderFallback);
    } catch (error: unknown) { same(error, original); throw error; }
  }
  assert.throws(RangeError, run); same(original.cause, input);
  assert.compareArray(log, ["outer.iterator", 0, "outer.next", 0, false, inner, "inner.iterator", 0, "inner.next", 0, false, input, "inner.next", 0, false, undefined,
    "default.throw", original, input, "inner.return", 0, true, undefined, "outer.return", 0, true, undefined]);
}
