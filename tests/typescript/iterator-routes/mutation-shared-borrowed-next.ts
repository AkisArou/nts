/*---
description: Two consumers using borrowed-next share one typed iterator position and preserve every delivery.
features: [ts-iterator-route-mutation, ts-iteration, ts-class, ts-interfaces, ts-generics, ts-arrays, ts-unions, ts-numbers, ts-bigint]
---*/
// Route: two consumers advance one typed live iterator; node gives each the next remaining value and keeps exhaustion shared.
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
  for (const value of source) {
    log.push("take:A", value); outA.push(value); log.push("borrow"); const other = source.next();
    if (other.done) log.push("B:done", other.value); else { log.push("take:B", other.value); outB.push(other.value); }
  }
  const wantedA: MutationValue[] = [], wantedB: MutationValue[] = []; const expected: unknown[] = ["iterator", 0];
  for (let i = 0; i < values.length; i += 2) {
    wantedA.push(values[i]); expected.push("next", 0, undefined, "done", false, "take:A", values[i], "borrow", "next", 0, undefined, "done", i + 1 === values.length);
    if (i + 1 === values.length) expected.push("complete", undefined, "B:done", undefined);
    else { wantedB.push(values[i + 1]); expected.push("take:B", values[i + 1]); }
  }
  expected.push("next", 0, undefined, "done", true, "complete", undefined);
  assert.compareArray(log, expected); assert.compareArray(outA, wantedA); assert.compareArray(outB, wantedB); assert.compareArray(array, values);
  for (let i = 0; i < outA.length; i++) { assert.sameValue(Object.is(outA[i], wantedA[i]), true); assert.sameValue(typeof outA[i], typeof wantedA[i]); }
  for (let i = 0; i < outB.length; i++) { assert.sameValue(Object.is(outB[i], wantedB[i]), true); assert.sameValue(typeof outB[i], typeof wantedB[i]); }
  assert.sameValue(cursor.pulls, values.length + (values.length % 2 === 1 ? 2 : 1)); assert.sameValue(cursor.closes, 0); assert.sameValue(cursor.closed, false);
  assert.sameValue(Object.is(cursor.last, values[values.length - 1]), true);
}
