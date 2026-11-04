/*---
description: Float64Array filter preserves runtime species construction and contents through a declared generic route. The control selects species explicitly, constructs once, validates the typed result and writes the elements in specification order.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-construct-signatures, ts-tuples, ts-numbers, ts-symbols, ts-accessors, ts-static, ts-this, ts-override, ts-generics, ts-generic-constraints, ts-errors]
---*/
// filter crosses a Float64Array generic route; node chooses the receiver constructor, logs exact argument arity and new.target, and preserves its result class and values. The control uses explicit construction and element operations.
function choose(view: object, fallback: Function): Function {
  const ctor: unknown = Reflect.get(view, "constructor");
  if (ctor === undefined) return fallback;
  if ((typeof ctor !== "object" || ctor === null) && typeof ctor !== "function") throw new TypeError();
  const species: unknown = Reflect.get(ctor, Symbol.species);
  if (species === null || species === undefined) return fallback;
  if (typeof species !== "function") throw new TypeError(); return species;
}
function allocate(view: Float64Array, length: number): Float64Array {
  const result: unknown = Reflect.construct(choose(view, Float64Array), [length]);
  if (!(result instanceof Float64Array) || !ArrayBuffer.isView(result) || (result.buffer instanceof ArrayBuffer && result.buffer.detached) || result.length < length) throw new TypeError();
  return result;
}
const log: unknown[] = [];
class SpeciesBase extends Float64Array {
  marker: number = 7;
  constructor(length: number) { super(length); log.push("base", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("species", this); return this; }
}
class SpeciesMiddle extends SpeciesBase { constructor(length: number) { super(length); log.push("middle", new.target, arguments.length, length); } }
class SpeciesLeaf extends SpeciesMiddle {}
class SpeciesSibling extends SpeciesBase { static override get [Symbol.species](): Function { log.push("sibling.species", this); return Float64Array; } }
type Factory = { new (length: number): Float64Array; readonly prototype: object };
function constructionLog(factory: Factory, length: number): unknown[] {
  if (factory === Float64Array) return []; const items: unknown[] = ["base", factory, 1, length];
  if (factory === SpeciesMiddle || factory === SpeciesLeaf) items.push("middle", factory, 1, length); return items;
}
function callback(value: number, index: number, view: Float64Array): boolean { log.push("filter", index, value, view); return index !== 1; }
function apply<T extends Float64Array>(view: T): Float64Array { const kept: number[] = []; for (let i = 0; i < view.length; i++) { const value = view[i]; if (callback(value, i, view)) kept.push(value); } const result = allocate(view, kept.length); for (let i = 0; i < kept.length; i++) result[i] = kept[i]; return result; }
const factories: Factory[] = [SpeciesBase, SpeciesMiddle, SpeciesLeaf, SpeciesSibling, Float64Array];
for (const input of [-0, 3.5, Infinity]) for (const factory of factories) {
  log.length = 0; const view: Float64Array = new factory(3), values = [NaN, -0, input];
  assert.compareArray(log, constructionLog(factory, 3)); for (let i = 0; i < 3; i++) view[i] = values[i];
  log.length = 0; const result = apply(view), selected = factory === SpeciesSibling ? Float64Array : factory, wanted: unknown[] = [];
  for (let i = 0; i < 3; i++) wanted.push("filter", i, values[i], view); if (factory !== Float64Array) wanted.push(factory === SpeciesSibling ? "sibling.species" : "species", factory); wanted.push(...constructionLog(selected, 2));
  assert.compareArray(log, wanted); assert.sameValue(result.length, 2); assert.sameValue(typeof result.length, "number");
  assert.compareArray([result instanceof SpeciesBase, result instanceof SpeciesMiddle, result instanceof SpeciesLeaf, result instanceof SpeciesSibling, result instanceof Float64Array, result instanceof Object], [selected !== Float64Array, selected === SpeciesMiddle || selected === SpeciesLeaf, selected === SpeciesLeaf, selected === SpeciesSibling, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, selected.prototype); assert.sameValue(ArrayBuffer.isView(result), true);
  const expected = [NaN, input], keys: string[] = []; for (let i = 0; i < expected.length; i++) { assert.sameValue(result[i], expected[i]); assert.sameValue(typeof result[i], "number"); assert.sameValue(Object.hasOwn(result, i), true); keys.push(String(i)); }
  if (result instanceof SpeciesBase) { assert.sameValue(result.marker, 7); keys.push("marker"); }
  assert.compareArray(Reflect.ownKeys(result), keys); assert.sameValue(Object.hasOwn(result, "length"), false); assert.sameValue(result.buffer === view.buffer, false);
  for (let i = 0; i < 3; i++) assert.sameValue(view[i], values[i]);
}
