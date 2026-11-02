/*---
description: A generic-carried generator suspends in two nested finally blocks while preserving its pending return value and both sent values.
features: [ts-generator-route-return-throw-finally, ts-generators, ts-iteration, ts-arrays, ts-errors, ts-unknown, ts-unions, ts-null-undefined, ts-generics, ts-function-types]
---*/
// A generic identity carries the generator; node yields inner then outer cleanup, accepts each send and returns the original pending value.
type Value = number | string | null | undefined | { id: number };
type Step = IteratorResult<Value, Value>;
interface Cursor extends IterableIterator<Value, Value, Value> { next(value?: Value): Step; return(value?: Value): Step; throw(error?: unknown): Step; }
function check(step: Step, value: Value, done: boolean, seen: Step[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
type Factory = (count: number, value: Value, log: unknown[]) => Cursor;
function* declared(count: number, value: Value, log: unknown[]): Generator<Value, Value, Value> { try { for (let i = 0; i < count; i++) { log.push("body", value); yield value; } return "natural"; } finally { try { log.push("inner"); const sent: Value = yield "inner"; log.push("inner:sent", sent); } finally { log.push("outer"); const sent: Value = yield "outer"; log.push("outer:sent", sent); } } }
const expression = function* (count: number, value: Value, log: unknown[]): Generator<Value, Value, Value> { try { for (let i = 0; i < count; i++) { log.push("body", value); yield value; } return "natural"; } finally { try { log.push("inner"); const sent: Value = yield "inner"; log.push("inner:sent", sent); } finally { log.push("outer"); const sent: Value = yield "outer"; log.push("outer:sent", sent); } } };
const makers: Factory[] = [declared, expression];
function retain<T extends Cursor>(cursor: T): T { return cursor; }
const identity = { id: 31 }, inputs: Value[] = [-0, NaN, undefined, identity];
for (const make of makers) for (const count of [1, 3]) for (const value of inputs) {
  const log: unknown[] = [], seen: Step[] = [], cursor = retain(make(count, value, log));
  check(cursor.next("ignored"), value, false, seen); check(cursor.return(value), "inner", false, seen);
  check(cursor.next(identity), "outer", false, seen); check(cursor.next(NaN), value, true, seen); check(cursor.next(), undefined, true, seen);
  assert.compareArray(log, ["body", value, "inner", "inner:sent", identity, "outer", "outer:sent", NaN]);
}
