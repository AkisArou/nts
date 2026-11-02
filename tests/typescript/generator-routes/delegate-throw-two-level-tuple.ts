/*---
description: A tuple-selected generator forwards throw through two levels, yields recovery and preserves the next send before ordered cleanup.
features: [ts-generator-route-delegation, ts-generators, ts-iteration, ts-arrays, ts-unions, ts-symbols, ts-tuples, ts-errors, ts-function-types]
---*/
// A generator tuple carries two delegation levels; node raises the original object at the inner pause, yields recovery and sends the later value to that recovery yield.
type Value = number | string | undefined | null | { id: number };
interface Cursor extends IterableIterator<Value, Value, Value> { return(value: Value): IteratorResult<Value, Value>; throw(error: unknown): IteratorResult<Value, Value>; }
function check(result: IteratorResult<Value, Value>, value: Value, done: boolean, seen: IteratorResult<Value, Value>[]): void {
  assert.sameValue(result.value, value); assert.sameValue(result.done, done); assert.compareArray(Object.keys(result), ["value", "done"]);
  for (const prior of seen) assert.sameValue(result === prior, false); seen.push(result);
}
function* inner(value: Value, log: unknown[]): Cursor { try { try { yield value; } catch (error) { log.push("caught", error); const sent: Value = yield "recovered"; log.push("sent", sent); return sent; } return "natural"; } finally { log.push("inner"); } }
function* middle(source: Cursor, log: unknown[]): Cursor { try { return yield* source; } finally { log.push("middle"); } }
function* declared(source: Cursor, log: unknown[]): Cursor { try { return yield* middle(source, log); } finally { log.push("outer"); } }
const expression = function* (source: Cursor, log: unknown[]): Cursor { try { return yield* middle(source, log); } finally { log.push("outer"); } };
const factories: ((source: Cursor, log: unknown[]) => Cursor)[] = [declared, expression], identity = { id: 83 };
for (const make of factories) for (const value of [-0, NaN, undefined, identity]) {
  const log: unknown[] = [], decoyLog: unknown[] = [], seen: IteratorResult<Value, Value>[] = [], failure = new RangeError("injected");
  const slots: [Cursor, Cursor] = [make(inner("decoy", decoyLog), decoyLog), make(inner(value, log), log)], iterator = slots[1];
  check(iterator.next("ignored"), value, false, seen); check(iterator.throw(failure), "recovered", false, seen); assert.compareArray(log, ["caught", failure]); assert.compareArray(decoyLog, []);
  check(iterator.next(value), value, true, seen); check(iterator.next(identity), undefined, true, seen); check(iterator.next(undefined), undefined, true, seen);
  assert.compareArray(log, ["caught", failure, "sent", value, "inner", "middle", "outer"]); check(slots[0].next(), "decoy", false, seen); check(slots[0].return(undefined), undefined, true, seen); assert.compareArray(decoyLog, ["inner", "middle", "outer"]);
}
