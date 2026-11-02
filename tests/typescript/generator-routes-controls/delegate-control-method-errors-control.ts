/*---
description: Explicit state control for A typed cursor parameter forwards return and throw to the active delegate and preserves direct or deeper failures and successful peers.
features: [ts-generator-route-delegation, ts-generators, ts-iteration, ts-arrays, ts-unions, ts-symbols, ts-class, ts-errors, ts-function-types, ts-unknown]
---*/
// Explicit iterator control: A generator cursor parameter dispatches return or throw; node preserves the delegate receiver, original injected value, escaping failure identity and outer cleanup.
type Value = number | string | undefined | null | { id: number };
interface Cursor extends IterableIterator<Value, Value, Value> { return(value: Value): IteratorResult<Value, Value>; throw(error: unknown): IteratorResult<Value, Value>; }
function check(result: IteratorResult<Value, Value>, value: Value, done: boolean, seen: IteratorResult<Value, Value>[]): void {
  assert.sameValue(result.value, value); assert.sameValue(result.done, done); assert.compareArray(Object.keys(result), ["value", "done"]);
  for (const prior of seen) assert.sameValue(result === prior, false); seen.push(result);
}
function deeper(failure: RangeError, log: unknown[]): never { log.push("deeper"); throw failure; }
function fail(depth: number, failure: RangeError, log: unknown[]): void { if (depth === 1) throw failure; if (depth === 2) deeper(failure, log); }
class Delegate implements Cursor {
  depth: number; failure: RangeError; log: unknown[];
  constructor(depth: number, failure: RangeError, log: unknown[]) { this.depth = depth; this.failure = failure; this.log = log; }
  [Symbol.iterator](): Cursor { this.log.push(this, "iterator"); return this; }
  next(value?: Value): IteratorResult<Value, Value> { this.log.push(this, "next", value); return { value: "body", done: false }; }
  return(value: Value): IteratorResult<Value, Value> { this.log.push(this, "return", value); fail(this.depth, this.failure, this.log); return { value, done: true }; }
  throw(error: unknown): IteratorResult<Value, Value> { this.log.push(this, "throw", error); fail(this.depth, this.failure, this.log); return { value: "recovered", done: false }; }
}
function manual(source: Cursor, log: unknown[]): Cursor { let state = 0;
  function finish(result: IteratorResult<Value, Value>): IteratorResult<Value, Value> { if (result.done) { state = 2; log.push("outer"); } return { value: result.value, done: result.done === true }; }
  return { [Symbol.iterator](): Cursor { return this; },
    next(value?: Value): IteratorResult<Value, Value> { if (state === 2) return { value: undefined, done: true }; if (state === 0) { source[Symbol.iterator](); value = undefined; state = 1; } return finish(source.next(value)); },
    return(value: Value): IteratorResult<Value, Value> { if (state !== 1) { state = 2; return { value, done: true }; } try { return finish(source.return(value)); } catch (error) { state = 2; log.push("outer"); throw error; } },
    throw(error: unknown): IteratorResult<Value, Value> { if (state !== 1) { state = 2; throw error; } try { return finish(source.throw(error)); } catch (failure) { state = 2; log.push("outer"); throw failure; } }
  };
}
function declared(source: Cursor, log: unknown[]): Cursor { return manual(source, log); }
const expression = function (source: Cursor, log: unknown[]): Cursor { return manual(source, log); };
function dispatch(iterator: Cursor, operation: string, value: Value): IteratorResult<Value, Value> { return operation === "return" ? iterator.return(value) : iterator.throw(value); }
const factories: ((source: Cursor, log: unknown[]) => Cursor)[] = [declared, expression], identity = { id: 97 };
for (const make of factories) for (const depth of [0, 1, 2]) for (const operation of ["return", "throw"]) for (const value of [-0, undefined, identity]) {
  const log: unknown[] = [], seen: IteratorResult<Value, Value>[] = [], failure = new RangeError("delegate"), source = new Delegate(depth, failure, log), iterator = make(source, log);
  check(iterator.next("ignored"), "body", false, seen); let caught: unknown = undefined;
  const run = (): IteratorResult<Value, Value> => { try { return dispatch(iterator, operation, value); } catch (error) { caught = error; throw error; } };
  const expected: unknown[] = [source, "iterator", source, "next", undefined, source, operation, value];
  if (depth > 0) { assert.throws(RangeError, run); assert.sameValue(caught, failure); if (depth === 2) expected.push("deeper"); }
  else { check(run(), operation === "return" ? value : "recovered", operation === "return", seen); assert.sameValue(caught, undefined); if (operation === "throw") { check(iterator.return(identity), identity, true, seen); expected.push(source, "return", identity); } }
  expected.push("outer"); check(iterator.next(value), undefined, true, seen); check(iterator.next(undefined), undefined, true, seen); assert.compareArray(log, expected);
}
