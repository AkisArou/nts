/*---
description: A generator passed to a typed throw helper catches each injected error at its actual paused yield and resumes with the subsequent send.
features: [ts-generator-route-return-throw-finally, ts-generators, ts-iteration, ts-arrays, ts-errors, ts-unknown, ts-unions, ts-null-undefined, ts-interfaces, ts-function-types]
---*/
// Explicit state-number control; A typed parameter carries a generator with two catch regions; node selects the catch enclosing the paused yield and preserves the recovery send.
type Value = number | string | null | undefined | { id: number };
type Step = IteratorResult<Value, Value>;
interface Cursor extends IterableIterator<Value, Value, Value> { next(value?: Value): Step; return(value?: Value): Step; throw(error?: unknown): Step; }
function check(step: Step, value: Value, done: boolean, seen: Step[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
type Factory = (value: Value, log: unknown[]) => Cursor;
function model(value: Value, log: unknown[]): Cursor {
  let state = 0;
  return { [Symbol.iterator](): Cursor { return this; },
    next(sent?: Value): Step { if (state === 5) return { value: undefined, done: true }; if (state === 0) { state = 1; log.push("entry"); return { value: "first", done: false }; } if (state <= 2) { log.push(state === 1 ? "first:sent" : "first:resume", sent); state = 3; return { value: "second", done: false }; } log.push(state === 3 ? "second:sent" : "second:resume", sent, "finally"); state = 5; return { value, done: true }; },
    return(value?: Value): Step { if (state === 3 || state === 4) log.push("finally"); state = 5; return { value, done: true }; },
    throw(error?: unknown): Step { if (state === 1) { state = 2; log.push("first:catch", error); return { value: "first:recovery", done: false }; } if (state === 3) { state = 4; log.push("second:catch", error); return { value: "second:recovery", done: false }; } if (state === 4) log.push("finally"); state = 5; throw error; } };
}
function declared(value: Value, log: unknown[]): Cursor { return model(value, log); }
const expression = function (value: Value, log: unknown[]): Cursor { return model(value, log); };
const makers: Factory[] = [declared, expression];
function inject(cursor: Cursor, failure: unknown): Step { return cursor.throw(failure); }
const identity = { id: 53 }, failure = new RangeError("paused"), inputs: Value[] = [-0, NaN, undefined, identity];
for (const make of makers) for (const position of [1, 2]) for (const value of inputs) {
  const log: unknown[] = [], seen: Step[] = [], cursor = make(value, log), expected: unknown[] = ["entry"];
  check(cursor.next("ignored"), "first", false, seen);
  if (position === 1) { check(inject(cursor, failure), "first:recovery", false, seen); check(cursor.next(value), "second", false, seen); expected.push("first:catch", failure, "first:resume", value); }
  else { check(cursor.next(value), "second", false, seen); expected.push("first:sent", value); }
  if (position === 2) { check(inject(cursor, failure), "second:recovery", false, seen); check(cursor.next(identity), value, true, seen); expected.push("second:catch", failure, "second:resume", identity); }
  else { check(cursor.next(identity), value, true, seen); expected.push("second:sent", identity); }
  expected.push("finally"); check(cursor.next(), undefined, true, seen); assert.compareArray(log, expected);
}
