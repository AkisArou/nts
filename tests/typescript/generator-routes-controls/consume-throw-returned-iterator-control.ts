/*---
description: Explicit state iterator control for A body error while consuming a returned generator keeps the same error identity and closes the generator before the consumer finally.
features: [ts-generator-route-iterables, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-unknown, ts-symbols, ts-errors]
---*/
// Numeric iterator states replace suspension; A typed iterator return supplies the for-of source; node preserves the body TypeError and runs generator then consumer cleanup once.
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
function expose(source: Cursor): Cursor { return source; }
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of makers) for (const values of rows) {
  const log: unknown[] = [], cursor: Cursor = make(values, finish, log), failure = new TypeError("body"); let caught: unknown;
  try { try { for (const value of expose(cursor)) { log.push("take", value); throw failure; } } finally { log.push("consumer:finally"); } } catch (error) { caught = error; log.push("catch", error); }
  assert.sameValue(caught, values.length === 0 ? undefined : failure);
  const end = cursor.next(), again = cursor.next(); check(end, undefined, true); check(again, undefined, true); assert.sameValue(end === again, false);
  const expected: unknown[] = values.length === 0 ? ["body:return", "finally", "consumer:finally"] : ["yield", values[0], "take", values[0], "finally", "consumer:finally", "catch", failure];
  assert.compareArray(log, expected); assert.sameValue(caught instanceof TypeError, values.length > 0);
}
