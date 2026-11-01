/*---
description: Array splice during typed for-of changes subsequent native iterator deliveries exactly once.
features: [ts-iterator-route-mutation, ts-iteration, ts-class, ts-interfaces, ts-generics, ts-arrays, ts-unions, ts-numbers, ts-bigint]
---*/
// Route: a live native array iterator carried by a typed cursor while the array is spliced; node observes the current length and elements.
type MutationValue = number | string | boolean | undefined | bigint | { id: number };
const marker = { id: 7 }, later = { id: 8 }, tail = { id: 9 }, added = { id: 10 };
const inputs: MutationValue[] = [0, -0, NaN, 0.5, 2147483648, "", "\u00e9\u4e2d", false, true, undefined, 9007199254740993n, marker];
class LiveCursor<T> implements IterableIterator<T, undefined, unknown> {
  native: Iterator<T, undefined, unknown>; log: unknown[]; pulls: number = 0; closes: number = 0; closed: boolean = false; last: T | undefined = undefined;
  constructor(source: Iterable<T, undefined, unknown>, log: unknown[]) { this.native = source[Symbol.iterator](); this.log = log; }
  [Symbol.iterator](): IterableIterator<T, undefined, unknown> { this.log.push("iterator", arguments.length); return this; }
  next(sent?: unknown): IteratorResult<T, undefined> {
    this.log.push("next", arguments.length, sent); this.pulls++;
    const step = arguments.length === 0 ? this.native.next() : this.native.next(sent);
    this.log.push("done", step.done); if (step.done) this.log.push("complete", step.value); else this.last = step.value; return step;
  }
  return(sent?: undefined): IteratorResult<T, undefined> { this.log.push("return", arguments.length, sent); this.closes++; this.closed = true; return this.native.return ? this.native.return(sent) : { done: true, value: undefined }; }
  throw(error?: unknown): IteratorResult<T, undefined> { this.log.push("throw", arguments.length, error); if (this.native.throw) return this.native.throw(error); throw error; }
}
for (const input of inputs) for (const length of [0, 1, 3]) {
  const array: MutationValue[] = length === 0 ? [] : length === 1 ? [input] : [input, undefined, marker];
  const log: unknown[] = [], out: MutationValue[] = []; const cursor = new LiveCursor(array, log);
  const source: Iterable<MutationValue, undefined, unknown> = cursor;
  for (const value of source) {
    log.push("take", value); out.push(value); if (out.length === 1) { const removed = array.splice(1, 1, "new", input); log.push("splice", removed.length, removed[0], array.length); }
  }
  const wanted: MutationValue[] = length === 0 ? [] : length === 1 ? [input, "new", input] : [input, "new", input, marker]; const expected: unknown[] = ["iterator", 0];
  for (let i = 0; i < wanted.length; i++) { expected.push("next", 0, undefined, "done", false, "take", wanted[i]); if (i === 0) { expected.push("splice", length > 1 ? 1 : 0, undefined, length === 1 ? 3 : 4); } }
  expected.push("next", 0, undefined, "done", true, "complete", undefined);
  assert.compareArray(log, expected); assert.compareArray(out, wanted); assert.compareArray(array, wanted);
  for (let i = 0; i < out.length; i++) { assert.sameValue(Object.is(out[i], wanted[i]), true); assert.sameValue(typeof out[i], typeof wanted[i]); }
  assert.sameValue(cursor.pulls, wanted.length + 1); assert.sameValue(cursor.closes, 0); assert.sameValue(cursor.closed, false);
  assert.sameValue(Object.is(cursor.last, wanted[wanted.length - 1]), true);
}
