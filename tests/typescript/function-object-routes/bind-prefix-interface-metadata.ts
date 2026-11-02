/*---
description: Binding zero through three operands through a typed callback interface reduces length and prepends every argument in order.
features: [ts-function-object-route-bind, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-interfaces, ts-this-parameter, ts-this, ts-tuples]
---*/
// A callback interface carries declaration and named-expression targets; bound records expose exact names, remaining lengths and complete operands.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
interface Callable { (this: Receiver, a: Value, b: Value, c: Value): Seen; }
interface Candidate { fn: Callable; expected: string; }
interface Bound { run: () => Seen; label: string; arity: number; }
function collect(this: Receiver, a: Value, b: Value, c: Value): Seen { return { self: this, items: [a, b, c] }; }
const expression = function preserve(this: Receiver, a: Value, b: Value, c: Value): Seen { return { self: this, items: [a, b, c] }; };
const choices: Candidate[] = [{ fn: collect, expected: "collect" }, { fn: expression, expected: "preserve" }];
function prepare(target: Candidate, self: Receiver, items: [Value, Value, Value], count: number): Bound {
  const [a, b, c] = items;
  if (count === 0) { const bound = target.fn.bind(self); return { run: () => bound(a, b, c), label: bound.name, arity: bound.length }; }
  if (count === 1) { const bound = target.fn.bind(self, a); return { run: () => bound(b, c), label: bound.name, arity: bound.length }; }
  if (count === 2) { const bound = target.fn.bind(self, a, b); return { run: () => bound(c), label: bound.name, arity: bound.length }; }
  const bound = target.fn.bind(self, a, b, c); return { run: () => bound(), label: bound.name, arity: bound.length };
}
const identity = { token: "last" }, inputs: [Value, Value, Value][] = [[-0, NaN, undefined], [null, "", identity], [1, 2, 3]];
for (const target of choices) for (const count of [0, 1, 2, 3]) for (const items of inputs) {
  const receiver: Receiver = { tag: "bound" }, bound = prepare(target, receiver, items, count), result = bound.run();
  assert.sameValue(bound.label, "bound " + target.expected); assert.sameValue(bound.arity, 3 - count);
  assert.sameValue(result.self, receiver); assert.compareArray(result.items, items);
  assert.sameValue(result.items === items, false);
}
