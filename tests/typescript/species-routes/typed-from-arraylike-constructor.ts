/*---
description: Typed-array from constructs its constructor receiver after array-like length but before indexed getters, without consulting species.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-override, ts-construct-signatures, ts-interfaces, ts-interface-extends, ts-errors, ts-numbers]
---*/
// from crosses a constructor interface and typed array-like source; node checks the iterator, reads length, constructs this, then interleaves indexed gets with mapping and converted stores.
const log: unknown[] = [], made: Uint8Array[] = [], failure = new RangeError("species must not be read");
class SpeciesBase extends Uint8Array {
  marker: number = 7;
  constructor(length: number) { super(length); made.push(this); log.push("base", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("wrong-species", this); throw failure; }
}
class SpeciesMiddle extends SpeciesBase { constructor(length: number) { super(length); log.push("middle", new.target, arguments.length, length); } }
class SpeciesLeaf extends SpeciesMiddle {}
class SpeciesSibling extends SpeciesBase { static override get [Symbol.species](): Function { log.push("wrong-sibling", this); return Array; } }
interface Source extends ArrayLike<number> { readonly [Symbol.iterator]: undefined; }
interface Factory { new (length: number): Uint8Array; readonly prototype: object; from(source: ArrayLike<number>, mapper: (value: number, index: number) => number): Uint8Array; }
function mapper(value: number, index: number): number { log.push("map", index, value, made.length === 0 || index === 0 ? undefined : made[0][index - 1]); return value + index; }
function apply(factory: Factory, source: Source): Uint8Array { return factory.from(source, mapper); }
const factories: Factory[] = [SpeciesBase, SpeciesMiddle, SpeciesLeaf, SpeciesSibling, Uint8Array], rows = [[0, 0], [255, 255], [256.5, 0]];
for (const [input, converted] of rows) for (const factory of factories) {
  const source: Source = { get [Symbol.iterator](): undefined { log.push("iterator"); return undefined; }, get length(): number { log.push("length"); return 3; }, get 0(): number { log.push("get", 0); return input; }, get 1(): number { log.push("get", 1); return -1; }, get 2(): number { log.push("get", 2); return 511; } };
  log.length = 0; made.length = 0; const result = apply(factory, source), expected = [converted, 0, 1], wanted: unknown[] = ["iterator", "length"];
  if (factory !== Uint8Array) wanted.push("base", factory, 1, 3); if (factory === SpeciesMiddle || factory === SpeciesLeaf) wanted.push("middle", factory, 1, 3);
  wanted.push("get", 0, "map", 0, input, undefined, "get", 1, "map", 1, -1, factory === Uint8Array ? undefined : converted, "get", 2, "map", 2, 511, factory === Uint8Array ? undefined : 0);
  assert.compareArray(log, wanted); assert.sameValue(result.length, expected.length); assert.sameValue(ArrayBuffer.isView(result), true);
  assert.compareArray([result instanceof SpeciesBase, result instanceof SpeciesMiddle, result instanceof SpeciesLeaf, result instanceof SpeciesSibling, result instanceof Uint8Array, result instanceof Object], [factory !== Uint8Array, factory === SpeciesMiddle || factory === SpeciesLeaf, factory === SpeciesLeaf, factory === SpeciesSibling, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, factory.prototype); assert.sameValue(made.length, factory === Uint8Array ? 0 : 1);
  const keys: string[] = []; for (let i = 0; i < expected.length; i++) { assert.sameValue(result[i], expected[i]); assert.sameValue(typeof result[i], "number"); assert.sameValue(Object.hasOwn(result, i), true); keys.push(String(i)); }
  if (result instanceof SpeciesBase) { assert.sameValue(result.marker, 7); assert.sameValue(result, made[0]); keys.push("marker"); } assert.compareArray(Reflect.ownKeys(result), keys);
  assert.sameValue(Object.hasOwn(result, "length"), false); assert.sameValue(Object.hasOwn(result, expected.length), false); assert.sameValue(result.byteOffset, 0); assert.sameValue(result.byteLength, expected.length * Uint8Array.BYTES_PER_ELEMENT);
}
