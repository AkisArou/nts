/*---
description: Control for mutation-shared-nested-consumers; explicit next loops retain the same mutations and observations.
features: [ts-iterator-route-mutation, ts-iteration, ts-class, ts-interfaces, ts-generics, ts-arrays, ts-unions, ts-numbers, ts-bigint]
---*/
// Control: expand the consumer into explicit next calls on the same live cursor.
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
for (const input of inputs) for (const values of [[], [input], [input, undefined, marker], [input, undefined, marker, "tail"]]) {
  const log: unknown[] = [], outA: MutationValue[] = [], outB: MutationValue[] = []; const array = values.slice();
  const cursor = new LiveCursor(array, log); const source: IterableIterator<MutationValue, undefined, unknown> = cursor;
  const iterator = source[Symbol.iterator]();
  while (true) { const step = iterator.next(); if (step.done) break; const value = step.value;
    log.push("take:A", value); outA.push(value); const nested = source[Symbol.iterator]();
    while (true) { const other = nested.next(); if (other.done) break; log.push("take:B", other.value); outB.push(other.value); }
  }
  const wantedA: MutationValue[] = values.length === 0 ? [] : [values[0]], wantedB = values.slice(1); const expected: unknown[] = ["iterator", 0];
  if (values.length > 0) {
    expected.push("next", 0, undefined, "done", false, "take:A", values[0], "iterator", 0);
    for (let i = 1; i < values.length; i++) expected.push("next", 0, undefined, "done", false, "take:B", values[i]);
    expected.push("next", 0, undefined, "done", true, "complete", undefined);
  }
  expected.push("next", 0, undefined, "done", true, "complete", undefined);
  assert.compareArray(log, expected); assert.compareArray(outA, wantedA); assert.compareArray(outB, wantedB); assert.compareArray(array, values);
  for (let i = 0; i < outA.length; i++) { assert.sameValue(Object.is(outA[i], wantedA[i]), true); assert.sameValue(typeof outA[i], typeof wantedA[i]); }
  for (let i = 0; i < outB.length; i++) { assert.sameValue(Object.is(outB[i], wantedB[i]), true); assert.sameValue(typeof outB[i], typeof wantedB[i]); }
  assert.sameValue(cursor.pulls, values.length + (values.length > 0 ? 2 : 1)); assert.sameValue(cursor.closes, 0); assert.sameValue(cursor.closed, false);
  assert.sameValue(Object.is(cursor.last, values[values.length - 1]), true);
}
