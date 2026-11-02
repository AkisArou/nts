/*---
description: A second return through a class field replaces the pending completion while cleanup is suspended and still runs the outer finally.
features: [ts-generator-route-return-throw-finally, ts-generators, ts-iteration, ts-arrays, ts-errors, ts-unknown, ts-unions, ts-null-undefined, ts-class, ts-class-fields, ts-function-types]
---*/
// A class field carries a generator paused inside finally; node replaces the pending return, skips that yield continuation and closes the outer region.
type Value = number | string | null | undefined | { id: number };
type Step = IteratorResult<Value, Value>;
interface Cursor extends IterableIterator<Value, Value, Value> { next(value?: Value): Step; return(value?: Value): Step; throw(error?: unknown): Step; }
function check(step: Step, value: Value, done: boolean, seen: Step[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
type Factory = (count: number, value: Value, log: unknown[]) => Cursor;
function* declared(count: number, value: Value, log: unknown[]): Generator<Value, Value, Value> { try { for (let i = 0; i < count; i++) { log.push("body", value); yield value; } return "natural"; } finally { try { log.push("inner"); yield "cleanup"; log.push("inner:after"); } finally { log.push("outer"); } } }
const expression = function* (count: number, value: Value, log: unknown[]): Generator<Value, Value, Value> { try { for (let i = 0; i < count; i++) { log.push("body", value); yield value; } return "natural"; } finally { try { log.push("inner"); yield "cleanup"; log.push("inner:after"); } finally { log.push("outer"); } } };
const makers: Factory[] = [declared, expression];
class Holder { current: Cursor; constructor(current: Cursor) { this.current = current; } }
const identity = { id: 43 }, replacement = { id: 97 }, inputs: Value[] = [-0, NaN, undefined, identity];
for (const make of makers) for (const count of [1, 3]) for (const value of inputs) {
  const log: unknown[] = [], seen: Step[] = [], holder = new Holder(make(count, value, log));
  check(holder.current.next(), value, false, seen); check(holder.current.return(value), "cleanup", false, seen);
  const replaced = holder.current.return(replacement);
  check(replaced, replacement, true, seen); check(holder.current.next(identity), undefined, true, seen);
  assert.compareArray(log, ["body", value, "inner", "outer"]);
}
