/*---
description: Control for mutation-map-delete-add; explicit next loops retain the same mutations and observations.
features: [ts-iterator-route-mutation, ts-iteration, ts-class, ts-interfaces, ts-generics, ts-arrays, ts-unions, ts-numbers, ts-bigint, ts-map-set, ts-destructuring]
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
for (const input of inputs) for (const length of [0, 1, 3]) {
  const entries: [string, MutationValue][] = length === 0 ? [] : length === 1 ? [["a", input]] : [["a", input], ["b", undefined], ["c", marker]];
  const map = new Map<string, MutationValue>(entries); const log: unknown[] = [], out: MutationValue[] = [], keys: string[] = [];
  const cursor = new LiveCursor(map, log); const holder: { values: Iterable<[string, MutationValue], undefined, unknown> } = { values: cursor }; const source = holder.values;
  const iterator = source[Symbol.iterator]();
  while (true) { const step = iterator.next(); if (step.done) break; const [key, value] = step.value;
    log.push("take", key, value); keys.push(key); out.push(value); if (out.length === 1) { const removed = map.delete("b"); map.set("d", "late"); map.set("c", input); log.push("change", removed, map.size); }
  }
  const wanted: MutationValue[] = length === 0 ? [] : length === 1 ? [input, "late", input] : [input, input, "late"]; const wantedKeys: string[] = length === 0 ? [] : length === 1 ? ["a", "d", "c"] : ["a", "c", "d"];
  const expected: unknown[] = ["iterator", 0];
  for (let i = 0; i < wanted.length; i++) { expected.push("next", 0, undefined, "done", false, "take", wantedKeys[i], wanted[i]); if (i === 0) { expected.push("change", length === 3, 3); } }
  expected.push("next", 0, undefined, "done", true, "complete", undefined);
  assert.compareArray(log, expected); assert.compareArray(keys, wantedKeys); assert.compareArray(out, wanted);
  for (let i = 0; i < out.length; i++) { assert.sameValue(Object.is(out[i], wanted[i]), true); assert.sameValue(typeof out[i], typeof wanted[i]); }
  assert.sameValue(cursor.pulls, wanted.length + 1); assert.sameValue(cursor.closes, 0); assert.sameValue(cursor.closed, false);
  assert.sameValue(map.size, length === 0 ? 0 : 3); assert.sameValue(map.has("b"), false);
  assert.sameValue(Object.is(map.get("c"), length === 0 ? undefined : input), true); assert.sameValue(map.get("d"), length === 0 ? undefined : "late");
  assert.sameValue(Object.is(map.get("a"), length === 0 ? undefined : input), true);
}
