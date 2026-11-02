/*---
description: Explicit state iterator control for Array.from consumes a generator through a generic iterable parameter with ordered mapping indexes and no completion value in the output.
features: [ts-generator-route-iterables, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-generics, ts-symbols, ts-errors]
---*/
// Numeric iterator states replace suspension; A generic parameter carries a generator to Array.from; node maps each yield in order and consumes its return value only as completion.
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
function collect<T>(source: IterableIterator<T, V, undefined>, log: unknown[]): T[] { return Array.from(source, (value, index) => { log.push("map", index, value); return value; }); }
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of makers) for (const values of rows) {
  const log: unknown[] = [], cursor: Cursor = make(values, finish, log); assert.compareArray(collect(cursor, log), values);
  const end = cursor.next(), again = cursor.next(); check(end, undefined, true); check(again, undefined, true); assert.sameValue(end === again, false);
  const expected: unknown[] = []; for (let index = 0; index < values.length; index++) expected.push("yield", values[index], "map", index, values[index], "resume", values[index]);
  expected.push("body:return", "finally"); assert.compareArray(log, expected); assert.compareArray(collect(cursor, log), []); assert.compareArray(log, expected);
}
