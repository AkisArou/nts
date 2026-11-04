/*---
description: Int16Array slice preserves runtime species construction and contents through a declared tuple route. The control selects species explicitly, constructs once, validates the typed result and writes the elements in specification order.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-construct-signatures, ts-tuples, ts-numbers, ts-symbols, ts-errors]
---*/
// slice crosses a Int16Array tuple route; node chooses the receiver constructor, logs exact argument arity and new.target, and preserves its result class and values. The control uses explicit construction and element operations.
function choose(view: object, fallback: Function): Function {
  const ctor: unknown = Reflect.get(view, "constructor");
  if (ctor === undefined) return fallback;
  if ((typeof ctor !== "object" || ctor === null) && typeof ctor !== "function") throw new TypeError();
  const species: unknown = Reflect.get(ctor, Symbol.species);
  if (species === null || species === undefined) return fallback;
  if (typeof species !== "function") throw new TypeError(); return species;
}
function allocate(view: Int16Array, length: number): Int16Array {
  const result: unknown = Reflect.construct(choose(view, Int16Array), [length]);
  if (!(result instanceof Int16Array) || !ArrayBuffer.isView(result) || (result.buffer instanceof ArrayBuffer && result.buffer.detached) || result.length < length) throw new TypeError();
  return result;
}
const log: unknown[] = [];
class SpeciesBase extends Int16Array {
  marker: number = 7;
  constructor(length: number) { super(length); log.push("base", new.target, arguments.length, length); }
}
class SpeciesMiddle extends SpeciesBase { constructor(length: number) { super(length); log.push("middle", new.target, arguments.length, length); } }
class SpeciesLeaf extends SpeciesMiddle {}
class SpeciesSibling extends SpeciesBase {}
type Factory = { new (length: number): Int16Array; readonly prototype: object };
function constructionLog(factory: Factory, length: number): unknown[] {
  if (factory === Int16Array) return []; const items: unknown[] = ["base", factory, 1, length];
  if (factory === SpeciesMiddle || factory === SpeciesLeaf) items.push("middle", factory, 1, length); return items;
}
function apply(pair: [Int16Array, string]): Int16Array { const view = pair[0]; const result = allocate(view, 2); const source = new Uint8Array(view.buffer, view.byteOffset, 2 * view.BYTES_PER_ELEMENT), target = new Uint8Array(result.buffer, result.byteOffset, source.length); for (let i = 0; i < source.length; i++) target[i] = source[i]; return result; }
const factories: Factory[] = [SpeciesBase, SpeciesMiddle, SpeciesLeaf, SpeciesSibling, Int16Array];
for (const input of [-32768, 32767, 0]) for (const factory of factories) {
  log.length = 0; const view: Int16Array = new factory(3), values = [input, 7, -1];
  assert.compareArray(log, constructionLog(factory, 3)); for (let i = 0; i < 3; i++) view[i] = values[i];
  log.length = 0; const result = apply([view, "slice"]), selected = factory, wanted: unknown[] = [];
   wanted.push(...constructionLog(selected, 2));
  assert.compareArray(log, wanted); assert.sameValue(result.length, 2); assert.sameValue(typeof result.length, "number");
  assert.compareArray([result instanceof SpeciesBase, result instanceof SpeciesMiddle, result instanceof SpeciesLeaf, result instanceof SpeciesSibling, result instanceof Int16Array, result instanceof Object], [selected !== Int16Array, selected === SpeciesMiddle || selected === SpeciesLeaf, selected === SpeciesLeaf, selected === SpeciesSibling, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, selected.prototype); assert.sameValue(ArrayBuffer.isView(result), true);
  const expected = [input, 7], keys: string[] = []; for (let i = 0; i < expected.length; i++) { assert.sameValue(result[i], expected[i]); assert.sameValue(typeof result[i], "number"); assert.sameValue(Object.hasOwn(result, i), true); keys.push(String(i)); }
  if (result instanceof SpeciesBase) { assert.sameValue(result.marker, 7); keys.push("marker"); }
  assert.compareArray(Reflect.ownKeys(result), keys); assert.sameValue(Object.hasOwn(result, "length"), false); assert.sameValue(result.buffer === view.buffer, false);
  for (let i = 0; i < 3; i++) assert.sameValue(view[i], values[i]);
}
