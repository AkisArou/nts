/*---
description: "An array pattern rejects noniterable values written through a wider array view while preserving a traced string path."
features: [ts-destructuring-routes, ts-destructuring-route-order, ts-functions, ts-iteration, ts-arrays, ts-objects, ts-type-aliases, ts-typeof-operator, ts-unknown, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unions, ts-symbols, ts-errors, ts-narrowing, ts-unsound-covariant-array, ts-destructuring]
---*/
// A wider unknown[] writer replaces an Iterable<string> slot; node binds a traced String value or throws TypeError before any iterator call for noniterable members.
type OrderValue = number | string | bigint | boolean | undefined | null | { id: number };
const orderMarker = { id: 7 }, orderFallback = { id: 99 };
const orderInputs: OrderValue[] = [0, -0, NaN, 0n, "", "hi", "😀", undefined, null, false, orderMarker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function replace(values: unknown[], value: unknown): void { values[0] = value; }
function tracedText(text: string, log: unknown[]): String {
  const source = new String(text), iterator = source[Symbol.iterator](), originalNext = iterator.next;
  iterator.next = function() { const result = originalNext.call(iterator); log.push("next", arguments.length, result.done, result.value); return result; };
  iterator.return = function() { log.push("return", arguments.length, true, undefined); return { done: true, value: undefined }; };
  source[Symbol.iterator] = function() { log.push("iterator", arguments.length); return iterator; }; return source;
}
for (const input of orderInputs) {
  const log: unknown[] = [], slots: Iterable<string>[] = [""];
  const value = typeof input === "string" ? tracedText(input, log) : input; replace(slots, value); same(slots[0], value);
  const expectedFirst = input === "hi" ? "h" : input === "😀" ? "😀" : undefined;
  function run(): void {
    log.push("attempt");
    const [first] = slots[0];
    same(first, expectedFirst); log.push("bound", first);
  }
  if (typeof input === "string") run(); else assert.throws(TypeError, run);
  const expected: unknown[] = ["attempt"];
  if (typeof input === "string") {
    expected.push("iterator", 0, "next", 0, input === "", expectedFirst);
    if (input !== "") expected.push("return", 0, true, undefined); expected.push("bound", expectedFirst);
  }
  assert.compareArray(log, expected);
}
