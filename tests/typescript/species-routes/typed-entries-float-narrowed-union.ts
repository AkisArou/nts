/*---
description: Float64Array entries iterates and completes without reading constructor or species through a union route.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-override, ts-construct-signatures, ts-tuples, ts-errors, ts-numbers, ts-unions, ts-narrowing, ts-arrow-functions]
---*/
// entries crosses a declared Float64Array union route; node returns the exact yielded values and repeated completion with no species or constructor reads.
const log: unknown[] = [], failure = new RangeError("species must not be read");
class SpeciesBase extends Float64Array {
  marker: number = 7;
  constructor(length: number) { super(length); log.push("base", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("wrong-species", this); throw failure; }
}
class SpeciesChild extends SpeciesBase {}
class SpeciesSibling extends SpeciesBase { static override get [Symbol.species](): Function { log.push("wrong-sibling", this); return Array; } }
type Factory = { new (length: number): Float64Array; readonly prototype: object };
function inspect(value: Float64Array | undefined): unknown[] { if (!(value instanceof Float64Array)) throw new TypeError(); const view = value;
  const iterator: Iterator<[number, number], undefined, undefined> = view.entries(); const seen: unknown[] = [];
  for (let i = 0; i < 5; i++) { const step = iterator.next(); if (step.done) seen.push(true, step.value); else { assert.sameValue(step.done, false); assert.sameValue(Array.isArray(step.value), true); assert.compareArray(Reflect.ownKeys(step.value), ["0", "1", "length"]); seen.push(false, step.value[0], step.value[1]); } } return seen;
}
const factories: Factory[] = [SpeciesBase, SpeciesChild, SpeciesSibling, Float64Array];
for (const input of [-0, NaN, 3.5]) for (const factory of factories) {
  log.length = 0; const view: Float64Array = new factory(3), values = [input, 1, 2]; assert.compareArray(log, factory === Float64Array ? [] : ["base", factory, 1, 3]);
  for (let i = 0; i < 3; i++) view[i] = values[i]; Object.defineProperty(view, "constructor", { get() { log.push("wrong-constructor"); throw failure; } }); log.length = 0;
  const result = inspect(view); assert.compareArray(result, [false, 0, input, false, 1, 1, false, 2, 2, true, undefined, true, undefined]); assert.compareArray(log, []);
  assert.sameValue(Array.isArray(result), true); assert.sameValue(result instanceof Array, true); assert.sameValue(ArrayBuffer.isView(result), false);
  assert.compareArray([view instanceof SpeciesBase, view instanceof SpeciesChild, view instanceof SpeciesSibling, view instanceof Float64Array, view instanceof Object], [factory !== Float64Array, factory === SpeciesChild, factory === SpeciesSibling, true, true]);
  const prototype: unknown = Object.getPrototypeOf(view); assert.sameValue(prototype, factory.prototype); assert.sameValue(ArrayBuffer.isView(view), true); assert.sameValue(view.length, 3);
  for (let i = 0; i < 3; i++) { assert.sameValue(view[i], values[i]); assert.sameValue(typeof view[i], "number"); assert.sameValue(Object.hasOwn(view, i), true); }
  const keys = ["0", "1", "2"]; if (view instanceof SpeciesBase) { assert.sameValue(view.marker, 7); keys.push("marker"); } keys.push("constructor"); assert.compareArray(Reflect.ownKeys(view), keys);
  const resultKeys: string[] = []; for (let i = 0; i < result.length; i++) { assert.sameValue(Object.hasOwn(result, i), true); resultKeys.push(String(i)); } resultKeys.push("length"); assert.compareArray(Reflect.ownKeys(result), resultKeys);
}
assert.throws(TypeError, () => inspect(undefined));
