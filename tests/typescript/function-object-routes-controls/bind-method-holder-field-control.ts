/*---
description: Explicit function-record control for A bound class method stored in a foreign object field retains its original receiver and observes later receiver writes.
features: [ts-function-object-route-bind, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-class, ts-class-fields, ts-interfaces, ts-this-parameter, ts-this]
---*/
// Bound class methods cross a typed handler field; field invocation cannot replace the bound receiver or its prepended operand.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
interface Result extends Seen { tag: string; }
interface Callback { body: (self: Receiver, first: Value, second: Value) => Result; label: string; arity: number; }
class BoundWorker { tag: string = "source"; left(self: Receiver, first: Value, second: Value): Result { return { self, items: [first, second], tag: self.tag }; } right(self: Receiver, first: Value, second: Value): Result { return { self, items: [first, second], tag: self.tag }; } }
interface Holder extends Receiver { handler: (value: Value) => Result; }
function prepare(fn: Callback, receiver: Receiver, first: Value): { holder: Holder; label: string; arity: number } { const bound = (value: Value): Result => fn.body(receiver, first, value); return { holder: { tag: "foreign", handler: bound }, label: "bound " + fn.label, arity: Math.max(fn.arity - 1, 0) }; }
const source = new BoundWorker(), choices: { fn: Callback; expected: string }[] = [{ fn: { body: source.left, label: "left", arity: 2 }, expected: "left" }, { fn: { body: source.right, label: "right", arity: 2 }, expected: "right" }];
const identity = { token: "first" }, inputs: Value[] = [-0, NaN, undefined, null, "last"];
for (const target of choices) for (const value of inputs) {
  const receiver: Receiver = { tag: "before" }, prepared = prepare(target.fn, receiver, identity), first = prepared.holder.handler(value);
  receiver.tag = "after"; const second = prepared.holder.handler(value);
  assert.sameValue(prepared.label, "bound " + target.expected); assert.sameValue(prepared.arity, 1);
  assert.sameValue(first.self, receiver); assert.sameValue(second.self, receiver); assert.compareArray([first.tag, second.tag], ["before", "after"]);
  assert.compareArray(first.items, [identity, value]); assert.compareArray(second.items, [identity, value]);
  assert.sameValue(prepared.holder.tag, "foreign"); assert.sameValue(source.tag, "source");
}
