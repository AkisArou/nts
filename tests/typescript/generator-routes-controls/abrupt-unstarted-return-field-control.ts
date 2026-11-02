/*---
description: An unstarted generator in a typed field returns the supplied value without entering its body or finally, then stays completed.
features: [ts-generator-route-return-throw-finally, ts-generators, ts-iteration, ts-arrays, ts-errors, ts-unknown, ts-unions, ts-null-undefined, ts-interfaces, ts-function-types]
---*/
// Explicit state-number control; A field carries unstarted zero, one and several-yield generators; node skips their bodies and returns each supplied completion value.
type Value = number | string | null | undefined | { id: number };
type Step = IteratorResult<Value, Value>;
interface Cursor extends IterableIterator<Value, Value, Value> { next(value?: Value): Step; return(value?: Value): Step; throw(error?: unknown): Step; }
function check(step: Step, value: Value, done: boolean, seen: Step[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
type Factory = (count: number, value: Value, log: unknown[]) => Cursor;
function model(count: number, value: Value, log: unknown[]): Cursor {
  let state = 0, index = 0;
  return { [Symbol.iterator](): Cursor { return this; },
    next(): Step { if (state === 2) return { value: undefined, done: true }; if (state === 0) { state = 1; log.push("body"); } if (index++ < count) return { value, done: false }; state = 2; log.push("finally"); return { value, done: true }; },
    return(value?: Value): Step { if (state === 1) log.push("finally"); state = 2; return { value, done: true }; },
    throw(error?: unknown): Step { if (state === 1) log.push("finally"); state = 2; throw error; } };
}
function declared(count: number, value: Value, log: unknown[]): Cursor { return model(count, value, log); }
const expression = function (count: number, value: Value, log: unknown[]): Cursor { return model(count, value, log); };
const makers: Factory[] = [declared, expression];
interface Holder { current: Cursor; }
const identity = { id: 41 }, replacement = { id: 73 }, inputs: Value[] = [-0, NaN, undefined, null, identity];
for (const make of makers) for (const count of [0, 1, 3]) for (const value of inputs) {
  const log: unknown[] = [], seen: Step[] = []; const holder: Holder = { current: make(count, value, log) };
  check(holder.current.return(value), value, true, seen); check(holder.current.next(identity), undefined, true, seen);
  check(holder.current.return(replacement), replacement, true, seen); check(holder.current.next(), undefined, true, seen);
  assert.compareArray(log, []);
}
