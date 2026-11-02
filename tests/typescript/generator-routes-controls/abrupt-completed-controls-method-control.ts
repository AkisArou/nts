/*---
description: A generator returned by an interface method distinguishes completed next, return and throw calls without repeating its finally.
features: [ts-generator-route-return-throw-finally, ts-generators, ts-iteration, ts-arrays, ts-errors, ts-unknown, ts-unions, ts-null-undefined, ts-class, ts-interfaces, ts-class-fields]
---*/
// Explicit state-number control; An interface method returns the same completed generator; node gives undefined to next, the supplied value to return, and the supplied error to throw.
type Value = number | string | null | undefined | { id: number };
type Step = IteratorResult<Value, Value>;
interface Cursor extends IterableIterator<Value, Value, Value> { next(value?: Value): Step; return(value?: Value): Step; throw(error?: unknown): Step; }
function check(step: Step, value: Value, done: boolean, seen: Step[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
interface Maker { open(count: number, value: Value, log: unknown[]): Cursor; }
function model(count: number, value: Value, log: unknown[]): Cursor {
  let state = 0, index = 0;
  return { [Symbol.iterator](): Cursor { return this; },
    next(): Step { if (state === 2) return { value: undefined, done: true }; state = 1; if (index++ < count) { log.push("yield", value); return { value, done: false }; } state = 2; log.push("finally"); return { value, done: true }; },
    return(value?: Value): Step { if (state === 1) log.push("finally"); state = 2; return { value, done: true }; },
    throw(error?: unknown): Step { if (state === 1) log.push("finally"); state = 2; throw error; } };
}
class Source { open(count: number, value: Value, log: unknown[]): Cursor { return model(count, value, log); } }
const literal: Maker = { open(count: number, value: Value, log: unknown[]): Cursor { return model(count, value, log); } };
const makers: Maker[] = [new Source(), literal];
interface Owner { current(): Cursor; }
class Holder implements Owner { source: Cursor; constructor(source: Cursor) { this.source = source; } current(): Cursor { return this.source; } }
const identity = { id: 79 }, replacement = { id: 83 }, inputs: Value[] = [-0, NaN, undefined, identity];
for (const make of makers) for (const count of [0, 1, 3]) for (const value of inputs) {
  const log: unknown[] = [], seen: Step[] = [], cursor = make.open(count, value, log), owner: Owner = new Holder(cursor), failure = new TypeError("completed");
  for (let i = 0; i < count; i++) check(owner.current().next(), value, false, seen);
  check(owner.current().next(), value, true, seen); check(owner.current().next(identity), undefined, true, seen);
  check(owner.current().return(replacement), replacement, true, seen); let caught: unknown = undefined;
  assert.throws(TypeError, () => { try { owner.current().throw(failure); } catch (error) { caught = error; throw error; } }); assert.sameValue(caught, failure);
  check(owner.current().next(), undefined, true, seen); check(owner.current().return(value), value, true, seen);
  const expected: unknown[] = []; for (let i = 0; i < count; i++) expected.push("yield", value); expected.push("finally"); assert.compareArray(log, expected); assert.sameValue(owner.current(), cursor);
}
