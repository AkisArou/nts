/*---
description: Explicit state iterator control for Returning from a consumer of an interface-held generator runs generator cleanup before consumer cleanup and preserves the returned yielded identity.
features: [ts-generator-route-iterables, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-interfaces, ts-symbols, ts-errors]
---*/
// Numeric iterator states replace suspension; A generator field crosses a returning for-of consumer; node closes the suspended generator before the consumer finally and keeps the selected value.
type V = number | string | null | undefined | { mark: number };
type Cursor = IterableIterator<V, V, undefined>;
type Maker = (values: V[], finish: V, log: unknown[]) => Cursor;
function check(step: IteratorResult<V, V>, value: V, done: boolean): void { assert.sameValue(step.value, value); assert.sameValue(step.done, done); }
function manual(values: V[], finish: V, log: unknown[]): Cursor {
  let state = 0, index = 0;
  return { [Symbol.iterator](): Cursor { return this; },
    next(): IteratorResult<V, V> {
      if (state === 2) return { value: undefined, done: true };
      if (state === 1) log.push("resume", values[index - 1]);
      if (index < values.length) { state = 1; const value = values[index++]; log.push("yield", value); return { value, done: false }; }
      state = 2; log.push("body:return"); log.push("finally"); return { value: finish, done: true };
    },
    return(value?: V): IteratorResult<V, V> { if (state === 1) { log.push("finally"); } state = 2; return { value, done: true }; },
    throw(error?: unknown): IteratorResult<V, V> { if (state === 1) { log.push("finally"); } state = 2; throw error; }
  };
}
function declared(values: V[], finish: V, log: unknown[]): Cursor { return manual(values, finish, log); }
const expression = function (values: V[], finish: V, log: unknown[]): Cursor { return manual(values, finish, log); };
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
