/*---
description: A twice-bound constructor field preserves subclasses, both operand prefixes and bound metadata while ignoring both bound receivers.
features: [ts-function-object-route-bind, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-class, ts-class-fields, ts-construct-signatures, ts-instanceof, ts-tuples, ts-interfaces]
---*/
// Base and inherited constructors cross a holder field and two bindings; new creates fresh instances with both prefixes and the original ancestry.
type Value = number | string | undefined | null | { token: string };
interface Packet { self: object; items: Value[]; }
class Base { self: object; items: Value[]; constructor(a: Value, b: Value, c: Value) { this.self = this; this.items = [a, b, c]; } }
class Child extends Base {}
type Constructor = new (a: Value, b: Value, c: Value) => Packet;
interface Holder { Ctor: Constructor; expected: string; arity: number; child: boolean; }
const choices: Holder[] = [{ Ctor: Base, expected: "Base", arity: 1, child: false }, { Ctor: Child, expected: "Child", arity: 0, child: true }];
function observe(holder: Holder, firstSelf: Packet, secondSelf: Packet, items: [Value, Value, Value]): { packet: Packet; label: string; arity: number } { const first = holder.Ctor.bind(firstSelf, items[0]), second = first.bind(secondSelf, items[1]); return { packet: new second(items[2]), label: second.name, arity: second.length }; }
const identity = { token: "untouched" }, inputs: [Value, Value, Value][] = [[-0, NaN, undefined], [null, "", identity], [1, 2, 3]];
for (const holder of choices) for (const items of inputs) {
  const first: Packet = { self: identity, items: [88] }, second: Packet = { self: identity, items: [99] }, result = observe(holder, first, second, items);
  assert.sameValue(result.label, "bound bound " + holder.expected); assert.sameValue(result.arity, holder.arity);
  assert.sameValue(result.packet.self, result.packet); assert.compareArray(result.packet.items, items);
  assert.sameValue(result.packet instanceof Base, true); assert.sameValue(result.packet instanceof Child, holder.child);
  assert.sameValue(result.packet === first, false); assert.sameValue(result.packet === second, false);
  assert.sameValue(first.self, identity); assert.sameValue(second.self, identity); assert.compareArray(first.items, [88]); assert.compareArray(second.items, [99]);
}
