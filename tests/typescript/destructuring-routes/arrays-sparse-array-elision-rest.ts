/*---
description: "A sparse union array crosses an array parameter into an elided pattern with two defaults and an exact rest copy."
features: [ts-destructuring-routes, ts-destructuring-route-arrays, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-generics, ts-symbols, ts-optional-chaining, ts-closures, ts-destructuring, ts-spread]
---*/
// PatternValue[] has a hole and stored undefined; a typed array pattern reads defaults in order, elides the hole and copies the final reference and NaN.
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
function inspect(source: PatternValue[], input: PatternValue): void {
  const log: unknown[] = []; trace(source, log, "array");
  function fallback(key: string): PatternValue { log.push("default", key, replacement); return replacement; }
  const [first = fallback("first"), , third = fallback("third"), ...tail] = source;
  same(first, input === undefined ? replacement : input); same(third, replacement);
  same(Array.isArray(tail), true); same(typeof tail, "object"); same(tail.length, 2); same(tail[0], marker); same(tail[1], NaN);
  same(Object.hasOwn(source, 1), false); same(Object.hasOwn(source, 2), true);
  const expected: unknown[] = ["array.iterator", "array.next", false, input];
  if (input === undefined) expected.push("default", "first", replacement);
  expected.push("array.next", false, undefined, "array.next", false, undefined, "default", "third", replacement, "array.next", false, marker, "array.next", false, NaN, "array.next", true, undefined);
  assert.compareArray(log, expected);
}
for (const input of inputs) { const source: PatternValue[] = [input]; source.length = 5; source[2] = undefined; source[3] = marker; source[4] = NaN; inspect(source, input); }
