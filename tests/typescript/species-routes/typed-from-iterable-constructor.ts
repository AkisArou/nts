/*---
description: Typed-array from drains an iterable before constructing its typed constructor receiver with one length argument, without reading species.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-override, ts-construct-signatures, ts-interfaces, ts-errors, ts-numbers]
---*/
// from crosses a constructor interface; node consumes the iterable, constructs this with length three, then maps and stores values with exact new.target and prior-write observations.
const log: unknown[] = [], made: Float64Array[] = [], failure = new RangeError("species must not be read");
class SpeciesBase extends Float64Array {
  marker: number = 7;
  constructor(length: number) { super(length); made.push(this); log.push("base", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("wrong-species", this); throw failure; }
}
class SpeciesMiddle extends SpeciesBase { constructor(length: number) { super(length); log.push("middle", new.target, arguments.length, length); } }
class SpeciesLeaf extends SpeciesMiddle {}
class SpeciesSibling extends SpeciesBase { static override get [Symbol.species](): Function { log.push("wrong-sibling", this); return Array; } }
interface Factory { new (length: number): Float64Array; readonly prototype: object; from(source: Iterable<number>, mapper: (value: number, index: number) => number): Float64Array; }
function mapper(value: number, index: number): number { log.push("map", index, value, made.length === 0 || index === 0 ? undefined : made[0][index - 1]); return value; }
function apply(factory: Factory, source: Iterable<number>): Float64Array { return factory.from(source, mapper); }
const factories: Factory[] = [SpeciesBase, SpeciesMiddle, SpeciesLeaf, SpeciesSibling, Float64Array], rows = [[1, 2.5, 255], [NaN, -0, Infinity]];
for (const values of rows) for (const factory of factories) {
  const source: Iterable<number> = { [Symbol.iterator](): Iterator<number, undefined, undefined> { log.push("iterate", this); let index = 0; return { next(): IteratorResult<number, undefined> { log.push("next", index); return index < values.length ? { done: false, value: values[index++] } : { done: true, value: undefined }; } }; } };
  log.length = 0; made.length = 0; const result = apply(factory, source), expected = values;
  const wanted: unknown[] = ["iterate", source, "next", 0, "next", 1, "next", 2, "next", 3];
  if (factory !== Float64Array) wanted.push("base", factory, 1, 3); if (factory === SpeciesMiddle || factory === SpeciesLeaf) wanted.push("middle", factory, 1, 3);
  for (let i = 0; i < 3; i++) wanted.push("map", i, values[i], factory === Float64Array || i === 0 ? undefined : values[i - 1]);
  assert.compareArray(log, wanted); assert.sameValue(result.length, expected.length); assert.sameValue(ArrayBuffer.isView(result), true);
  assert.compareArray([result instanceof SpeciesBase, result instanceof SpeciesMiddle, result instanceof SpeciesLeaf, result instanceof SpeciesSibling, result instanceof Float64Array, result instanceof Object], [factory !== Float64Array, factory === SpeciesMiddle || factory === SpeciesLeaf, factory === SpeciesLeaf, factory === SpeciesSibling, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, factory.prototype); assert.sameValue(made.length, factory === Float64Array ? 0 : 1);
  const keys: string[] = []; for (let i = 0; i < expected.length; i++) { assert.sameValue(result[i], expected[i]); assert.sameValue(typeof result[i], "number"); assert.sameValue(Object.hasOwn(result, i), true); keys.push(String(i)); }
  if (result instanceof SpeciesBase) { assert.sameValue(result.marker, 7); assert.sameValue(result, made[0]); keys.push("marker"); } assert.compareArray(Reflect.ownKeys(result), keys);
  assert.sameValue(Object.hasOwn(result, "length"), false); assert.sameValue(Object.hasOwn(result, expected.length), false); assert.sameValue(result.byteOffset, 0); assert.sameValue(result.byteLength, expected.length * Float64Array.BYTES_PER_ELEMENT);
}
