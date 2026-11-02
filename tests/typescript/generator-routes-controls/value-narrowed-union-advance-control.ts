/*---
description: Explicit state iterator control for A generator narrowed from a cursor-or-data union retains its suspension and completion while the data branch never starts the other cursor.
features: [ts-generator-route-values, ts-generators, ts-iteration, ts-arrays, ts-functions, ts-unions, ts-null-undefined, ts-narrowing, ts-interfaces, ts-symbols, ts-errors]
---*/
// Numeric iterator states replace suspension; An in-check narrows a union before next; node preserves the selected generator history and keeps the alternative data branch inert.
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
type Choice = Cursor | { idle: V };
function advance(value: Choice): IteratorResult<V, V> { if ("next" in value) return value.next(); return { value: value.idle, done: true }; }
const identity = { mark: 23 }, finish = { mark: 91 };
const rows: V[][] = [[], [-0], [NaN, identity, undefined], [null, "tail", identity]];
for (const make of makers) for (const values of rows) for (const active of [false, true]) {
  const log: unknown[] = [], cursor: Cursor = make(values, finish, log), choice: Choice = active ? cursor : { idle: identity }, seen: IteratorResult<V, V>[] = [], out: unknown[] = [];
  for (let index = 0; index < values.length + 3; index++) record(advance(choice), seen, out);
  const expected: unknown[] = [], expectedLog: unknown[] = [];
  if (active) { for (const value of values) { expected.push(value, false); expectedLog.push("yield", value, "resume", value); } expected.push(finish, true, undefined, true, undefined, true); expectedLog.push("body:return", "finally"); }
  else for (let index = 0; index < values.length + 3; index++) expected.push(identity, true);
  assert.compareArray(out, expected); assert.compareArray(log, expectedLog);
}
