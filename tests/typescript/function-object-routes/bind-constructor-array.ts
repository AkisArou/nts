/*---
description: A bound class from a construct-signature array ignores its bound receiver and creates a fresh instance with prepended arguments.
features: [ts-function-object-route-bind, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-class, ts-class-fields, ts-construct-signatures, ts-instanceof, ts-tuples, ts-objects]
---*/
// Class values cross a constructor array before bind; new keeps the real constructor, operand order, exact bound metadata and fresh this.
type Value = number | string | undefined | null | { token: string };
interface Packet { self: object; items: Value[]; }
class First { self: object; items: Value[]; constructor(a: Value, b: Value, c: Value) { this.self = this; this.items = [a, b, c]; } }
class Second { self: object; items: Value[]; constructor(a: Value, b: Value, c: Value) { this.self = this; this.items = [a, b, c]; } }
type Constructor = new (a: Value, b: Value, c: Value) => Packet;
const choices: { Ctor: Constructor; expected: string }[] = [{ Ctor: First, expected: "First" }, { Ctor: Second, expected: "Second" }];
function prepare(Ctor: Constructor, foreign: Packet, first: Value): { create: (b: Value, c: Value) => Packet; label: string; arity: number } { const Bound = Ctor.bind(foreign, first); return { create: (b: Value, c: Value) => new Bound(b, c), label: Bound.name, arity: Bound.length }; }
function matches(packet: Packet, Ctor: Constructor): boolean { return packet instanceof Ctor; }
const identity = { token: "original" }, inputs: [Value, Value, Value][] = [[-0, NaN, undefined], [null, "", identity], [1, 2, 3]];
for (const target of choices) for (const items of inputs) {
  const foreign: Packet = { self: identity, items: [99] }, bound = prepare(target.Ctor, foreign, items[0]), first = bound.create(items[1], items[2]), second = bound.create(items[1], items[2]);
  assert.sameValue(bound.label, "bound " + target.expected); assert.sameValue(bound.arity, 2);
  assert.sameValue(first.self, first); assert.sameValue(second.self, second); assert.sameValue(first === second, false);
  assert.sameValue(matches(first, target.Ctor), true); assert.sameValue(matches(second, target.Ctor), true);
  assert.sameValue(first === foreign, false); assert.sameValue(second === foreign, false);
  assert.compareArray(first.items, items); assert.compareArray(second.items, items);
  assert.sameValue(foreign.self, identity); assert.compareArray(foreign.items, [99]);
}
