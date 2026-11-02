/*---
description: A method-returned generator forwards return through two levels and runs inner, middle and outer cleanup once in order.
features: [ts-generator-route-delegation, ts-generators, ts-iteration, ts-arrays, ts-unions, ts-symbols, ts-class, ts-interfaces, ts-errors, ts-function-types]
---*/
// A method return carries a twice-delegating generator; node preserves an early return payload and unwinds inner-to-outer, including empty and already-finished states.
type Value = number | string | undefined | null | { id: number };
interface Cursor extends IterableIterator<Value, Value, Value> { return(value: Value): IteratorResult<Value, Value>; throw(error: unknown): IteratorResult<Value, Value>; }
function check(result: IteratorResult<Value, Value>, value: Value, done: boolean, seen: IteratorResult<Value, Value>[]): void {
  assert.sameValue(result.value, value); assert.sameValue(result.done, done); assert.compareArray(Object.keys(result), ["value", "done"]);
  for (const prior of seen) assert.sameValue(result === prior, false); seen.push(result);
}
function* inner(values: Value[], log: unknown[]): Cursor { try { for (const value of values) yield value; return "natural"; } finally { log.push("inner"); } }
function* middle(source: Cursor, log: unknown[]): Cursor { try { return yield* source; } finally { log.push("middle"); } }
class Factory { *make(source: Cursor, log: unknown[]): Cursor { try { return yield* middle(source, log); } finally { log.push("outer"); } } }
const literal = { *make(source: Cursor, log: unknown[]): Cursor { try { return yield* middle(source, log); } finally { log.push("outer"); } } };
interface Maker { make(source: Cursor, log: unknown[]): Cursor; }
const factories: Maker[] = [new Factory(), literal], identity = { id: 61 }, rows: Value[][] = [[], [-0], [NaN, undefined, identity]];
for (const factory of factories) for (const values of rows) for (const result of [undefined, -0, NaN, identity]) {
  const log: unknown[] = [], seen: IteratorResult<Value, Value>[] = [], decoyLog: unknown[] = [], decoy = inner(["decoy"], decoyLog), iterator = factory.make(inner(values, log), log);
  check(iterator.next("ignored"), values.length === 0 ? "natural" : values[0], values.length === 0, seen);
  check(iterator.return(result), result, true, seen); assert.compareArray(log, ["inner", "middle", "outer"]); assert.compareArray(decoyLog, []);
  check(iterator.return(identity), identity, true, seen); check(iterator.next(result), undefined, true, seen); check(iterator.next(undefined), undefined, true, seen);
  const failure = new RangeError("finished"); let caught: unknown = undefined; try { iterator.throw(failure); } catch (error) { caught = error; }
  assert.sameValue(caught, failure); assert.compareArray(log, ["inner", "middle", "outer"]); check(decoy.next(), "decoy", false, seen); check(decoy.return(undefined), undefined, true, seen); assert.compareArray(decoyLog, ["inner"]);
}
