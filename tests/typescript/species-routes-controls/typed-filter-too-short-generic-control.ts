/*---
description: Float64Array filter rejects short species results before writing and retains longer results with their constructor-seeded tail. The control selects species, constructs and checks the result before any output store, preserving method-specific callback order.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-construct-signatures, ts-errors, ts-arrow-functions, ts-numbers, ts-generics, ts-generic-constraints]
---*/
// filter crosses a generic route; node checks the species result length, preserves constructor effects on error, and collects filter values before construction. The control uses explicit construction and element operations.
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
const log: unknown[] = [], made: Float64Array[] = []; let allocationLength = 0;
class SpeciesResult extends Float64Array {
  marker: number = 13;
  constructor(length: number) { super(allocationLength); log.push("result", new.target, arguments.length, length); made.push(this); for (let i = 0; i < this.length; i++) { this[i] = 99; log.push("seed", i, this[i]); } }
}
class SpeciesSource extends Float64Array {
  constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("species", this); return SpeciesResult; }
}
class SpeciesChild extends SpeciesSource {}
function callback(value: number, index: number, view: Float64Array): boolean { log.push("filter", index, value, view, made.length); return index !== 1; }
function apply<T extends Float64Array>(view: T): Float64Array { const kept: number[] = []; for (let i = 0; i < view.length; i++) { const value = view[i]; if (callback(value, i, view)) kept.push(value); } const result = allocate(view, kept.length); for (let i = 0; i < kept.length; i++) result[i] = kept[i]; return result; }
const factories: (new (length: number) => Float64Array)[] = [SpeciesSource, SpeciesChild];
for (const size of [0, 1, 2, 4]) for (const factory of factories) {
  allocationLength = size; made.length = 0; log.length = 0; const view: Float64Array = new factory(3), values = [NaN, -0, 3.5], kept = [NaN, 3.5];
  assert.compareArray(log, ["source", factory, 1, 3]); for (let i = 0; i < 3; i++) view[i] = values[i]; log.length = 0;
  let result: Float64Array | undefined;
  if (size < 2) { assert.throws(TypeError, () => { result = apply(view); }); assert.sameValue(result, undefined); } else { result = apply(view); assert.sameValue(result, made[0]); }
  const wanted: unknown[] = []; for (let i = 0; i < 3; i++) wanted.push("filter", i, values[i], view, 0); wanted.push("species", factory, "result", SpeciesResult, 1, 2);
  for (let i = 0; i < size; i++) wanted.push("seed", i, 99);  assert.compareArray(log, wanted);
  assert.sameValue(made.length, 1); const out = made[0]; assert.sameValue(out.length, size); assert.sameValue(typeof out.length, "number");
  assert.compareArray([out instanceof SpeciesResult, out instanceof SpeciesSource, out instanceof SpeciesChild, out instanceof Float64Array, out instanceof Object], [true, false, false, true, true]);
  const prototype: unknown = Object.getPrototypeOf(out); assert.sameValue(prototype, SpeciesResult.prototype); assert.sameValue(ArrayBuffer.isView(out), true);
  const keys: string[] = []; for (let i = 0; i < size; i++) { assert.sameValue(out[i], size < 2 || i >= 2 ? 99 : kept[i]); assert.sameValue(typeof out[i], "number"); assert.sameValue(Object.hasOwn(out, i), true); keys.push(String(i)); }
  if (out instanceof SpeciesResult) { assert.sameValue(out.marker, 13); keys.push("marker"); } assert.compareArray(Reflect.ownKeys(out), keys);
  assert.sameValue(Object.hasOwn(out, size), false); assert.sameValue(Object.hasOwn(out, "length"), false); assert.sameValue(out.buffer === view.buffer, false);
  for (let i = 0; i < 3; i++) assert.sameValue(view[i], values[i]);
}
