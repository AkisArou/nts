/*---
description: "Control for arrays-generator-elision-finally; replace the pattern with explicit ordered iterator reads."
features: [ts-destructuring-routes, ts-destructuring-route-arrays, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-generators, ts-generics, ts-symbols, ts-optional-chaining, ts-closures]
---*/
// Generator<PatternValue, undefined, unknown> yields three slots; node takes an elision and one binding, runs any default, then return enters finally without pulling the third slot. The control advances and closes explicitly.
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
function inspect(input: PatternValue): void {
  const log: unknown[] = [];
  function* produce(): Generator<PatternValue, undefined, unknown> {
    try { log.push("yield", marker); yield marker; log.push("yield", input); yield input; log.push("yield", NaN); yield NaN; }
    finally { log.push("finally", input); }
    return undefined;
  }
  const source: Generator<PatternValue, undefined, unknown> = produce(); trace(source, log, "generator");
  function fallback(): PatternValue { log.push("default", replacement); return replacement; }
  const cursor: Iterator<PatternValue, undefined, unknown> = source[Symbol.iterator](); cursor.next(); const raw = cursor.next().value;
  const value = raw === undefined ? fallback() : raw; if (cursor.return) cursor.return();
  same(value, input === undefined ? replacement : input);
  const expected: unknown[] = ["generator.iterator", "yield", marker, "generator.next", false, marker, "yield", input, "generator.next", false, input];
  if (input === undefined) expected.push("default", replacement);
  expected.push("finally", input, "generator.return", true, undefined); assert.compareArray(log, expected);
}
for (const input of inputs) inspect(input);
