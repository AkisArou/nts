/*---
description: Generator objects in a typed array preserve direct and deeper escaping errors and run finally exactly once after zero, one or several yields.
features: [ts-generator-route-return-throw-finally, ts-generators, ts-iteration, ts-arrays, ts-errors, ts-unknown, ts-unions, ts-null-undefined, ts-class, ts-static, ts-function-types]
---*/
// An array carries direct and static generator instances; node returns normally or exposes the original direct/helper error after ordered cleanup.
type Value = number | string | null | undefined | { id: number };
type Step = IteratorResult<Value, Value>;
interface Cursor extends IterableIterator<Value, Value, Value> { next(value?: Value): Step; return(value?: Value): Step; throw(error?: unknown): Step; }
function check(step: Step, value: Value, done: boolean, seen: Step[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
type Factory = (count: number, value: Value, fail: boolean, failure: TypeError, log: unknown[]) => Cursor;
function finish(value: Value, fail: boolean, failure: TypeError, log: unknown[]): Value { log.push("helper"); if (fail) throw failure; return value; }
function* direct(count: number, value: Value, fail: boolean, failure: TypeError, log: unknown[]): Generator<Value, Value, Value> { try { for (let i = 0; i < count; i++) { log.push("yield", value); yield value; } log.push("direct"); if (fail) throw failure; return value; } finally { log.push("finally"); } }
class Source { static *deeper(count: number, value: Value, fail: boolean, failure: TypeError, log: unknown[]): Generator<Value, Value, Value> { try { for (let i = 0; i < count; i++) { log.push("yield", value); yield value; } return finish(value, fail, failure, log); } finally { log.push("finally"); } } }
const makers: { make: Factory; deep: boolean }[] = [{ make: direct, deep: false }, { make: Source.deeper, deep: true }];
const identity = { id: 71 }, inputs: Value[] = [-0, NaN, undefined, identity];
for (const maker of makers) for (const count of [0, 1, 3]) for (const fail of [false, true]) for (const value of inputs) {
  const log: unknown[] = [], seen: Step[] = [], failure = new TypeError("escape"), cursors: Cursor[] = [maker.make(count, value, fail, failure, log)];
  for (const cursor of cursors) {
    for (let i = 0; i < count; i++) check(cursor.next(identity), value, false, seen);
    let caught: unknown = undefined;
    if (fail) { assert.throws(TypeError, () => { try { cursor.next(value); } catch (error) { caught = error; throw error; } }); assert.sameValue(caught, failure); }
    else { check(cursor.next(value), value, true, seen); assert.sameValue(caught, undefined); }
    check(cursor.next(), undefined, true, seen); check(cursor.return(identity), identity, true, seen);
    const expected: unknown[] = []; for (let i = 0; i < count; i++) expected.push("yield", value); expected.push(maker.deep ? "helper" : "direct", "finally"); assert.compareArray(log, expected);
  }
}
