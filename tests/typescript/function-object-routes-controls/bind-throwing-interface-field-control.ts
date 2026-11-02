/*---
description: Explicit function-record control for Bound functions carried in an interface field preserve direct and deeper TypeError paths, receiver identity and prepended flags.
features: [ts-function-object-route-bind, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-interfaces, ts-this-parameter, ts-this, ts-errors, ts-unknown]
---*/
// A holder field carries bound functions with a fixed failure flag; success and both throw depths keep metadata and exact receiver/operand histories.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
let events: unknown[] = [];
interface Callback { body: (self: Receiver, fail: boolean, value: Value) => Seen; label: string; arity: number; }
function finish(self: Receiver, fail: boolean, value: Value): Seen { events.push("deep", self, fail, value); if (fail) throw new TypeError("deep"); return { self, items: [value] }; }
function direct(self: Receiver, fail: boolean, value: Value): Seen { events.push("entry", self, fail, value); if (fail) throw new TypeError("direct"); return { self, items: [value] }; }
function deeper(self: Receiver, fail: boolean, value: Value): Seen { events.push("entry", self, fail, value); return finish(self, fail, value); }
interface Holder { fn: (value: Value) => Seen; label: string; arity: number; }
function prepare(fn: Callback, self: Receiver, fail: boolean): Holder { const bound = (value: Value): Seen => fn.body(self, fail, value); return { fn: bound, label: "bound " + fn.label, arity: Math.max(fn.arity - 1, 0) }; }
const choices: { fn: Callback; expected: string; deep: boolean }[] = [{ fn: { body: direct, label: "direct", arity: 2 }, expected: "direct", deep: false }, { fn: { body: deeper, label: "deeper", arity: 2 }, expected: "deeper", deep: true }];
const identity = { token: "argument" }, inputs: Value[] = [-0, NaN, undefined, identity];
for (const target of choices) for (const fail of [false, true]) for (const value of inputs) {
  events = []; const receiver: Receiver = { tag: "throw" }, holder: Holder = prepare(target.fn, receiver, fail);
  assert.sameValue(holder.label, "bound " + target.expected); assert.sameValue(holder.arity, 1);
  if (fail) assert.throws(TypeError, () => holder.fn(value));
  else { const result = holder.fn(value); assert.sameValue(result.self, receiver); assert.compareArray(result.items, [value]); }
  assert.compareArray(events, target.deep ? ["entry", receiver, fail, value, "deep", receiver, fail, value] : ["entry", receiver, fail, value]);
  assert.sameValue(receiver.tag, "throw");
}
