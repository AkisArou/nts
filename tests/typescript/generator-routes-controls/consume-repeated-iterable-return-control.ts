/*---
description: Explicit state iterator control for An iterable view returned for a generator is the same single-use cursor on every iteration and never replays its body after exhaustion.
features: [ts-generator-route-iterables, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-interfaces, ts-symbols, ts-errors]
---*/
// Numeric iterator states replace suspension; A typed Iterable return carries a generator into two complete loops; node delivers all values once and returns the same iterator on each acquisition.
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
function expose(source: Cursor): Iterable<V> { return source; }
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of makers) for (const values of rows) {
  const log: unknown[] = [], cursor: Cursor = make(values, finish, log), view: Iterable<V> = expose(cursor), first: V[] = [], second: V[] = [];
  assert.sameValue(view[Symbol.iterator](), cursor); for (const value of view) first.push(value);
  assert.sameValue(view[Symbol.iterator](), cursor); for (const value of view) second.push(value);
  assert.compareArray(first, values); assert.compareArray(second, []);
  const end = cursor.next(), again = cursor.next(); check(end, undefined, true); check(again, undefined, true); assert.sameValue(end === again, false);
  const expected: unknown[] = []; for (const value of values) expected.push("yield", value, "resume", value); expected.push("body:return", "finally"); assert.compareArray(log, expected);
}
