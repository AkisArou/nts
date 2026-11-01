/*---
description: Array.from with a mapper consumes a set through an Iterable field with exact protocol and value order.
features: [ts-iterator-route-builtins, ts-iteration, ts-interfaces, ts-arrays, ts-generics, ts-class, ts-class-fields, ts-unions, ts-numbers, ts-null-undefined, ts-map-set, ts-functions]
---*/
// Route: a typed tracer holds the actual set iterable; array-from consumes its native iterator and node preserves the complete history.
type BuiltinValue = number | string | undefined | { id: number };
const marker: { id: number } = { id: 7 };
const rows: { values: BuiltinValue[]; expected: BuiltinValue[] }[] = [
  { values: [], expected: [] },
  { values: [-0], expected: [0] },
  { values: [undefined], expected: [undefined] },
  { values: [marker], expected: [marker] },
  { values: [-0, NaN, 0.5, 2147483648, "\u00e9\u4e2d", undefined, marker, NaN, 0], expected: [0, NaN, 0.5, 2147483648, "\u00e9\u4e2d", undefined, marker] },
];
class BuiltinTrace<T> implements IterableIterator<T, undefined, unknown> {
  source: Iterable<T, undefined, unknown>; cursor: Iterator<T, undefined, unknown>; log: unknown[];
  steps: number = 0; closes: number = 0; last: IteratorResult<T, undefined> = { done: true, value: undefined };
  constructor(source: Iterable<T, undefined, unknown>, log: unknown[]) {
    this.source = source; this.log = log; log.push("open"); this.cursor = source[Symbol.iterator]();
  }
  [Symbol.iterator](): IterableIterator<T, undefined, unknown> { this.log.push("iterator"); return this; }
  next(...args: [] | [unknown]): IteratorResult<T, undefined> {
    this.log.push("next", args.length, args[0]); this.steps++;
    const result = this.cursor.next(...args); this.last = result; this.log.push("done", result.done === true); return result;
  }
  return(value?: undefined): IteratorResult<T, undefined> { this.log.push("return", value); this.closes++; return { done: true, value }; }
  throw(error?: unknown): IteratorResult<T, undefined> { this.log.push("throw", error); throw error; }
}
for (const row of rows) {
  const source = new Set<BuiltinValue>(row.values);
  const log: unknown[] = []; const trace = new BuiltinTrace(source, log);
  const carrier: { items: Iterable<BuiltinValue, undefined, unknown> } = { items: trace }; let seen: BuiltinValue[] = [];
  function receive(value: BuiltinValue, index: number): BuiltinValue { log.push("receive", index, value); return value; }
  seen = Array.from(carrier.items, receive);
  const ended = trace.next("after"); assert.sameValue(ended.done, true); assert.sameValue(ended.value, undefined);
  const expected: unknown[] = ["open", "iterator"];
  for (let i = 0; i < row.expected.length; i++) expected.push("next", 0, undefined, "done", false, "receive", i, row.expected[i]);
  expected.push("next", 0, undefined, "done", true);
  expected.push("next", 1, "after", "done", true); assert.compareArray(log, expected);
  assert.sameValue(seen.length, row.expected.length);
  for (let i = 0; i < seen.length; i++) {
    assert.sameValue(Object.is(seen[i], row.expected[i]), true); assert.sameValue(typeof seen[i], typeof row.expected[i]);
  }
  assert.sameValue(trace.steps, row.expected.length + 2); assert.sameValue(trace.closes, 0); assert.sameValue(trace.last, ended); assert.sameValue(trace.source, source);
  assert.sameValue(source.size, row.expected.length); for (const value of row.values) assert.sameValue(source.has(value), true);
}
