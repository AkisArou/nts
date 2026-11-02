/*---
description: Breaking a loop over a generator array element runs nested finally blocks in order and permanently closes the selected cursor.
features: [ts-generator-route-iterables, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-function-types, ts-symbols, ts-errors]
---*/
// An array element carries a generator with nested cleanup; node closes inner then outer on break without executing the suspended remainder.
type V = number | string | null | undefined | { mark: number };
type Cursor = IterableIterator<V, V, undefined>;
type Maker = (values: V[], finish: V, log: unknown[]) => Cursor;
function check(step: IteratorResult<V, V>, value: V, done: boolean): void { assert.sameValue(step.value, value); assert.sameValue(step.done, done); }
function* declared(values: V[], finish: V, log: unknown[]): Cursor {
  try { try { for (const value of values) { log.push("yield", value); yield value; log.push("resume", value); } log.push("body:return"); return finish; } finally { log.push("inner"); } } finally { log.push("outer"); }
}
const expression = function* (values: V[], finish: V, log: unknown[]): Cursor {
  try { try { for (const value of values) { log.push("yield", value); yield value; log.push("resume", value); } log.push("body:return"); return finish; } finally { log.push("inner"); } } finally { log.push("outer"); }
};
const makers: Maker[] = [declared, expression];
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of makers) for (const values of rows) for (const limit of [1, 2, 9]) {
  const log: unknown[] = [], cursor: Cursor = make(values, finish, log), sources: Cursor[] = [cursor], out: V[] = [];
  for (const value of sources[0]) { out.push(value); log.push("take", value); if (out.length === limit) break; }
  const taken = Math.min(values.length, limit); assert.compareArray(out, values.slice(0, taken));
  const end = cursor.next(), again = cursor.next(); check(end, undefined, true); check(again, undefined, true); assert.sameValue(end === again, false);
  const expected: unknown[] = []; for (let index = 0; index < taken; index++) { if (index > 0) expected.push("resume", values[index - 1]); expected.push("yield", values[index], "take", values[index]); }
  if (values.length < limit) { if (taken > 0) expected.push("resume", values[taken - 1]); expected.push("body:return"); } expected.push("inner", "outer"); assert.compareArray(log, expected);
}
