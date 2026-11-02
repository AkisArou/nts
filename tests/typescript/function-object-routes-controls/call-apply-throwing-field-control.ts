/*---
description: Explicit self and tuple control for Call and apply through a callback field preserve direct and deeper exceptions, including each original error identity.
features: [ts-function-object-route-call-apply, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-interfaces, ts-this-parameter, ts-this, ts-tuples, ts-errors, ts-unknown, ts-unions]
---*/
// A typed field carries declaration and method callbacks; call and apply keep exact receivers, complete operands and original TypeError or ReferenceError objects.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
let events: unknown[] = [];
const directError = new TypeError("direct"), deeperError = new ReferenceError("deeper");
function finish(self: Receiver, fail: boolean, first: Value, second: Value): Seen { events.push("deep", self, fail, first, second); if (fail) throw deeperError; return { self, items: [first, second] }; }
type Callback = (self: Receiver, items: [boolean, Value, Value]) => Seen;
interface Holder { fn: Callback; }
function direct(self: Receiver, items: [boolean, Value, Value]): Seen { const [fail, first, second] = items; events.push("entry", self, fail, first, second); if (fail) throw directError; return { self, items: [first, second] }; }
const owner = { method(self: Receiver, items: [boolean, Value, Value]): Seen { const [fail, first, second] = items; events.push("entry", self, fail, first, second); return finish(self, fail, first, second); } };
function invoke(holder: Holder, receiver: Receiver, items: [boolean, Value, Value], useApply: boolean): Seen { return holder.fn(receiver, [items[0], items[1], items[2]]); }
const choices: { fn: Callback; deep: boolean }[] = [{ fn: direct, deep: false }, { fn: owner.method, deep: true }];
const identity = { token: "operand" }, inputs: [Value, Value][] = [[-0, NaN], [undefined, null], [identity, "last"]];
for (const target of choices) for (const fail of [false, true]) for (const useApply of [false, true]) for (const input of inputs) {
  events = []; const receiver: Receiver = { tag: "supplied" }, holder: Holder = { fn: target.fn }, items: [boolean, Value, Value] = [fail, input[0], input[1]];
  let caught: unknown = undefined;
  const run = (): Seen => { try { return invoke(holder, receiver, items, useApply); } catch (error) { caught = error; events.push("catch", error); throw error; } };
  const expectedError = target.deep ? deeperError : directError;
  if (fail) { if (target.deep) assert.throws(ReferenceError, run); else assert.throws(TypeError, run); assert.sameValue(caught, expectedError); }
  else { const result = run(); assert.sameValue(result.self, receiver); assert.compareArray(result.items, input); assert.sameValue(caught, undefined); }
  const expected: unknown[] = ["entry", receiver, fail, input[0], input[1]];
  if (target.deep) expected.push("deep", receiver, fail, input[0], input[1]); if (fail) expected.push("catch", expectedError);
  assert.compareArray(events, expected); assert.compareArray(items, [fail, input[0], input[1]]); assert.sameValue(receiver.tag, "supplied");
}
