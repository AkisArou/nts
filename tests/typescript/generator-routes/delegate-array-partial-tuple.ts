/*---
description: A tuple-held generator delegates sparse arrays, then yields its own tail, or closes before that continuation.
features: [ts-generator-route-delegation, ts-generators, ts-iteration, ts-arrays, ts-unions, ts-symbols, ts-tuples, ts-function-types, ts-errors, ts-null-undefined]
---*/
// A generator in a typed tuple delegates arrays with holes; node resumes its own tail only after exhaustion and closes exactly once on early return.
type Value = number | string | undefined | null | { id: number };
interface Cursor extends IterableIterator<Value, Value, Value> { return(value: Value): IteratorResult<Value, Value>; throw(error: unknown): IteratorResult<Value, Value>; }
function check(result: IteratorResult<Value, Value>, value: Value, done: boolean, seen: IteratorResult<Value, Value>[]): void {
  assert.sameValue(result.value, value); assert.sameValue(result.done, done); assert.compareArray(Object.keys(result), ["value", "done"]);
  for (const prior of seen) assert.sameValue(result === prior, false); seen.push(result);
}
function* declared(values: Value[], log: unknown[]): Cursor { log.push("start"); try { const result: unknown = yield* values; log.push("after", result); const sent: Value = yield "tail"; log.push("tail:sent", sent); return "finished"; } finally { log.push("finally"); } }
const expression = function* (values: Value[], log: unknown[]): Cursor { log.push("start"); try { const result: unknown = yield* values; log.push("after", result); const sent: Value = yield "tail"; log.push("tail:sent", sent); return "finished"; } finally { log.push("finally"); } };
const factories: ((values: Value[], log: unknown[]) => Cursor)[] = [declared, expression], identity = { id: 29 };
const rows: { values: Value[]; expected: Value[] }[] = [{ values: [], expected: [] }, { values: [undefined], expected: [undefined] }, { values: new Array<Value>(2), expected: [undefined, undefined] }, { values: [-0, , identity, NaN], expected: [-0, undefined, identity, NaN] }];
for (const make of factories) for (const row of rows) for (const close of [false, true]) {
  const log: unknown[] = [], seen: IteratorResult<Value, Value>[] = [], keys = Object.keys(row.values);
  const slot: [Cursor, string] = [make(row.values, log), "saved"], iterator = slot[0], expected: unknown[] = ["start"];
  check(iterator.next("ignored"), row.expected.length === 0 ? "tail" : row.expected[0], false, seen);
  if (close) { check(iterator.return(identity), identity, true, seen); if (row.expected.length === 0) expected.push("after", undefined); }
  else { for (let index = 1; index <= row.expected.length; index++) check(iterator.next(-0), index === row.expected.length ? "tail" : row.expected[index], false, seen); check(iterator.next(identity), "finished", true, seen); expected.push("after", undefined, "tail:sent", identity); }
  expected.push("finally"); check(iterator.next(NaN), undefined, true, seen); check(iterator.next(undefined), undefined, true, seen);
  assert.compareArray(log, expected); assert.compareArray(Object.keys(row.values), keys); assert.compareArray(row.values, row.expected); assert.sameValue(slot[1], "saved");
}
