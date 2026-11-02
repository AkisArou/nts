/*---
description: Throw through a typed iterator parameter closes an unstarted generator without entering its internal catch or finally.
features: [ts-generator-route-return-throw-finally, ts-generators, ts-iteration, ts-arrays, ts-errors, ts-unknown, ts-unions, ts-null-undefined, ts-interfaces, ts-function-types]
---*/
// Explicit state-number control; A parameter carries an unstarted generator; node throws the exact supplied reason while body, catch and finally remain untouched.
type Value = number | string | null | undefined | { id: number };
type Step = IteratorResult<Value, Value>;
interface Cursor extends IterableIterator<Value, Value, Value> { next(value?: Value): Step; return(value?: Value): Step; throw(error?: unknown): Step; }
function check(step: Step, value: Value, done: boolean, seen: Step[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
type Factory = (count: number, log: unknown[]) => Cursor;
function model(count: number, log: unknown[]): Cursor {
  let state = 0, index = 0;
  return { [Symbol.iterator](): Cursor { return this; },
    next(): Step { if (state === 3) return { value: undefined, done: true }; if (state === 0) { state = 1; log.push("body"); } if (state === 1 && index < count) return { value: index++, done: false }; const value = state === 2 ? "recovered" : "natural"; state = 3; log.push("finally"); return { value, done: true }; },
    return(value?: Value): Step { if (state === 1 || state === 2) log.push("finally"); state = 3; return { value, done: true }; },
    throw(error?: unknown): Step { if (state === 1) { state = 2; log.push("inside:catch", error); return { value: "caught", done: false }; } if (state === 2) log.push("finally"); state = 3; throw error; } };
}
function declared(count: number, log: unknown[]): Cursor { return model(count, log); }
const expression = function (count: number, log: unknown[]): Cursor { return model(count, log); };
const makers: Factory[] = [declared, expression];
function raise(cursor: Cursor, error: unknown): Step { return cursor.throw(error); }
const identity = { id: 19 }, failures: unknown[] = [new RangeError("unstarted"), identity, undefined];
for (const make of makers) for (const count of [0, 1, 3]) for (const failure of failures) {
  const log: unknown[] = [], seen: Step[] = [], cursor = make(count, log); let escaped = false, caught: unknown = "unset";
  try { raise(cursor, failure); } catch (error) { escaped = true; caught = error; }
  assert.sameValue(escaped, true); assert.sameValue(caught, failure); assert.compareArray(log, []);
  check(cursor.next(identity), undefined, true, seen); check(cursor.return(identity), identity, true, seen);
  assert.compareArray(log, []);
}
