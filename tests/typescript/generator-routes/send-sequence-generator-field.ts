/*---
description: A full Generator field ignores its first send, routes each later send to the corresponding yield, returns its completion once and produces fresh results.
features: [ts-generator-route-sending-completion, ts-generators, ts-iteration, ts-arrays, ts-interfaces, ts-function-types, ts-unions, ts-null-undefined, ts-class]
---*/
// A Generator-typed field carries declaration and expression objects; node keeps zero, one and three yields distinct from their sends and completion.
type Value = number | string | null | undefined | { id: number };
type Step = IteratorResult<Value, Value>;
type Factory = (values: Value[], completion: Value, log: unknown[]) => Generator<Value, Value, Value>;
function check(step: { value: unknown; done?: boolean }, value: unknown, done: boolean, seen: object[]): void {
  assert.sameValue(step.value, value); assert.sameValue(step.done, done); assert.compareArray(Object.keys(step), ["value", "done"]);
  for (const previous of seen) assert.sameValue(step === previous, false);
  seen.push(step);
}
function* declared(values: Value[], completion: Value, log: unknown[]): Generator<Value, Value, Value> { log.push("start"); for (const value of values) { log.push("yield", value); const sent: Value = yield value; log.push("sent", sent); } log.push("return", completion); return completion; }
const expression = function* (values: Value[], completion: Value, log: unknown[]): Generator<Value, Value, Value> { log.push("start"); for (const value of values) { log.push("yield", value); const sent: Value = yield value; log.push("sent", sent); } log.push("return", completion); return completion; };
const makers: Factory[] = [declared, expression];
interface Holder { current: Generator<Value, Value, Value>; }
const identity = { id: 17 }, completion = { id: 91 }, inputs: Value[] = [-0, NaN, undefined, null, identity];
for (const make of makers) for (const count of [0, 1, 3]) for (const input of inputs) {
  const values: Value[] = [input, undefined, identity].slice(0, count), sends: Value[] = [identity, -0, "last send"], log: unknown[] = [], seen: object[] = [];
  const holder: Holder = { current: make(values, completion, log) }; let step = holder.current.next("ignored first send");
  for (let i = 0; i < count; i++) { check(step, values[i], false, seen); step = holder.current.next(sends[i]); }
  check(step, completion, true, seen); check(holder.current.next(identity), undefined, true, seen); check(holder.current.next(), undefined, true, seen);
  const expected: unknown[] = ["start"]; for (let i = 0; i < count; i++) expected.push("yield", values[i], "sent", sends[i]); expected.push("return", completion);
  assert.compareArray(log, expected);
}
