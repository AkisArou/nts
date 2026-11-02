/*---
description: Explicit metadata record control for A typed constructor field distinguishes declared and implicit derived constructor arities.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-interfaces, ts-class, ts-class-fields]
---*/
// Explicit records: A constructor field carries classes with zero, fixed, default and rest parameters plus an implicit derived constructor; node keeps each class name and gives the derived constructor arity zero.
interface Metadata { label: string; arity: number; }
class ConstructorSlot { value: Metadata; constructor(value: Metadata) { this.value = value; } }
function observe(slot: ConstructorSlot): [string, number] { const target = slot.value; return [target.label, target.arity]; }
const targets: ConstructorSlot[] = [new ConstructorSlot({ label: "MetaEmpty", arity: 0 }), new ConstructorSlot({ label: "MetaOne", arity: 1 }), new ConstructorSlot({ label: "MetaThree", arity: 3 }), new ConstructorSlot({ label: "MetaStopped", arity: 1 }), new ConstructorSlot({ label: "MetaRest", arity: 0 }), new ConstructorSlot({ label: "MetaDerived", arity: 0 })];
const expected: [string, number][] = [["MetaEmpty", 0], ["MetaOne", 1], ["MetaThree", 3], ["MetaStopped", 1], ["MetaRest", 0], ["MetaDerived", 0]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 6);
