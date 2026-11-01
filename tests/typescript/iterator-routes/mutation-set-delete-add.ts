/*---
description: Set delete-add during typed iteration preserves live order, zero canonicalization and identity.
features: [ts-iterator-route-mutation, ts-iteration, ts-class, ts-interfaces, ts-generics, ts-arrays, ts-unions, ts-numbers, ts-bigint, ts-map-set]
---*/
// Route: a live native Set cursor while an unvisited member is deleted and a new one is added; node skips the deletion and visits the addition.
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
  const first: MutationValue = Object.is(input, -0) ? 0 : input; const values: MutationValue[] = length === 0 ? [] : length === 1 ? [input] : [input, later, tail];
  const set = new Set<MutationValue>(values); const log: unknown[] = [], out: MutationValue[] = []; const cursor = new LiveCursor(set, log);
  const source: Iterable<MutationValue, undefined, unknown> = cursor;
  for (const value of source) {
    log.push("take", value); out.push(value); if (out.length === 1) { const removed = set.delete(later); set.add(added); log.push("change", removed, set.size); }
  }
  const wanted: MutationValue[] = length === 0 ? [] : length === 1 ? [first, added] : [first, tail, added]; const expected: unknown[] = ["iterator", 0];
  for (let i = 0; i < wanted.length; i++) { expected.push("next", 0, undefined, "done", false, "take", wanted[i]); if (i === 0) { expected.push("change", length === 3, length === 1 ? 2 : 3); } }
  expected.push("next", 0, undefined, "done", true, "complete", undefined);
  assert.compareArray(log, expected); assert.compareArray(out, wanted);
  for (let i = 0; i < out.length; i++) { assert.sameValue(Object.is(out[i], wanted[i]), true); assert.sameValue(typeof out[i], typeof wanted[i]); }
  assert.sameValue(cursor.pulls, wanted.length + 1); assert.sameValue(cursor.closes, 0); assert.sameValue(cursor.closed, false);
  assert.sameValue(Object.is(cursor.last, wanted[wanted.length - 1]), true);
  assert.sameValue(set.size, length === 0 ? 0 : length === 1 ? 2 : 3); assert.sameValue(set.has(later), false); assert.sameValue(set.has(added), length > 0);
  assert.sameValue(set.has(tail), length === 3); assert.sameValue(set.has(input), length > 0);
}
