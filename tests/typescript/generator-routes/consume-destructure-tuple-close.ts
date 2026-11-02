/*---
description: A generator selected from a typed tuple closes at a one-element destructuring pattern and cannot resume afterward.
features: [ts-generator-route-iterables, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-tuples, ts-destructuring, ts-spread, ts-symbols, ts-errors]
---*/
// A tuple slot carries an unstarted generator to a head-only pattern; node runs cleanup once and discards every unconsumed yield.
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
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of makers) for (const values of rows) {
  const log: unknown[] = [], cursor: Cursor = make(values, finish, log), pair: [Cursor, string] = [cursor, "kept"];
  const [head] = pair[0]; assert.sameValue(head, values[0]); assert.sameValue(pair[1], "kept");
  const end = cursor.next(), again = cursor.next(); check(end, undefined, true); check(again, undefined, true); assert.sameValue(end === again, false);
  const expected: unknown[] = values.length === 0 ? ["body:return", "finally"] : ["yield", values[0], "finally"];
  assert.compareArray(log, expected); assert.compareArray([...pair[0]], []);
}
