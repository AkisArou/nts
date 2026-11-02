/*---
description: Explicit state iterator control for A generic helper preserves generator identity so alternating aliases share one position while a second generator stays independent.
features: [ts-generator-route-values, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-generics, ts-symbols, ts-errors]
---*/
// Numeric iterator states replace suspension; A generic iterator return retains the same cursor; node advances one activation through either alias and preserves a separate activation beside it.
type V = number | string | null | undefined | { mark: number };
type Cursor = IterableIterator<V, V, undefined>;
function check(step: IteratorResult<V, V>, value: V, done: boolean): void { assert.sameValue(step.value, value); assert.sameValue(step.done, done); }
function record(step: IteratorResult<V, V>, seen: IteratorResult<V, V>[], out: unknown[]): void { for (const previous of seen) assert.sameValue(step === previous, false); seen.push(step); out.push(step.value, step.done); }
type Maker = (values: V[], finish: V, log: unknown[]) => Cursor;
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
function retain<T, R, N>(source: IterableIterator<T, R, N>): IterableIterator<T, R, N> { return source; }
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of makers) for (const values of rows) {
  const firstLog: unknown[] = [], secondLog: unknown[] = [], cursor = make(values, finish, firstLog), other = make(values, identity, secondLog), alias = retain(cursor), separate = retain(other);
  assert.sameValue(alias, cursor); assert.sameValue(separate, other); assert.sameValue(alias === separate, false);
  const firstOut: unknown[] = [], secondOut: unknown[] = [], seen: IteratorResult<V, V>[] = [];
  for (let index = 0; index < values.length + 3; index++) { record((index % 2 === 0 ? alias : cursor).next(), seen, firstOut); record(separate.next(), seen, secondOut); }
  const firstExpected: unknown[] = [], secondExpected: unknown[] = [], expectedLog: unknown[] = [];
  for (const value of values) { firstExpected.push(value, false); secondExpected.push(value, false); expectedLog.push("yield", value, "resume", value); }
  firstExpected.push(finish, true, undefined, true, undefined, true); secondExpected.push(identity, true, undefined, true, undefined, true); expectedLog.push("body:return", "finally");
  assert.compareArray(firstOut, firstExpected); assert.compareArray(secondOut, secondExpected); assert.compareArray(firstLog, expectedLog); assert.compareArray(secondLog, expectedLog);
}
