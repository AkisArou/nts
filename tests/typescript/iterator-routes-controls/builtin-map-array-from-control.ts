/*---
description: Control for builtin-map-array-from; explicit iterator calls preserve the same protocol history.
features: [ts-iterator-route-builtins, ts-iteration, ts-interfaces, ts-arrays, ts-generics, ts-class, ts-class-fields, ts-unions, ts-numbers, ts-null-undefined, ts-map-set, ts-functions, ts-tuples]
---*/
// Control: replace the consumer protocol with an explicit next loop; the tracer, source, delivery timing, values and assertions are unchanged.
type BuiltinValue = number | string | undefined | { id: number };
const marker: { id: number } = { id: 7 };
const rows: { values: BuiltinValue[]; expected: [number, BuiltinValue][] }[] = [
  { values: [], expected: [] },
  { values: [-0], expected: [[0, -0]] },
  { values: [undefined], expected: [[0, undefined]] },
  { values: [marker], expected: [[0, marker]] },
  { values: [1, -0, NaN, 0.5, 2147483648, "\u00e9\u4e2d", undefined, marker], expected: [[0, 1], [1, -0], [2, NaN], [3, 0.5], [4, 2147483648], [5, "\u00e9\u4e2d"], [6, undefined], [7, marker]] },
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
  const source = new Map<number, BuiltinValue>();
  for (let i = 0; i < row.values.length; i++) source.set(i, row.values[i]);
  const log: unknown[] = []; const trace = new BuiltinTrace(source, log);
  const carrier: { items: Iterable<[number, BuiltinValue], undefined, unknown> } = { items: trace }; let seen: [number, BuiltinValue][] = [];
  function receive(value: [number, BuiltinValue], index: number): [number, BuiltinValue] { log.push("receive", index, value[0], value[1]); return value; }
  const iterator = carrier.items[Symbol.iterator]();
  while (true) { const step = iterator.next(); if (step.done) break; seen.push(receive(step.value, seen.length)); }
  const ended = trace.next("after"); assert.sameValue(ended.done, true); assert.sameValue(ended.value, undefined);
  const expected: unknown[] = ["open", "iterator"];
  for (let i = 0; i < row.expected.length; i++) expected.push("next", 0, undefined, "done", false, "receive", i, row.expected[i][0], row.expected[i][1]);
  expected.push("next", 0, undefined, "done", true);
  expected.push("next", 1, "after", "done", true); assert.compareArray(log, expected);
  assert.sameValue(seen.length, row.expected.length);
  for (let i = 0; i < seen.length; i++) {
    for (let part = 0; part < 2; part++) { assert.sameValue(Object.is(seen[i][part], row.expected[i][part]), true); assert.sameValue(typeof seen[i][part], typeof row.expected[i][part]); }
  }
  assert.sameValue(trace.steps, row.expected.length + 2); assert.sameValue(trace.closes, 0); assert.sameValue(trace.last, ended); assert.sameValue(trace.source, source);
  assert.sameValue(source.size, row.values.length); for (let i = 0; i < row.values.length; i++) assert.sameValue(Object.is(source.get(i), row.values[i]), true);
}
