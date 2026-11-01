/*---
description: Control for builtin-string-for-of; explicit iterator calls preserve the same protocol history.
features: [ts-iterator-route-builtins, ts-iteration, ts-interfaces, ts-arrays, ts-generics, ts-class, ts-class-fields, ts-strings]
---*/
// Control: replace the consumer protocol with an explicit next loop; the tracer, source, delivery timing, values and assertions are unchanged.
const rows: { text: string; expected: string[] }[] = [
  { text: "", expected: [] }, { text: "a", expected: ["a"] },
  { text: "\u00e9\u00ff", expected: ["\u00e9", "\u00ff"] },
  { text: "\u0101\u4e2d", expected: ["\u0101", "\u4e2d"] },
  { text: "\ud83d\ude00", expected: ["\ud83d\ude00"] },
  { text: "\ud800", expected: ["\ud800"] },
  { text: "\udfff", expected: ["\udfff"] },
  { text: "A\ud83d\ude00\ud800\u00e9\udfff\u4e2d", expected: ["A", "\ud83d\ude00", "\ud800", "\u00e9", "\udfff", "\u4e2d"] },
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
  const source: string = row.text;
  const log: unknown[] = []; const trace = new BuiltinTrace(source, log);
  const carrier: { items: Iterable<string, undefined, unknown> } = { items: trace }; let seen: string[] = [];
  function receive(value: string, index: number): string { log.push("receive", index, value); return value; }
  const iterator = carrier.items[Symbol.iterator]();
  while (true) { const step = iterator.next(); if (step.done) break; seen.push(receive(step.value, seen.length)); }
  const ended = trace.next("after"); assert.sameValue(ended.done, true); assert.sameValue(ended.value, undefined);
  const expected: unknown[] = ["open", "iterator"];
  for (let i = 0; i < row.expected.length; i++) expected.push("next", 0, undefined, "done", false, "receive", i, row.expected[i]);
  expected.push("next", 0, undefined, "done", true);
  expected.push("next", 1, "after", "done", true); assert.compareArray(log, expected);
  assert.sameValue(seen.length, row.expected.length);
  for (let i = 0; i < seen.length; i++) {
    assert.sameValue(Object.is(seen[i], row.expected[i]), true); assert.sameValue(typeof seen[i], typeof row.expected[i]);
    assert.sameValue(seen[i].length, row.expected[i].length); assert.sameValue(seen[i].charCodeAt(0), row.expected[i].charCodeAt(0)); assert.sameValue(seen[i].charCodeAt(seen[i].length - 1), row.expected[i].charCodeAt(row.expected[i].length - 1));
  }
  assert.sameValue(trace.steps, row.expected.length + 2); assert.sameValue(trace.closes, 0); assert.sameValue(trace.last, ended); assert.sameValue(trace.source, source);
  assert.sameValue(source, row.text); assert.sameValue(source.length, row.text.length);
}
