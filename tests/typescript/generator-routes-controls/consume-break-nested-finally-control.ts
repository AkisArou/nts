/*---
description: Explicit state iterator control for Breaking a loop over a generator array element runs nested finally blocks in order and permanently closes the selected cursor.
features: [ts-generator-route-iterables, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-function-types, ts-symbols, ts-errors]
---*/
// Numeric iterator states replace suspension; An array element carries a generator with nested cleanup; node closes inner then outer on break without executing the suspended remainder.
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
      state = 2; log.push("body:return"); log.push("inner", "outer"); return { value: finish, done: true };
    },
    return(value?: V): IteratorResult<V, V> { if (state === 1) { log.push("inner", "outer"); } state = 2; return { value, done: true }; },
    throw(error?: unknown): IteratorResult<V, V> { if (state === 1) { log.push("inner", "outer"); } state = 2; throw error; }
  };
}
function declared(values: V[], finish: V, log: unknown[]): Cursor { return manual(values, finish, log); }
const expression = function (values: V[], finish: V, log: unknown[]): Cursor { return manual(values, finish, log); };
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
