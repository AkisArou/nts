/*---
description: Explicit function-record control for Binding zero through three operands through a typed callback interface reduces length and prepends every argument in order.
features: [ts-function-object-route-bind, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-interfaces, ts-this-parameter, ts-this, ts-tuples]
---*/
// A callback interface carries declaration and named-expression targets; bound records expose exact names, remaining lengths and complete operands.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
interface Callable { body: (self: Receiver, a: Value, b: Value, c: Value) => Seen; label: string; arity: number; }
interface Candidate { fn: Callable; expected: string; }
interface Bound { run: () => Seen; label: string; arity: number; }
function collect(self: Receiver, a: Value, b: Value, c: Value): Seen { return { self, items: [a, b, c] }; }
const expression = function preserve(self: Receiver, a: Value, b: Value, c: Value): Seen { return { self, items: [a, b, c] }; };
const choices: Candidate[] = [{ fn: { body: collect, label: "collect", arity: 3 }, expected: "collect" }, { fn: { body: expression, label: "preserve", arity: 3 }, expected: "preserve" }];
function prepare(target: Candidate, self: Receiver, items: [Value, Value, Value], count: number): Bound {
  const prefix: Value[] = [], tail: Value[] = []; let position = 0;
  for (const value of items) (position++ < count ? prefix : tail).push(value);
  return { run: () => { const packed = prefix.concat(tail); return target.fn.body(self, packed[0], packed[1], packed[2]); }, label: "bound " + target.fn.label, arity: Math.max(target.fn.arity - count, 0) };
}
const identity = { token: "last" }, inputs: [Value, Value, Value][] = [[-0, NaN, undefined], [null, "", identity], [1, 2, 3]];
for (const target of choices) for (const count of [0, 1, 2, 3]) for (const items of inputs) {
  const receiver: Receiver = { tag: "bound" }, bound = prepare(target, receiver, items, count), result = bound.run();
  assert.sameValue(bound.label, "bound " + target.expected); assert.sameValue(bound.arity, 3 - count);
  assert.sameValue(result.self, receiver); assert.compareArray(result.items, items);
  assert.sameValue(result.items === items, false);
}
