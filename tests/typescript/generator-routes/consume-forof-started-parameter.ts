/*---
description: A partially advanced generator passed as an iterable iterator resumes at its next yield and stays completed after for-of.
features: [ts-generator-route-iterables, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-function-types, ts-symbols, ts-errors]
---*/
// Declared and expression cursors cross an IterableIterator parameter after one next; node consumes only the remaining values and completes once.
type V = number | string | null | undefined | { mark: number };
type Cursor = IterableIterator<V, V, undefined>;
type Maker = (values: V[], finish: V, log: unknown[]) => Cursor;
function check(step: IteratorResult<V, V>, value: V, done: boolean): void { assert.sameValue(step.value, value); assert.sameValue(step.done, done); }
function* declared(values: V[], finish: V, log: unknown[]): Cursor {
  try { for (const value of values) { log.push("yield", value); yield value; log.push("resume", value); } log.push("body:return"); return finish; } finally { log.push("finally"); }
}
const expression = function* (values: V[], finish: V, log: unknown[]): Cursor {
  try { for (const value of values) { log.push("yield", value); yield value; log.push("resume", value); } log.push("body:return"); return finish; } finally { log.push("finally"); }
};
const makers: Maker[] = [declared, expression];
function collect(source: Cursor): V[] { const out: V[] = []; for (const value of source) out.push(value); return out; }
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of makers) for (const values of rows) {
  const log: unknown[] = [], cursor: Cursor = make(values, finish, log), first = cursor.next();
  check(first, values.length === 0 ? finish : values[0], values.length === 0);
  assert.compareArray(collect(cursor), values.slice(1));
  const end = cursor.next(), again = cursor.next(); check(end, undefined, true); check(again, undefined, true); assert.sameValue(end === again, false);
  const expected: unknown[] = []; for (const value of values) expected.push("yield", value, "resume", value); expected.push("body:return", "finally");
  assert.compareArray(log, expected); assert.sameValue(first === end, false); assert.sameValue(first === again, false);
}
