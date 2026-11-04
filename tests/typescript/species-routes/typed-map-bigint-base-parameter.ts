/*---
description: BigInt64Array map preserves runtime species construction and contents through a declared base route.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-construct-signatures, ts-tuples, ts-bigint, ts-symbols, ts-accessors, ts-static, ts-this, ts-override]
---*/
// map crosses a BigInt64Array base route; node chooses the receiver constructor, logs exact argument arity and new.target, and preserves its result class and values.
const log: unknown[] = [];
class SpeciesBase extends BigInt64Array {
  marker: number = 7;
  constructor(length: number) { super(length); log.push("base", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("species", this); return this; }
}
class SpeciesMiddle extends SpeciesBase { constructor(length: number) { super(length); log.push("middle", new.target, arguments.length, length); } }
class SpeciesLeaf extends SpeciesMiddle {}
class SpeciesSibling extends SpeciesBase { static override get [Symbol.species](): Function { log.push("sibling.species", this); return BigInt64Array; } }
type Factory = { new (length: number): BigInt64Array; readonly prototype: object };
function constructionLog(factory: Factory, length: number): unknown[] {
  if (factory === BigInt64Array) return []; const items: unknown[] = ["base", factory, 1, length];
  if (factory === SpeciesMiddle || factory === SpeciesLeaf) items.push("middle", factory, 1, length); return items;
}
function callback(value: bigint, index: number, view: BigInt64Array): bigint { log.push("map", index, value, view); return value + 1n; }
function apply(view: BigInt64Array): BigInt64Array { return view.map(callback); }
const factories: Factory[] = [SpeciesBase, SpeciesMiddle, SpeciesLeaf, SpeciesSibling, BigInt64Array];
for (const [input, last] of [[2n, 3n], [9223372036854775807n, -9223372036854775808n], [-1n, 0n]]) for (const factory of factories) {
  log.length = 0; const view: BigInt64Array = new factory(3), values = [0n, -1n, input];
  assert.compareArray(log, constructionLog(factory, 3)); for (let i = 0; i < 3; i++) view[i] = values[i];
  log.length = 0; const result = apply(view), selected = factory === SpeciesSibling ? BigInt64Array : factory, wanted: unknown[] = [];
  if (factory !== BigInt64Array) wanted.push(factory === SpeciesSibling ? "sibling.species" : "species", factory); wanted.push(...constructionLog(selected, 3)); for (let i = 0; i < 3; i++) wanted.push("map", i, values[i], view);
  assert.compareArray(log, wanted); assert.sameValue(result.length, 3); assert.sameValue(typeof result.length, "number");
  assert.compareArray([result instanceof SpeciesBase, result instanceof SpeciesMiddle, result instanceof SpeciesLeaf, result instanceof SpeciesSibling, result instanceof BigInt64Array, result instanceof Object], [selected !== BigInt64Array, selected === SpeciesMiddle || selected === SpeciesLeaf, selected === SpeciesLeaf, selected === SpeciesSibling, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, selected.prototype); assert.sameValue(ArrayBuffer.isView(result), true);
  const expected = [1n, 0n, last], keys: string[] = []; for (let i = 0; i < expected.length; i++) { assert.sameValue(result[i], expected[i]); assert.sameValue(typeof result[i], "bigint"); assert.sameValue(Object.hasOwn(result, i), true); keys.push(String(i)); }
  if (result instanceof SpeciesBase) { assert.sameValue(result.marker, 7); keys.push("marker"); }
  assert.compareArray(Reflect.ownKeys(result), keys); assert.sameValue(Object.hasOwn(result, "length"), false); assert.sameValue(result.buffer === view.buffer, false);
  for (let i = 0; i < 3; i++) assert.sameValue(view[i], values[i]);
}
