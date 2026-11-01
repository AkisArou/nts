/*---
description: "Control for arrays-tuple-elision-default-rest; replace the pattern with explicit ordered iterator reads."
features: [ts-destructuring-routes, ts-destructuring-route-arrays, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-tuples, ts-tuple-labels, ts-tuple-optional, ts-tuple-rest, ts-generics, ts-symbols, ts-optional-chaining, ts-closures]
---*/
// [skip: PatternValue, value?: PatternValue, ...tail: PatternValue[]] crosses a tuple parameter; node skips the first slot, defaults only undefined and collects the remaining slots. The control advances and closes explicitly.
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
type PatternTuple = [skip: PatternValue, value?: PatternValue, ...tail: PatternValue[]];
function inspect(source: PatternTuple, input: PatternValue): void {
  const log: unknown[] = []; trace(source, log, "tuple");
  function fallback(): PatternValue { log.push("default", replacement); return replacement; }
  const cursor = source[Symbol.iterator](), skipped = cursor.next();
  const step = skipped.done ? skipped : cursor.next(), raw = step.done ? undefined : step.value;
  const head = raw === undefined ? fallback() : raw, tail: PatternValue[] = [];
  if (!step.done) for (;;) { const part = cursor.next(); if (part.done) break; tail.push(part.value); }
  const wanted = source.length === 1 || input === undefined ? replacement : input;
  same(head, wanted); same(Array.isArray(tail), true); same(typeof tail, "object"); same(tail.length, source.length === 4 ? 2 : 0);
  for (let i = 0; i < tail.length; i++) same(tail[i], i === 0 ? NaN : marker);
  const expected: unknown[] = ["tuple.iterator", "tuple.next", false, marker, "tuple.next", source.length === 1, source.length === 1 ? undefined : input];
  if (wanted === replacement) expected.push("default", replacement);
  for (let i = 2; i < source.length; i++) expected.push("tuple.next", false, source[i]);
  if (source.length > 1) expected.push("tuple.next", true, undefined);
  assert.compareArray(log, expected);
}
for (const input of inputs) { const rows: PatternTuple[] = [[marker], [marker, input], [marker, input, NaN, marker]]; for (const row of rows) inspect(row, input); }
