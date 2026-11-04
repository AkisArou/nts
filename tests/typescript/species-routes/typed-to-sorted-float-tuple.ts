/*---
description: Float64Array toSorted ignores constructor and species hooks and returns a plain same-element typed array through a tuple route.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-override, ts-construct-signatures, ts-tuples, ts-errors, ts-numbers]
---*/
// toSorted crosses a declared Float64Array tuple route; node never reads poisoned constructor/species hooks and returns a plain builtin with exact independent contents.
const log: unknown[] = [], failure = new RangeError("species must not be read");
class SpeciesBase extends Float64Array {
  marker: number = 7;
  constructor(length: number) { super(length); log.push("base", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("wrong-species", this); throw failure; }
}
class SpeciesMiddle extends SpeciesBase { constructor(length: number) { super(length); log.push("middle", new.target, arguments.length, length); } }
class SpeciesLeaf extends SpeciesMiddle {}
class SpeciesSibling extends SpeciesBase { static override get [Symbol.species](): Function { log.push("wrong-sibling", this); return Array; } }
type Factory = { new (length: number): Float64Array; readonly prototype: object };
function apply(pair: [Float64Array, string]): Float64Array { return pair[0].toSorted(); }
const factories: Factory[] = [SpeciesBase, SpeciesMiddle, SpeciesLeaf, SpeciesSibling, Float64Array], rows: [number[], number[]][] = [[[NaN, 3, -0, 0, -2.5], [-2.5, -0, 0, 3, NaN]], [[Infinity, -Infinity, 1, NaN, -0], [-Infinity, -0, 1, Infinity, NaN]]];
for (const [values, wanted] of rows) for (const factory of factories) {
  log.length = 0; const view: Float64Array = new factory(values.length), constructed: unknown[] = factory === Float64Array ? [] : ["base", factory, 1, values.length];
  if (factory === SpeciesMiddle || factory === SpeciesLeaf) constructed.push("middle", factory, 1, values.length); assert.compareArray(log, constructed);
  for (let i = 0; i < values.length; i++) view[i] = values[i];
  Object.defineProperty(view, "constructor", { get() { log.push("wrong-constructor", view); throw failure; } }); log.length = 0;
  const result = apply([view, "sorted"]), expected = wanted; assert.compareArray(log, []);
  assert.compareArray([result instanceof SpeciesBase, result instanceof SpeciesMiddle, result instanceof SpeciesLeaf, result instanceof SpeciesSibling, result instanceof Float64Array, result instanceof Object], [false, false, false, false, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, Float64Array.prototype); assert.sameValue(ArrayBuffer.isView(result), true);
  assert.sameValue(result.length, values.length); assert.sameValue(result.buffer === view.buffer, false); assert.sameValue(result.byteOffset, 0); assert.sameValue(result.byteLength, values.length * Float64Array.BYTES_PER_ELEMENT);
  const keys: string[] = []; for (let i = 0; i < values.length; i++) { assert.sameValue(result[i], expected[i]); assert.sameValue(typeof result[i], "number"); assert.sameValue(Object.hasOwn(result, i), true); assert.sameValue(view[i], values[i]); keys.push(String(i)); }
  assert.compareArray(Reflect.ownKeys(result), keys); assert.sameValue(Object.hasOwn(result, "marker"), false); assert.sameValue(Object.hasOwn(result, "constructor"), false); assert.sameValue(Object.hasOwn(result, "length"), false);
  if (view instanceof SpeciesBase) { assert.sameValue(view.marker, 7); keys.push("marker"); } keys.push("constructor"); assert.compareArray(Reflect.ownKeys(view), keys);
}
