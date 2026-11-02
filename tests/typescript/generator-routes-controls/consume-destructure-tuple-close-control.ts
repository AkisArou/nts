/*---
description: Explicit state iterator control for A generator selected from a typed tuple closes at a one-element destructuring pattern and cannot resume afterward.
features: [ts-generator-route-iterables, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-tuples, ts-destructuring, ts-spread, ts-symbols, ts-errors]
---*/
// Numeric iterator states replace suspension; A tuple slot carries an unstarted generator to a head-only pattern; node runs cleanup once and discards every unconsumed yield.
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
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of makers) for (const values of rows) {
  const log: unknown[] = [], cursor: Cursor = make(values, finish, log), pair: [Cursor, string] = [cursor, "kept"];
  const [head] = pair[0]; assert.sameValue(head, values[0]); assert.sameValue(pair[1], "kept");
  const end = cursor.next(), again = cursor.next(); check(end, undefined, true); check(again, undefined, true); assert.sameValue(end === again, false);
  const expected: unknown[] = values.length === 0 ? ["body:return", "finally"] : ["yield", values[0], "finally"];
  assert.compareArray(log, expected); assert.compareArray([...pair[0]], []);
}
