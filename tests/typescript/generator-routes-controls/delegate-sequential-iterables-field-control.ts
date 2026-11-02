/*---
description: Explicit state control for A typed generator field switches between two user iterables, discarding the transition send and keeping each receiver and completion distinct.
features: [ts-generator-route-delegation, ts-generators, ts-iteration, ts-arrays, ts-unions, ts-symbols, ts-class, ts-class-fields, ts-interfaces, ts-function-types]
---*/
// Explicit iterator control: A generator field delegates sequentially to two cursor objects; node starts each with undefined, forwards later sends to the active receiver and keeps both completions.
type Value = number | string | undefined | null | { id: number };
interface Cursor extends IterableIterator<Value, Value, Value> { return(value: Value): IteratorResult<Value, Value>; throw(error: unknown): IteratorResult<Value, Value>; }
function check(result: IteratorResult<Value, Value>, value: Value, done: boolean, seen: IteratorResult<Value, Value>[]): void {
  assert.sameValue(result.value, value); assert.sameValue(result.done, done); assert.compareArray(Object.keys(result), ["value", "done"]);
  for (const prior of seen) assert.sameValue(result === prior, false); seen.push(result);
}
class UserCursor implements Cursor {
  values: Value[]; result: Value; log: unknown[]; index: number = 0;
  constructor(values: Value[], result: Value, log: unknown[]) { this.values = values; this.result = result; this.log = log; }
  [Symbol.iterator](): Cursor { this.log.push(this, "iterator"); return this; }
  next(value?: Value): IteratorResult<Value, Value> { this.log.push(this, "next", value); return this.index < this.values.length ? { value: this.values[this.index++], done: false } : { value: this.result, done: true }; }
  return(value: Value): IteratorResult<Value, Value> { this.log.push(this, "return", value); return { value, done: true }; }
  throw(error: unknown): IteratorResult<Value, Value> { this.log.push(this, "throw", error); throw error; }
}
function manual(first: Cursor, second: Cursor, log: unknown[]): Cursor { let state = 0; return { [Symbol.iterator](): Cursor { return this; },
  next(value?: Value): IteratorResult<Value, Value> { if (state === 3) return { value: undefined, done: true }; if (state === 0) { first[Symbol.iterator](); state = 1; value = undefined; } if (state === 1) { const result = first.next(value); if (!result.done) return { value: result.value, done: false }; log.push("first:complete", result.value); second[Symbol.iterator](); state = 2; value = undefined; } const result = second.next(value); if (result.done) { state = 3; log.push("second:complete", result.value); } return { value: result.value, done: result.done === true }; },
  return(value: Value): IteratorResult<Value, Value> { state = 3; return { value, done: true }; }, throw(error: unknown): IteratorResult<Value, Value> { state = 3; throw error; }
}; }
function declared(first: Cursor, second: Cursor, log: unknown[]): Cursor { return manual(first, second, log); }
const expression = function (first: Cursor, second: Cursor, log: unknown[]): Cursor { return manual(first, second, log); };
interface Holder { iterator: Cursor; }
const factories: ((first: Cursor, second: Cursor, log: unknown[]) => Cursor)[] = [declared, expression];
const identity = { id: 41 }, rows: [Value[], Value[]][] = [[[], []], [[], [NaN, identity]], [[-0], []], [[undefined, identity], ["last"]]], sends: Value[] = ["one", null, identity];
for (const make of factories) for (const row of rows) {
  const a = { id: 51 }, b = { id: 52 }, log: unknown[] = [], seen: IteratorResult<Value, Value>[] = [];
  const first = new UserCursor(row[0], a, log), second = new UserCursor(row[1], b, log), holder: Holder = { iterator: make(first, second, log) }, out = row[0].concat(row[1]);
  check(holder.iterator.next("ignored"), out.length === 0 ? b : out[0], out.length === 0, seen);
  for (let index = 0; index < out.length; index++) check(holder.iterator.next(sends[index]), index + 1 < out.length ? out[index + 1] : b, index + 1 === out.length, seen);
  const expected: unknown[] = [first, "iterator", first, "next", undefined]; for (let index = 0; index < row[0].length; index++) expected.push(first, "next", sends[index]);
  expected.push("first:complete", a, second, "iterator", second, "next", undefined); for (let index = 0; index < row[1].length; index++) expected.push(second, "next", sends[row[0].length + index]); expected.push("second:complete", b);
  check(holder.iterator.next(identity), undefined, true, seen); check(holder.iterator.next(null), undefined, true, seen); assert.compareArray(log, expected);
  assert.sameValue(first.index, row[0].length); assert.sameValue(second.index, row[1].length);
}
