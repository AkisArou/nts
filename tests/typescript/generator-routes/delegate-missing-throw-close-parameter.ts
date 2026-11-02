/*---
description: A generator passed as a cursor parameter closes a delegate with no throw method before throwing TypeError or the close error.
features: [ts-generator-route-delegation, ts-generators, ts-iteration, ts-arrays, ts-unions, ts-symbols, ts-class, ts-errors, ts-function-types, ts-unknown]
---*/
// A cursor parameter carries delegation to an iterable without throw; node calls its return with zero arguments before TypeError, and preserves a throwing close identity.
type Value = number | string | undefined | null | { id: number };
interface Cursor extends IterableIterator<Value, Value, Value> { return(value: Value): IteratorResult<Value, Value>; throw(error: unknown): IteratorResult<Value, Value>; }
function check(result: IteratorResult<Value, Value>, value: Value, done: boolean, seen: IteratorResult<Value, Value>[]): void {
  assert.sameValue(result.value, value); assert.sameValue(result.done, done); assert.compareArray(Object.keys(result), ["value", "done"]);
  for (const prior of seen) assert.sameValue(result === prior, false); seen.push(result);
}
class Bare implements IterableIterator<Value, Value, Value> {
  log: unknown[]; failure: RangeError | undefined;
  constructor(log: unknown[], failure: RangeError | undefined) { this.log = log; this.failure = failure; }
  [Symbol.iterator](): Bare { this.log.push(this, "iterator"); return this; }
  next(value?: Value): IteratorResult<Value, Value> { this.log.push(this, "next", value); return { value: "body", done: false }; }
  return(value?: Value): IteratorResult<Value, Value> { this.log.push(this, "close", arguments.length, value); if (this.failure !== undefined) throw this.failure; return { value: "ignored close value", done: false }; }
}
function* declared(source: Bare, log: unknown[]): Cursor { try { return yield* source; } finally { log.push("outer"); } }
const expression = function* (source: Bare, log: unknown[]): Cursor { try { return yield* source; } finally { log.push("outer"); } };
function inject(iterator: Cursor, error: unknown): IteratorResult<Value, Value> { return iterator.throw(error); }
const factories: ((source: Bare, log: unknown[]) => Cursor)[] = [declared, expression];
for (const make of factories) for (const closeThrows of [false, true]) for (const injected of [new Error("input"), undefined, -0]) {
  const log: unknown[] = [], seen: IteratorResult<Value, Value>[] = [], closeError = new RangeError("close"), source = new Bare(log, closeThrows ? closeError : undefined), iterator = make(source, log);
  check(iterator.next("ignored"), "body", false, seen); let caught: unknown = undefined;
  const run = (): void => { try { inject(iterator, injected); } catch (error) { caught = error; throw error; } };
  if (closeThrows) { assert.throws(RangeError, run); assert.sameValue(caught, closeError); } else { assert.throws(TypeError, run); assert.sameValue(caught === injected, false); }
  check(iterator.next(undefined), undefined, true, seen); check(iterator.next("late"), undefined, true, seen);
  assert.compareArray(log, [source, "iterator", source, "next", undefined, source, "close", 0, undefined, "outer"]);
}
