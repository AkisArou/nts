/*---
description: A typed holder field carries a suspended generator into spread without restarting it or sharing the collected array with its input.
features: [ts-generator-route-iterables, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-interfaces, ts-spread, ts-symbols, ts-errors]
---*/
// A cursor field is spread after its first next; node copies the remaining yielded values and leaves the generator exhausted.
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
interface Holder { cursor: Cursor; }
function collect(holder: Holder): V[] { return [...holder.cursor]; }
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of makers) for (const values of rows) {
  const log: unknown[] = [], original = values.slice(), cursor: Cursor = make(values, finish, log), holder: Holder = { cursor }, first = cursor.next();
  check(first, values.length === 0 ? finish : values[0], values.length === 0);
  const copied = collect(holder); assert.compareArray(copied, values.slice(1)); copied[0] = "private"; assert.sameValue(copied[0], "private"); assert.compareArray(values, original);
  const end = cursor.next(), again = cursor.next(); check(end, undefined, true); check(again, undefined, true); assert.sameValue(end === again, false);
  assert.sameValue(first === end, false); assert.sameValue(first === again, false); assert.compareArray(collect(holder), []); const expected: unknown[] = [];
  for (const value of values) expected.push("yield", value, "resume", value); expected.push("body:return", "finally"); assert.compareArray(log, expected);
}
