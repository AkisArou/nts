/*---
description: Own constructor values select another typed-array class or default to the receiver element type through an interface field.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-interfaces, ts-unions, ts-construct-signatures, ts-tuples, ts-errors, ts-numbers]
---*/
// map crosses a Uint8Array-or-Float64Array field; node reads the own constructor once, handles absent/null species, and selects Int16Array only when requested.
const log: unknown[] = [];
class SpeciesBytes extends Uint8Array { tag: number = 1; constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class SpeciesFloats extends Float64Array { tag: number = 2; constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class SpeciesTarget extends Int16Array {
  marker: number = 13;
  constructor(length: number) { super(length); log.push("target", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("target.species", this); return this; }
}
const nullish = { get [Symbol.species](): null { log.push("null.species", this); return null; } };
const missing = { get [Symbol.species](): undefined { log.push("undefined.species", this); return undefined; } };
interface Slot { view: Uint8Array | Float64Array; }
function callback(value: number, index: number, view: Uint8Array | Float64Array): number { log.push("map", index, value, view); return value; }
function apply(slot: Slot): ArrayBufferView { return slot.view.map(callback); }
const modes: [unknown, string][] = [[undefined, "none"], [{}, "empty"], [nullish, "null"], [missing, "undefined"], [SpeciesTarget, "target"]];
const factories: (new (length: number) => Uint8Array | Float64Array)[] = [SpeciesBytes, SpeciesFloats];
for (const input of [1, 255]) for (const factory of factories) for (const [replacement, mode] of modes) {
  log.length = 0; const view: Uint8Array | Float64Array = new factory(3); assert.compareArray(log, ["source", factory, 1, 3]);
  const values = [input, 128, 255]; for (let i = 0; i < 3; i++) view[i] = values[i];
  Object.defineProperty(view, "constructor", { configurable: true, get() { log.push("constructor", view); return replacement; } });
  const slot: Slot = { view }; log.length = 0; const result = apply(slot), selected = mode === "target" ? SpeciesTarget : factory === SpeciesFloats ? Float64Array : Uint8Array;
  const wanted: unknown[] = ["constructor", view]; if (mode === "null") wanted.push("null.species", nullish); if (mode === "undefined") wanted.push("undefined.species", missing);
  if (mode === "target") wanted.push("target.species", SpeciesTarget, "target", SpeciesTarget, 1, 3); for (let i = 0; i < 3; i++) wanted.push("map", i, values[i], view);
  assert.compareArray(log, wanted); assert.sameValue(ArrayBuffer.isView(result), true); const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, selected.prototype);
  assert.compareArray([result instanceof SpeciesBytes, result instanceof SpeciesFloats, result instanceof SpeciesTarget, result instanceof Uint8Array, result instanceof Float64Array, result instanceof Int16Array, result instanceof Object], [false, false, mode === "target", mode !== "target" && factory === SpeciesBytes, mode !== "target" && factory === SpeciesFloats, mode === "target", true]);
  if (!(result instanceof Uint8Array) && !(result instanceof Float64Array) && !(result instanceof Int16Array)) throw new Error("unexpected view");
  assert.sameValue(result.length, 3); assert.sameValue(result.buffer === view.buffer, false); const keys = ["0", "1", "2"];
  for (let i = 0; i < 3; i++) { assert.sameValue(result[i], values[i]); assert.sameValue(typeof result[i], "number"); assert.sameValue(Object.hasOwn(result, i), true); assert.sameValue(view[i], values[i]); }
  if (result instanceof SpeciesTarget) { assert.sameValue(result.marker, 13); keys.push("marker"); } assert.compareArray(Reflect.ownKeys(result), keys);
  assert.sameValue(Object.hasOwn(view, "constructor"), true); assert.compareArray(Reflect.ownKeys(view), ["0", "1", "2", "tag", "constructor"]);
  if (view instanceof SpeciesBytes) assert.sameValue(view.tag, 1); if (view instanceof SpeciesFloats) assert.sameValue(view.tag, 2);
}
