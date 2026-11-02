/*---
description: Writes to a yielded or completed result do not change a generator stored in an Iterator array or its later fresh results.
features: [ts-generator-route-sending-completion, ts-generators, ts-iteration, ts-arrays, ts-interfaces, ts-function-types, ts-unions, ts-null-undefined, ts-objects]
---*/
// An Iterator array element carries the generator; node keeps writable result records separate from the state that determines subsequent values and completion.
type Value = number | string | undefined | { id: number };
type Step = IteratorResult<Value, Value>;
interface Cursor extends IterableIterator<Value, Value, Value> { return(value?: Value): Step; throw(error?: unknown): Step; }
type Factory = (values: Value[], completion: Value, log: unknown[]) => Cursor;
function check(step: { value: unknown; done?: boolean }, value: unknown, done: boolean, seen: object[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
function* declared(values: Value[], completion: Value, log: unknown[]): Generator<Value, Value, Value> { for (const value of values) { const sent: Value = yield value; log.push(sent); } return completion; }
const expression = function* (values: Value[], completion: Value, log: unknown[]): Generator<Value, Value, Value> { for (const value of values) { const sent: Value = yield value; log.push(sent); } return completion; };
const makers: Factory[] = [declared, expression];
const identity = { id: 37 }, completion = { id: 101 }, replacement = { id: 103 }, inputs: Value[] = [-0, NaN, undefined, identity];
for (const make of makers) for (const count of [0, 1, 3]) for (const input of inputs) {
  const values: Value[] = [input, identity, undefined].slice(0, count), sends: Value[] = [identity, "middle", -0], log: unknown[] = [], seen: object[] = [];
  const cursors: Iterator<Value, Value, Value>[] = [make(values, completion, log)];
  for (const cursor of cursors) {
    const first = cursor.next("ignored"); check(first, count === 0 ? completion : values[0], count === 0, seen);
    first.value = replacement; first.done = !first.done;
    assert.sameValue(first.value, replacement); assert.sameValue(first.done, count !== 0);
    for (let i = 1; i < count; i++) check(cursor.next(sends[i - 1]), values[i], false, seen);
    check(cursor.next(count === 0 ? identity : sends[count - 1]), count === 0 ? undefined : completion, true, seen); check(cursor.next(identity), undefined, true, seen);
    assert.sameValue(first.value, replacement); assert.sameValue(first.done, count !== 0); assert.compareArray(log, sends.slice(0, count));
  }
}
