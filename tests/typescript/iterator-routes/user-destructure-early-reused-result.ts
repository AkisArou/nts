/*---
description: Two-element destructuring consumes a typed iterable class with reused IteratorResult objects and exact delivery and cleanup.
features: [ts-iterator-route-user-iterables, ts-iteration, ts-class, ts-interfaces, ts-symbols, ts-arrays, ts-unions, ts-numbers, ts-bigint, ts-destructuring]
---*/
// Route: a mixed-value class consumed by two-element destructuring with reused result objects; node preserves every value and the specified closing point.
type IterValue = number | string | boolean | undefined | bigint | { id: number };
const marker = { id: 7 }, completion = { id: 99 };
const inputs: IterValue[] = [0, -0, NaN, 0.5, 2147483648, "", "\u00e9\u4e2d", false, true, undefined, 9007199254740993n, marker];
class UserCursor implements Iterable<IterValue, IterValue, unknown> {
  values: IterValue[]; log: unknown[]; index: number = 0; closed: boolean = false; returns: number = 0;
  results: IteratorResult<IterValue, IterValue>[] = [];
  result: IteratorResult<IterValue, IterValue> = { done: false, value: undefined };
  constructor(values: IterValue[], log: unknown[]) { this.values = values; this.log = log; }
  [Symbol.iterator](): IterableIterator<IterValue, IterValue, unknown> { this.log.push("iterator", arguments.length); return this; }
  next(sent?: unknown): IteratorResult<IterValue, IterValue> {
    this.log.push("next", arguments.length, sent, this.index); const done = this.closed || this.index === this.values.length;
    const value = done ? completion : this.values[this.index++];
    this.result.done = done; this.result.value = value; const result = this.result;
    this.results.push(result); this.log.push("step", result.done, result.value); return result;
  }
  return(sent?: IterValue): IteratorResult<IterValue, IterValue> {
    this.log.push("return", arguments.length, sent, this.index); this.closed = true; this.returns++; return { done: true, value: sent };
  }
  throw(error?: unknown): IteratorResult<IterValue, IterValue> { this.log.push("throw", arguments.length, error); this.closed = true; throw error; }
}
for (const input of inputs) for (const values of [[], [input], [input, undefined], [input, undefined, marker]]) {
  const log: unknown[] = []; const cursor = new UserCursor(values, log);
  const source: Iterable<IterValue, IterValue, unknown> = cursor;
  const [head, second] = source; const out: IterValue[] = [head, second];
  for (const value of out) log.push("take", value);
  const wanted: IterValue[] = [values[0], values[1]]; const expected: unknown[] = ["iterator", 0];
  for (let i = 0; i < Math.min(values.length + 1, 2); i++) expected.push("next", 0, undefined, i, "step", i >= values.length, i >= values.length ? completion : values[i]);
  if (values.length >= 2) expected.push("return", 0, undefined, 2);
  for (const value of wanted) expected.push("take", value);
  assert.compareArray(out, wanted); assert.compareArray(log, expected);
  for (let i = 0; i < out.length; i++) { assert.sameValue(Object.is(out[i], wanted[i]), true); assert.sameValue(typeof out[i], typeof wanted[i]); }
  assert.sameValue(cursor.index, Math.min(values.length, 2)); assert.sameValue(cursor.closed, values.length >= 2); assert.sameValue(cursor.returns, values.length >= 2 ? 1 : 0);
  assert.sameValue(cursor.results.length, Math.min(values.length + 1, 2));
  for (let i = 0; i < cursor.results.length; i++) for (let j = 0; j < i; j++) assert.sameValue(Object.is(cursor.results[i], cursor.results[j]), true);
}
