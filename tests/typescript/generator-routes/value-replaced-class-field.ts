/*---
description: Replacing a generator field leaves a retained cursor at its original suspension while the replacement advances independently.
features: [ts-generator-route-values, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-class, ts-class-fields, ts-symbols, ts-errors]
---*/
// A class field changes from one cursor to another after next; node preserves each generator state and allocates fresh results for every call.
type V = number | string | null | undefined | { mark: number };
type Cursor = IterableIterator<V, V, undefined>;
function check(step: IteratorResult<V, V>, value: V, done: boolean): void { assert.sameValue(step.value, value); assert.sameValue(step.done, done); }
function record(step: IteratorResult<V, V>, seen: IteratorResult<V, V>[], out: unknown[]): void { for (const previous of seen) assert.sameValue(step === previous, false); seen.push(step); out.push(step.value, step.done); }
type Maker = (values: V[], finish: V, log: unknown[]) => Cursor;
function* declared(values: V[], finish: V, log: unknown[]): Cursor {
  try { for (const value of values) { log.push("yield", value); yield value; log.push("resume", value); } log.push("body:return"); return finish; } finally { log.push("finally"); }
}
const expression = function* (values: V[], finish: V, log: unknown[]): Cursor {
  try { for (const value of values) { log.push("yield", value); yield value; log.push("resume", value); } log.push("body:return"); return finish; } finally { log.push("finally"); }
};
const makers: Maker[] = [declared, expression];
class Holder { cursor: Cursor; constructor(cursor: Cursor) { this.cursor = cursor; } }
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of makers) for (const values of rows) {
  const leftLog: unknown[] = [], rightLog: unknown[] = [], cursor = make(values, finish, leftLog), right = make(values, identity, rightLog), holder = new Holder(cursor), alias = holder.cursor;
  const seen: IteratorResult<V, V>[] = [], leftOut: unknown[] = [], rightOut: unknown[] = []; record(holder.cursor.next(), seen, leftOut); holder.cursor = right;
  assert.sameValue(holder.cursor, right); assert.sameValue(alias, cursor); assert.sameValue(alias === holder.cursor, false);
  for (let index = 0; index < values.length + 2; index++) { record(alias.next(), seen, leftOut); record(holder.cursor.next(), seen, rightOut); }
  const leftExpected: unknown[] = [], rightExpected: unknown[] = [], expectedLog: unknown[] = [];
  for (const value of values) { leftExpected.push(value, false); rightExpected.push(value, false); expectedLog.push("yield", value, "resume", value); }
  leftExpected.push(finish, true, undefined, true, undefined, true); rightExpected.push(identity, true, undefined, true); expectedLog.push("body:return", "finally");
  assert.compareArray(leftOut, leftExpected); assert.compareArray(rightOut, rightExpected); assert.compareArray(leftLog, expectedLog); assert.compareArray(rightLog, expectedLog);
}
