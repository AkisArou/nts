/*---
description: Uint8Array map preserves runtime species construction and contents through a declared base route. The control selects species explicitly, constructs once, validates the typed result and writes the elements in specification order.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-construct-signatures, ts-tuples, ts-numbers, ts-symbols, ts-accessors, ts-static, ts-this, ts-override, ts-errors]
---*/
// map crosses a Uint8Array base route; node chooses the receiver constructor, logs exact argument arity and new.target, and preserves its result class and values. The control uses explicit construction and element operations.
function choose(view: object, fallback: Function): Function {
  const ctor: unknown = Reflect.get(view, "constructor");
  if (ctor === undefined) return fallback;
  if ((typeof ctor !== "object" || ctor === null) && typeof ctor !== "function") throw new TypeError();
  const species: unknown = Reflect.get(ctor, Symbol.species);
  if (species === null || species === undefined) return fallback;
  if (typeof species !== "function") throw new TypeError(); return species;
}
function allocate(view: Uint8Array, length: number): Uint8Array {
  const result: unknown = Reflect.construct(choose(view, Uint8Array), [length]);
  if (!(result instanceof Uint8Array) || !ArrayBuffer.isView(result) || (result.buffer instanceof ArrayBuffer && result.buffer.detached) || result.length < length) throw new TypeError();
  return result;
}
const log: unknown[] = [];
class SpeciesBase extends Uint8Array {
  marker: number = 7;
  constructor(length: number) { super(length); log.push("base", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("species", this); return this; }
}
class SpeciesMiddle extends SpeciesBase { constructor(length: number) { super(length); log.push("middle", new.target, arguments.length, length); } }
class SpeciesLeaf extends SpeciesMiddle {}
class SpeciesSibling extends SpeciesBase { static override get [Symbol.species](): Function { log.push("sibling.species", this); return Uint8Array; } }
type Factory = { new (length: number): Uint8Array; readonly prototype: object };
function constructionLog(factory: Factory, length: number): unknown[] {
  if (factory === Uint8Array) return []; const items: unknown[] = ["base", factory, 1, length];
  if (factory === SpeciesMiddle || factory === SpeciesLeaf) items.push("middle", factory, 1, length); return items;
}
function callback(value: number, index: number, view: Uint8Array): number { log.push("map", index, value, view); return value + 1; }
function apply(view: Uint8Array): Uint8Array { const result = allocate(view, view.length); for (let i = 0; i < view.length; i++) result[i] = callback(view[i], i, view); return result; }
const factories: Factory[] = [SpeciesBase, SpeciesMiddle, SpeciesLeaf, SpeciesSibling, Uint8Array];
for (const input of [1, 254, 255]) for (const factory of factories) {
  log.length = 0; const view: Uint8Array = new factory(3), values = [0, 127, input];
  assert.compareArray(log, constructionLog(factory, 3)); for (let i = 0; i < 3; i++) view[i] = values[i];
  log.length = 0; const result = apply(view), selected = factory === SpeciesSibling ? Uint8Array : factory, wanted: unknown[] = [];
  if (factory !== Uint8Array) wanted.push(factory === SpeciesSibling ? "sibling.species" : "species", factory); wanted.push(...constructionLog(selected, 3)); for (let i = 0; i < 3; i++) wanted.push("map", i, values[i], view);
  assert.compareArray(log, wanted); assert.sameValue(result.length, 3); assert.sameValue(typeof result.length, "number");
  assert.compareArray([result instanceof SpeciesBase, result instanceof SpeciesMiddle, result instanceof SpeciesLeaf, result instanceof SpeciesSibling, result instanceof Uint8Array, result instanceof Object], [selected !== Uint8Array, selected === SpeciesMiddle || selected === SpeciesLeaf, selected === SpeciesLeaf, selected === SpeciesSibling, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, selected.prototype); assert.sameValue(ArrayBuffer.isView(result), true);
  const expected = [1, 128, input === 255 ? 0 : input + 1], keys: string[] = []; for (let i = 0; i < expected.length; i++) { assert.sameValue(result[i], expected[i]); assert.sameValue(typeof result[i], "number"); assert.sameValue(Object.hasOwn(result, i), true); keys.push(String(i)); }
  if (result instanceof SpeciesBase) { assert.sameValue(result.marker, 7); keys.push("marker"); }
  assert.compareArray(Reflect.ownKeys(result), keys); assert.sameValue(Object.hasOwn(result, "length"), false); assert.sameValue(result.buffer === view.buffer, false);
  for (let i = 0; i < 3; i++) assert.sameValue(view[i], values[i]);
}
