/*---
description: Explicit function-record control for A bound arrow returned through a function type keeps its lexical receiver while accepting a prepended operand.
features: [ts-function-object-route-bind, ts-functions, ts-function-types, ts-arrays, ts-iteration, ts-class, ts-class-fields, ts-arrow-functions, ts-this, ts-interfaces]
---*/
// A class returns a typed arrow; bind changes its name, length and operand prefix while preserving the arrow receiver.
type Value = number | string | undefined | null | { token: string };
interface Receiver { tag: string; }
interface Seen { self: Receiver; items: Value[]; }
interface Callable { body: (first: Value, second: Value) => Seen; label: string; arity: number; }
class Owner { tag: string; constructor(tag: string) { this.tag = tag; } make(): Callable { const choose = (first: Value, second: Value): Seen => ({ self: this, items: [first, second] }); return { body: choose, label: "choose", arity: 2 }; } }
function prepare(owner: Owner, foreign: Receiver, first: Value): { run: (value: Value) => Seen; label: string; arity: number } { const fn: Callable = owner.make(), bound = (value: Value): Seen => fn.body(first, value); return { run: bound, label: "bound " + fn.label, arity: Math.max(fn.arity - 1, 0) }; }
const identity = { token: "prefix" }, owners: Owner[] = [new Owner(""), new Owner("left"), new Owner("right")], inputs: Value[] = [undefined, -0, NaN, identity];
for (const owner of owners) for (const value of inputs) {
  const foreign: Receiver = { tag: "foreign" }, bound = prepare(owner, foreign, identity), result = bound.run(value);
  assert.sameValue(bound.label, "bound choose"); assert.sameValue(bound.arity, 1);
  assert.sameValue(result.self, owner); assert.sameValue(result.self === foreign, false); assert.compareArray(result.items, [identity, value]);
  assert.sameValue(foreign.tag, "foreign");
}
