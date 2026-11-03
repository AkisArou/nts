/*---
description: A bound constructor in a typed holder field tests its target’s chain and has no own prototype.
features: [ts-instanceof-routes, ts-instanceof-route-custom, ts-functions, ts-arrays, ts-iteration, ts-unknown, ts-symbols, ts-objects, ts-tuples, ts-class, ts-class-fields, ts-inheritance, ts-construct-signatures, ts-interfaces, ts-instanceof]
---*/
// BoundBase, BoundChild and BoundSibling are bound into a holder field; node answers from the selected target chain for instances, handmade chains and primitives.
class BoundBase { value: number = 1; }
class BoundChild extends BoundBase {}
class BoundSibling { value: number = 1; }
type Constructor = { new (): object; readonly prototype: object; };
interface BoundEntry { target: Constructor; bound: new () => object; }
interface Holder { entry: BoundEntry; }
function accepts(holder: Holder, value: unknown): boolean { return value instanceof holder.entry.bound; }
const made: unknown = Object.create(BoundBase.prototype), blank: unknown = Object.create(null);
const values: unknown[] = [new BoundBase(), new BoundChild(), new BoundSibling(), { value: 1 }, made, blank, () => 0, 1];
const choices: [Constructor, boolean[]][] = [[BoundBase, [true, true, false, false, true, false, false, false]], [BoundChild, [false, true, false, false, false, false, false, false]], [BoundSibling, [false, false, true, false, false, false, false, false]]];
for (const [target, answers] of choices) {
  const entry: BoundEntry = { target, bound: target.bind(null) }, holder: Holder = { entry };
  assert.sameValue(Object.hasOwn(entry.bound, "prototype"), false);
  for (let i = 0; i < values.length; i++) {
    const matched = accepts(holder, values[i]); assert.sameValue(matched, answers[i]);
  }
}
