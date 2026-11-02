/*---
description: A generic Iterator helper keeps two yields and two distinct sends separate for number, string and object instantiations.
features: [ts-generator-route-sending-completion, ts-generators, ts-iteration, ts-arrays, ts-generics, ts-function-types, ts-interfaces, ts-tuples, ts-null-undefined]
---*/
// Explicit state-number control; A generic Iterator parameter carries each exchange; node retains signed zero, NaN, text, undefined and object identities across both sends.
interface Cursor<T> extends IterableIterator<T, T | undefined, T | undefined> { return(value?: T): IteratorResult<T, T | undefined>; throw(error?: unknown): IteratorResult<T, T | undefined>; }
interface Factory { <T>(first: T, second: T, log: unknown[]): Cursor<T>; }
function check(step: { value: unknown; done?: boolean }, value: unknown, done: boolean, seen: object[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
function model<T>(first: T, second: T, log: unknown[]): Cursor<T> {
  let state = 0;
  return { [Symbol.iterator](): Cursor<T> { return this; },
    next(sent?: T): IteratorResult<T, T | undefined> { if (state === 0) { state = 1; return { value: first, done: false }; } if (state === 1) { state = 2; log.push("first", sent); return { value: second, done: false }; } if (state === 2) { state = 3; log.push("second", sent); return { value: sent, done: true }; } return { value: undefined, done: true }; },
    return(value?: T): IteratorResult<T, T | undefined> { state = 3; return { value, done: true }; }, throw(error?: unknown): IteratorResult<T, T | undefined> { state = 3; throw error; } };
}
function declared<T>(first: T, second: T, log: unknown[]): Cursor<T> { return model(first, second, log); }
const expression = function <T>(first: T, second: T, log: unknown[]): Cursor<T> { return model(first, second, log); };
const makers: Factory[] = [declared, expression];
function drive<T>(cursor: Iterator<T, T | undefined, T | undefined>, row: [T, T, T | undefined, T | undefined], log: unknown[]): void {
  const seen: object[] = []; check(cursor.next(row[1]), row[0], false, seen); check(cursor.next(row[2]), row[1], false, seen);
  check(cursor.next(row[3]), row[3], true, seen); check(cursor.next(row[0]), undefined, true, seen); assert.compareArray(log, ["first", row[2], "second", row[3]]);
}
const numeric: [number, number, number | undefined, number | undefined][] = [[-0, NaN, 41, -0], [3, 7, undefined, NaN]];
const text: [string, string, string | undefined, string | undefined][] = [["yield:a", "yield:b", "send:a", "send:b"], ["", "b", "", undefined]];
const first = { id: 1 }, second = { id: 2 }, sent = { id: 3 }, objects: [{ id: number }, { id: number }, { id: number } | undefined, { id: number } | undefined][] = [[first, second, sent, first], [second, first, undefined, sent]];
for (const make of makers) {
  for (const row of numeric) { const log: unknown[] = []; drive(make(row[0], row[1], log), row, log); }
  for (const row of text) { const log: unknown[] = []; drive(make(row[0], row[1], log), row, log); }
  for (const row of objects) { const log: unknown[] = []; drive(make(row[0], row[1], log), row, log); }
}
