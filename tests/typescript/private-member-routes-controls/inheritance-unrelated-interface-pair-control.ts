/*---
description: A Map-backed control: Two unrelated classes with the same private spelling reject each other through both sides of a typed method interface.
features: [ts-private-member-routes, ts-private-member-route-inheritance, ts-class, ts-class-fields, ts-arrays, ts-iteration, ts-objects, ts-errors, ts-interfaces, ts-tuples, ts-unknown, ts-static, ts-unsound-bivariance, ts-map-set]
---*/
// CrossLeft and CrossRight travel through a tuple of wider method interfaces; node keeps their equal-spelled slots separate and throws for cross reads and writes. The control uses guarded Maps with the same observations.
interface Access { owns(value: object): boolean; read(value: object): unknown; write(value: object, next: unknown): unknown; }
const leftValues = new Map<object, unknown>(), rightValues = new Map<object, unknown>();
class CrossLeft {
  label: string = "same";
  constructor(value: unknown) { leftValues.set(this, value); }
  static owns(value: object): boolean { return leftValues.has(value); }
  static read(value: CrossLeft): unknown { if (!leftValues.has(value)) throw new TypeError(); return leftValues.get(value); }
  static write(value: CrossLeft, next: unknown): unknown { if (!leftValues.has(value)) throw new TypeError(); leftValues.set(value, next); return next; }
}
class CrossRight {
  label: string = "same";
  constructor(value: unknown) { rightValues.set(this, value); }
  static owns(value: object): boolean { return rightValues.has(value); }
  static read(value: CrossRight): unknown { if (!rightValues.has(value)) throw new TypeError(); return rightValues.get(value); }
  static write(value: CrossRight, next: unknown): unknown { if (!rightValues.has(value)) throw new TypeError(); rightValues.set(value, next); return next; }
}
const readers: [Access, Access] = [CrossLeft, CrossRight], values: unknown[] = [-0, NaN, undefined, { value: 1 }];
for (const value of values) {
  const sources: [object, object, object] = [new CrossLeft(value), new CrossRight(value), { label: "same" }], next = { value };
  for (let owner = 0; owner < readers.length; owner++) for (let index = 0; index < sources.length; index++) {
    const reader: Access = readers[owner], source: object = sources[index];
    assert.sameValue(reader.owns(source), owner === index);
    if (owner === index) {
      assert.sameValue(reader.read(source), value); assert.sameValue(reader.write(source, next), next);
      assert.sameValue(reader.read(source), next); assert.sameValue(reader.write(source, value), value);
      assert.sameValue(reader.read(source), value);
    } else { assert.throws(TypeError, () => reader.read(source)); assert.throws(TypeError, () => reader.write(source, next)); }
  }
  assert.sameValue(readers[0].read(sources[0]), value); assert.sameValue(readers[1].read(sources[1]), value);
}
