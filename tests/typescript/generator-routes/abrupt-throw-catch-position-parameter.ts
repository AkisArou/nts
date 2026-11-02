/*---
description: A generator passed to a typed throw helper catches each injected error at its actual paused yield and resumes with the subsequent send.
features: [ts-generator-route-return-throw-finally, ts-generators, ts-iteration, ts-arrays, ts-errors, ts-unknown, ts-unions, ts-null-undefined, ts-interfaces, ts-function-types]
---*/
// A typed parameter carries a generator with two catch regions; node selects the catch enclosing the paused yield and preserves the recovery send.
type Value = number | string | null | undefined | { id: number };
type Step = IteratorResult<Value, Value>;
interface Cursor extends IterableIterator<Value, Value, Value> { next(value?: Value): Step; return(value?: Value): Step; throw(error?: unknown): Step; }
function check(step: Step, value: Value, done: boolean, seen: Step[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
type Factory = (value: Value, log: unknown[]) => Cursor;
function* declared(value: Value, log: unknown[]): Generator<Value, Value, Value> { log.push("entry"); try { const sent: Value = yield "first"; log.push("first:sent", sent); } catch (error) { log.push("first:catch", error); const sent: Value = yield "first:recovery"; log.push("first:resume", sent); } try { const sent: Value = yield "second"; log.push("second:sent", sent); } catch (error) { log.push("second:catch", error); const sent: Value = yield "second:recovery"; log.push("second:resume", sent); } finally { log.push("finally"); } return value; }
const expression = function* (value: Value, log: unknown[]): Generator<Value, Value, Value> { log.push("entry"); try { const sent: Value = yield "first"; log.push("first:sent", sent); } catch (error) { log.push("first:catch", error); const sent: Value = yield "first:recovery"; log.push("first:resume", sent); } try { const sent: Value = yield "second"; log.push("second:sent", sent); } catch (error) { log.push("second:catch", error); const sent: Value = yield "second:recovery"; log.push("second:resume", sent); } finally { log.push("finally"); } return value; };
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
