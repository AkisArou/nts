/*---
description: "A nested tuple pattern exhausts the inner rest before advancing and closing its outer tuple iterator."
features: [ts-destructuring-routes, ts-destructuring-route-arrays, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-tuples, ts-generics, ts-symbols, ts-optional-chaining, ts-closures, ts-destructuring, ts-spread]
---*/
// [PatternValue[], PatternValue] crosses a tuple parameter; node defaults the inner head, copies its rest, reads the outer final slot and closes only the unexhausted outer iterator.
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
type NestedPatternTuple = [PatternValue[], PatternValue];
function inspect(source: NestedPatternTuple, input: PatternValue): void {
  const log: unknown[] = [], inner = source[0]; trace(inner, log, "inner"); trace(source, log, "outer");
  function fallback(): PatternValue { log.push("default", replacement); return replacement; }
  const [[first = fallback(), ...tail], last] = source;
  same(first, input === undefined ? replacement : input); same(last, -0); same(Array.isArray(tail), true); same(typeof tail, "object"); same(tail.length, 2); same(tail[0], NaN); same(tail[1], marker);
  const expected: unknown[] = ["outer.iterator", "outer.next", false, inner, "inner.iterator", "inner.next", false, input];
  if (input === undefined) expected.push("default", replacement);
  expected.push("inner.next", false, NaN, "inner.next", false, marker, "inner.next", true, undefined, "outer.next", false, -0, "outer.return", true, undefined);
  assert.compareArray(log, expected);
}
for (const input of inputs) { const source: NestedPatternTuple = [[input, NaN, marker], -0]; inspect(source, input); }
