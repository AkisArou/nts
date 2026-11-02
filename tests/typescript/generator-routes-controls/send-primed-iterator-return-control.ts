/*---
description: A typed helper returns an already advanced generator without losing its paused or completed position and remaining send history.
features: [ts-generator-route-sending-completion, ts-generators, ts-iteration, ts-arrays, ts-interfaces, ts-function-types, ts-unions, ts-null-undefined]
---*/
// Explicit state-number control; A typed Iterator return carries a primed generator; node continues after its consumed first result and never restarts an exhausted zero-yield object.
type Value = number | string | undefined | { id: number };
type Step = IteratorResult<Value, Value>;
interface Cursor extends IterableIterator<Value, Value, Value> { return(value?: Value): Step; throw(error?: unknown): Step; }
type Factory = (values: Value[], completion: Value, log: unknown[]) => Cursor;
function check(step: { value: unknown; done?: boolean }, value: unknown, done: boolean, seen: object[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
function model(values: Value[], completion: Value, log: unknown[]): Cursor {
  let state = 0, index = 0;
  return { [Symbol.iterator](): Cursor { return this; },
    next(sent?: Value): Step { if (state === 2) return { value: undefined, done: true }; if (state === 0) { state = 1; log.push("start"); } else log.push("sent", sent); if (index < values.length) { const value = values[index++]; log.push("yield", value); return { value, done: false }; } state = 2; log.push("return", completion); return { value: completion, done: true }; },
    return(value?: Value): Step { state = 2; return { value, done: true }; }, throw(error?: unknown): Step { state = 2; throw error; } };
}
function declared(values: Value[], completion: Value, log: unknown[]): Cursor { return model(values, completion, log); }
const literal = { open(values: Value[], completion: Value, log: unknown[]): Cursor { return model(values, completion, log); } };
const makers: Factory[] = [declared, literal.open];
function prime(make: Factory, values: Value[], completion: Value, log: unknown[], seen: object[]): Iterator<Value, Value, Value> {
  const cursor = make(values, completion, log); check(cursor.next("ignored"), values.length === 0 ? completion : values[0], values.length === 0, seen);
  return cursor;
}
const identity = { id: 23 }, completion = { id: 97 }, inputs: Value[] = [-0, NaN, undefined, identity];
for (const make of makers) for (const count of [0, 1, 3]) for (const input of inputs) {
  const values: Value[] = [input, identity, undefined].slice(0, count), sends: Value[] = ["first", -0, identity], log: unknown[] = [], seen: object[] = [];
  const cursor = prime(make, values, completion, log, seen); let step = cursor.next(sends[0]);
  for (let i = 1; i < count; i++) { check(step, values[i], false, seen); step = cursor.next(sends[i]); }
  check(step, count === 0 ? undefined : completion, true, seen); check(cursor.next(identity), undefined, true, seen);
  const expected: unknown[] = ["start"]; for (let i = 0; i < count; i++) expected.push("yield", values[i], "sent", sends[i]); expected.push("return", completion); assert.compareArray(log, expected);
}
