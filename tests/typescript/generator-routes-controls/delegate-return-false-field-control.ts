/*---
description: Explicit state control for A field-held generator stays suspended when a user delegate returns done false, then resumes the outer continuation on next.
features: [ts-generator-route-delegation, ts-generators, ts-iteration, ts-arrays, ts-unions, ts-symbols, ts-class, ts-class-fields, ts-interfaces, ts-function-types]
---*/
// Explicit iterator control: A generator field delegates to a cursor that declines return; node yields the cleanup payload, forwards the next send and runs the continuation after completion.
type Value = number | string | undefined | null | { id: number };
interface Cursor extends IterableIterator<Value, Value, Value> { return(value: Value): IteratorResult<Value, Value>; throw(error: unknown): IteratorResult<Value, Value>; }
function check(result: IteratorResult<Value, Value>, value: Value, done: boolean, seen: IteratorResult<Value, Value>[]): void {
  assert.sameValue(result.value, value); assert.sameValue(result.done, done); assert.compareArray(Object.keys(result), ["value", "done"]);
  for (const prior of seen) assert.sameValue(result === prior, false); seen.push(result);
}
class Pending implements Cursor {
  state: number = 0; result: Value; log: unknown[];
  constructor(result: Value, log: unknown[]) { this.result = result; this.log = log; }
  [Symbol.iterator](): Cursor { this.log.push(this, "iterator"); return this; }
  next(value?: Value): IteratorResult<Value, Value> { this.log.push(this, "next", value); if (this.state === 0) { this.state = 1; return { value: "body", done: false }; } this.state = 3; return { value: this.result, done: true }; }
  return(value: Value): IteratorResult<Value, Value> { this.log.push(this, "return", value); this.state = 2; return { value: "cleanup", done: false }; }
  throw(error: unknown): IteratorResult<Value, Value> { this.state = 3; throw error; }
}
function manual(source: Cursor, log: unknown[]): Cursor { let state = 0; return { [Symbol.iterator](): Cursor { return this; },
  next(value?: Value): IteratorResult<Value, Value> { if (state === 2) return { value: undefined, done: true }; if (state === 0) { source[Symbol.iterator](); value = undefined; state = 1; } const result = source.next(value); if (result.done) { state = 2; log.push("after", result.value); } return { value: result.value, done: result.done === true }; },
  return(value: Value): IteratorResult<Value, Value> { if (state !== 1) { state = 2; return { value, done: true }; } const result = source.return(value); if (result.done) state = 2; return { value: result.value, done: result.done === true }; },
  throw(error: unknown): IteratorResult<Value, Value> { state = 2; throw error; }
}; }
function declared(source: Cursor, log: unknown[]): Cursor { return manual(source, log); }
const expression = function (source: Cursor, log: unknown[]): Cursor { return manual(source, log); };
interface Holder { iterator: Cursor; }
const factories: ((source: Cursor, log: unknown[]) => Cursor)[] = [declared, expression], identity = { id: 73 };
for (const make of factories) for (const value of [-0, NaN, undefined, identity]) {
  const events: unknown[] = [], log: unknown[] = [], seen: IteratorResult<Value, Value>[] = [], source = new Pending(identity, events), holder: Holder = { iterator: make(source, log) };
  check(holder.iterator.next("ignored"), "body", false, seen); check(holder.iterator.return(value), "cleanup", false, seen);
  assert.compareArray(log, []); assert.sameValue(source.state, 2);
  check(holder.iterator.next(value), identity, true, seen); check(holder.iterator.next("late"), undefined, true, seen); check(holder.iterator.next(undefined), undefined, true, seen);
  assert.compareArray(events, [source, "iterator", source, "next", undefined, source, "return", value, source, "next", value]);
  assert.compareArray(log, ["after", identity]); assert.sameValue(source.state, 3);
}
