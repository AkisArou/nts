/*---
description: A returned generator preserves an escaping throw across a finally yield, and a throw at that cleanup yield replaces natural completion.
features: [ts-generator-route-return-throw-finally, ts-generators, ts-iteration, ts-arrays, ts-errors, ts-unknown, ts-unions, ts-null-undefined, ts-function-types, ts-interfaces]
---*/
// A typed return carries the generator; node suspends cleanup for a pending throw, rethrows its identity after next, and distinguishes an already-paused cleanup.
type Value = number | string | null | undefined | { id: number };
type Step = IteratorResult<Value, Value>;
interface Cursor extends IterableIterator<Value, Value, Value> { next(value?: Value): Step; return(value?: Value): Step; throw(error?: unknown): Step; }
function check(step: Step, value: Value, done: boolean, seen: Step[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
type Factory = (count: number, value: Value, log: unknown[]) => Cursor;
function* declared(count: number, value: Value, log: unknown[]): Generator<Value, Value, Value> { try { for (let i = 0; i < count; i++) { log.push("body", value); yield value; } return "natural"; } finally { log.push("cleanup"); const sent: Value = yield "cleanup"; log.push("resume", sent); } }
const expression = function* (count: number, value: Value, log: unknown[]): Generator<Value, Value, Value> { try { for (let i = 0; i < count; i++) { log.push("body", value); yield value; } return "natural"; } finally { log.push("cleanup"); const sent: Value = yield "cleanup"; log.push("resume", sent); } };
const makers: Factory[] = [declared, expression];
function opened(make: Factory, count: number, value: Value, log: unknown[]): Cursor { return make(count, value, log); }
const sentinel = {}, identity = { id: 61 }, failures: unknown[] = [new TypeError("pending"), identity, undefined];
function capture(action: () => unknown): unknown { try { action(); return sentinel; } catch (error) { return error; } }
for (const make of makers) for (const count of [0, 1, 3]) for (const failure of failures) {
  const log: unknown[] = [], seen: Step[] = [], cursor = opened(make, count, identity, log);
  check(cursor.next(), count === 0 ? "cleanup" : identity, false, seen);
  if (count === 0) assert.sameValue(capture(() => cursor.throw(failure)), failure);
  else { check(cursor.throw(failure), "cleanup", false, seen); assert.sameValue(capture(() => cursor.next(NaN)), failure); }
  check(cursor.next(), undefined, true, seen); check(cursor.return(-0), -0, true, seen);
  assert.compareArray(log, count === 0 ? ["cleanup"] : ["body", identity, "cleanup", "resume", NaN]);
}
