/*---
description: "A declared mixed Set reaches an elided array pattern with exact normalized values and default/rest protocol history."
features: [ts-destructuring-routes, ts-destructuring-route-arrays, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-map-set, ts-generics, ts-symbols, ts-optional-chaining, ts-closures, ts-destructuring, ts-spread]
---*/
// Set<PatternValue> is read through a typed parameter; node skips a sentinel, defaults undefined and copies the trailing identity without losing Set zero normalization.
type PatternValue = number | string | boolean | bigint | undefined | null | { id: number };
const marker = { id: 7 }, replacement = { id: 99 };
const inputs: PatternValue[] = [0, -0, NaN, 0n, "", undefined, null, false, marker];
function same(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); assert.sameValue(typeof actual, typeof expected); }
function trace<T>(source: Iterable<T, undefined, unknown>, log: unknown[], label: string): void {
  const open = source[Symbol.iterator].bind(source);
  source[Symbol.iterator] = function() {
    log.push(label + ".iterator"); const cursor = open(), next = cursor.next.bind(cursor), close = cursor.return?.bind(cursor);
    cursor.next = function() { const step = next(); log.push(label + ".next", step.done, step.value); return step; };
    cursor.return = function() { const empty: IteratorReturnResult<undefined> = { done: true, value: undefined }; const step = close === undefined ? empty : close(); log.push(label + ".return", step.done, step.value); return step; };
    return cursor;
  };
}
function inspect(source: Set<PatternValue>, input: PatternValue, sentinel: object, tailValue: PatternValue): void {
  const log: unknown[] = []; trace(source, log, "set");
  function fallback(): PatternValue { log.push("default", replacement); return replacement; }
  const [, head = fallback(), ...tail] = source;
  const stored = Object.is(input, -0) ? 0 : input, wanted = input === undefined ? replacement : stored;
  same(head, wanted); same(Array.isArray(tail), true); same(typeof tail, "object"); same(tail.length, 1); same(tail[0], tailValue);
  const expected: unknown[] = ["set.iterator", "set.next", false, sentinel, "set.next", false, stored];
  if (input === undefined) expected.push("default", replacement);
  expected.push("set.next", false, tailValue, "set.next", true, undefined); assert.compareArray(log, expected);
}
for (const input of inputs) { const sentinel = { id: 111 }, tailValue = { id: 222 }; const source: Set<PatternValue> = new Set([sentinel, input, tailValue]); inspect(source, input, sentinel, tailValue); }
