/*---
description: Explicit function-record control for A method stored in a typed field follows the receiver at each call after detachment and reattachment.
features: [ts-function-object-route-call-apply, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-interfaces, ts-this-parameter, ts-this, ts-objects, ts-tuples]
---*/
// Object methods cross a typed handler field; call and reattached method invocation receive their separate receivers and ordered operands.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
type Callback = (self: Receiver, first: Value, second: Value) => Seen;
interface Holder extends Receiver { handler: Callback; }
const source = { tag: "source", left(self: Receiver, first: Value, second: Value): Seen { return { self, items: [first, second] }; }, right(self: Receiver, first: Value, second: Value): Seen { return { self, items: [first, second] }; } };
function observe(fn: Callback, receiver: Receiver, items: [Value, Value]): { results: [Seen, Seen, Seen]; holder: Holder } {
  const holder: Holder = { tag: "holder", handler: fn };
  return { results: [fn(receiver, ...items), holder.handler(holder, ...items), holder.handler(source, ...items)], holder };
}
const choices: Callback[] = [source.left, source.right];
const identity = { token: "item" }, inputs: [Value, Value][] = [[-0, NaN], [undefined, null], ["left", identity]];
for (const fn of choices) for (const items of inputs) {
  const receiver: Receiver = { tag: "explicit" }, observed = observe(fn, receiver, items), results = observed.results;
  assert.sameValue(results[0].self, receiver); assert.sameValue(results[1].self, observed.holder); assert.sameValue(observed.holder.tag, "holder");
  assert.sameValue(results[1].self === receiver, false); assert.sameValue(results[1].self === source, false);
  assert.sameValue(results[2].self, source);
  for (const result of results) assert.compareArray(result.items, items);
  assert.sameValue(source.tag, "source"); assert.sameValue(receiver.tag, "explicit");
}
