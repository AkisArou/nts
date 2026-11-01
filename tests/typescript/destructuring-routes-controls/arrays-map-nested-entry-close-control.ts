/*---
description: "Control for arrays-map-nested-entry-close; replace the pattern with explicit ordered iterator reads."
features: [ts-destructuring-routes, ts-destructuring-route-arrays, ts-functions, ts-arrays, ts-objects, ts-type-aliases, ts-unions, ts-numbers, ts-strings, ts-bigint, ts-null-undefined, ts-unknown, ts-typeof-operator, ts-iteration, ts-map-set, ts-tuples, ts-optional-chaining, ts-generics, ts-symbols, ts-closures]
---*/
// Map<string, PatternValue> crosses a parameter into [[key, value]]; node reads one entry, applies an undefined-only default, then closes the entry and Map cursors. The control advances and closes explicitly.
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
function inspect(source: Map<string, PatternValue>, input: PatternValue): void {
  const log: unknown[] = [], open = source[Symbol.iterator].bind(source);
  source[Symbol.iterator] = function() {
    log.push("map.iterator"); const cursor = open(), next = cursor.next.bind(cursor);
    cursor.next = function() { const step = next(); log.push("map.next", step.done, step.value?.[0], step.value?.[1]); if (!step.done) trace(step.value, log, "entry"); return step; };
    cursor.return = function() { log.push("map.return", true, undefined); return { done: true, value: undefined }; }; return cursor;
  };
  function fallback(): PatternValue { log.push("default", replacement); return replacement; }
  const outer = source[Symbol.iterator](), step = outer.next(); if (step.done) throw new Error("entry missing");
  const inner = step.value[Symbol.iterator](), key = inner.next().value, raw = inner.next().value;
  const value = raw === undefined ? fallback() : raw;
  if (inner.return) inner.return(); if (outer.return) outer.return();
  same(key, "first"); same(value, input === undefined ? replacement : input); same(source.size, 2);
  const expected: unknown[] = ["map.iterator", "map.next", false, "first", input, "entry.iterator", "entry.next", false, "first", "entry.next", false, input];
  if (input === undefined) expected.push("default", replacement);
  expected.push("entry.return", true, undefined, "map.return", true, undefined); assert.compareArray(log, expected);
}
for (const input of inputs) { const source = new Map<string, PatternValue>([["first", input], ["second", marker]]); inspect(source, input); }
