/*---
description: A generic return carries two-level delegation with distinct sent values and a completion object observed exactly once.
features: [ts-generator-route-delegation, ts-generators, ts-iteration, ts-arrays, ts-unions, ts-symbols, ts-generics, ts-function-types, ts-interfaces]
---*/
// Two delegated generator levels cross a generic return; node ignores the first send, keeps later sends in order and returns one completion identity.
type Value = number | string | undefined | null | { id: number };
interface Cursor extends IterableIterator<Value, Value, Value> { return(value: Value): IteratorResult<Value, Value>; throw(error: unknown): IteratorResult<Value, Value>; }
function check(result: IteratorResult<Value, Value>, value: Value, done: boolean, seen: IteratorResult<Value, Value>[]): void {
  assert.sameValue(result.value, value); assert.sameValue(result.done, done); assert.compareArray(Object.keys(result), ["value", "done"]);
  for (const prior of seen) assert.sameValue(result === prior, false); seen.push(result);
}
function* source(values: Value[], result: Value, log: unknown[]): Cursor { for (const value of values) { log.push("yield", value); const sent: Value = yield value; log.push("sent", sent); } log.push("source:return", result); return result; }
function* middle(inner: Cursor, log: unknown[]): Cursor { const result: Value = yield* inner; log.push("middle", result); return result; }
function* declared(inner: Cursor, log: unknown[]): Cursor { const result: Value = yield* middle(inner, log); log.push("outer", result); return result; }
const expression = function* (inner: Cursor, log: unknown[]): Cursor { const result: Value = yield* middle(inner, log); log.push("outer", result); return result; };
function retain<T extends Cursor>(value: T): T { return value; }
const factories: ((inner: Cursor, log: unknown[]) => Cursor)[] = [declared, expression], identity = { id: 19 };
const rows: Value[][] = [[], [undefined], [-0, NaN, identity]], sends: Value[] = [identity, "second", undefined];
for (const make of factories) for (const values of rows) {
  const completion = { id: 71 }, log: unknown[] = [], seen: IteratorResult<Value, Value>[] = [];
  const iterator = retain(make(source(values, completion, log), log));
  check(iterator.next("ignored"), values.length === 0 ? completion : values[0], values.length === 0, seen);
  for (let index = 0; index < values.length; index++) check(iterator.next(sends[index]), index + 1 < values.length ? values[index + 1] : completion, index + 1 === values.length, seen);
  const expected: unknown[] = []; for (let index = 0; index < values.length; index++) expected.push("yield", values[index], "sent", sends[index]);
  expected.push("source:return", completion, "middle", completion, "outer", completion);
  check(iterator.next(identity), undefined, true, seen); check(iterator.next(-0), undefined, true, seen); assert.compareArray(log, expected);
}
