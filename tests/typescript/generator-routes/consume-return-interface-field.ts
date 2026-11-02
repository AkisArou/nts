/*---
description: Returning from a consumer of an interface-held generator runs generator cleanup before consumer cleanup and preserves the returned yielded identity.
features: [ts-generator-route-iterables, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-interfaces, ts-symbols, ts-errors]
---*/
// A generator field crosses a returning for-of consumer; node closes the suspended generator before the consumer finally and keeps the selected value.
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
function collect(holder: Holder, log: unknown[]): V { try { for (const value of holder.cursor) { log.push("take", value); return value; } return "empty"; } finally { log.push("consumer:finally"); } }
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of makers) for (const values of rows) {
  const log: unknown[] = [], cursor: Cursor = make(values, finish, log), holder: Holder = { cursor };
  assert.sameValue(collect(holder, log), values.length === 0 ? "empty" : values[0]);
  const end = cursor.next(), again = cursor.next(); check(end, undefined, true); check(again, undefined, true); assert.sameValue(end === again, false);
  const expected: unknown[] = values.length === 0 ? ["body:return", "finally", "consumer:finally"] : ["yield", values[0], "take", values[0], "finally", "consumer:finally"];
  assert.compareArray(log, expected); assert.sameValue(holder.cursor, cursor);
}
