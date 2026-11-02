/*---
description: A typed constructor field distinguishes declared and implicit derived constructor arities.
features: [ts-function-object-route-length-name, ts-functions, ts-arrays, ts-iteration, ts-tuples, ts-strings, ts-numbers, ts-objects, ts-construct-signatures, ts-class, ts-class-fields, ts-inheritance, ts-default-parameters, ts-rest-parameters]
---*/
// A constructor field carries classes with zero, fixed, default and rest parameters plus an implicit derived constructor; node keeps each class name and gives the derived constructor arity zero.
type Builder = new (a: number, b: number, c: number) => object;
class ConstructorSlot { value: Builder; constructor(value: Builder) { this.value = value; } }
class MetaEmpty {}
class MetaOne { constructor(a: number) {} }
class MetaThree { constructor(a: number, b: number, c: number) {} }
class MetaStopped { constructor(a: number, b = 2, c?: number) {} }
class MetaRest { constructor(...values: number[]) {} }
class MetaDerived extends MetaThree {}
function observe(slot: ConstructorSlot): [string, number] { const target = slot.value; return [target.name, target.length]; }
const targets: ConstructorSlot[] = [new ConstructorSlot(MetaEmpty), new ConstructorSlot(MetaOne), new ConstructorSlot(MetaThree), new ConstructorSlot(MetaStopped), new ConstructorSlot(MetaRest), new ConstructorSlot(MetaDerived)];
const expected: [string, number][] = [["MetaEmpty", 0], ["MetaOne", 1], ["MetaThree", 3], ["MetaStopped", 1], ["MetaRest", 0], ["MetaDerived", 0]];
let index = 0;
for (const target of targets) {
  const actual = observe(target), wanted = expected[index];
  assert.sameValue(actual[0], wanted[0]); assert.sameValue(actual[1], wanted[1]);
  assert.compareArray(actual, wanted); index++;
}
assert.sameValue(index, 6);
