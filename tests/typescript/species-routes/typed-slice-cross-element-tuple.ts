/*---
description: Float64Array slice writes into a species-selected Int16Array subclass and converts each stored element through a tuple route.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-symbols, ts-accessors, ts-static, ts-this, ts-override, ts-class-fields, ts-construct-signatures, ts-tuples, ts-errors, ts-numbers]
---*/
// slice crosses a declared Float64Array tuple route; node constructs the selected result class with length 2 and keeps exact converted values and write order.
const log: unknown[] = [], made: Int16Array[] = [];
class SpeciesTarget extends Int16Array {
  marker: number = 13;
  constructor(length: number) { super(length); made.push(this); log.push("target", new.target, arguments.length, length); }
}
class SpeciesTargetChild extends SpeciesTarget { extra: number = 17; }
class SpeciesSource extends Float64Array {
  constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("species", this); return SpeciesTarget; }
}
class SpeciesSourceChild extends SpeciesSource {}
class SpeciesSourceSibling extends SpeciesSource { static override get [Symbol.species](): Function { log.push("sibling.species", this); return SpeciesTargetChild; } }
type Factory = { new (length: number): Float64Array; readonly prototype: object };


function apply(pair: [Float64Array, number]): ArrayBufferView { const view = pair[0]; return view.slice(0, pair[1]); }
const rows: [number[], number[]][] = [[[65535.75, 32768.5, 1], [-1, -32768]], [[-32769.5, NaN, 2], [32767, 0]], [[-0, -Infinity, 3], [0, 0]]], factories: Factory[] = [SpeciesSource, SpeciesSourceChild, SpeciesSourceSibling, Float64Array];
for (const [values, converted] of rows) for (const factory of factories) {
  log.length = 0; made.length = 0; const view: Float64Array = new factory(3);
  assert.compareArray(log, factory === Float64Array ? [] : ["source", factory, 1, 3]); for (let i = 0; i < 3; i++) view[i] = values[i];
  log.length = 0; const result = apply([view, 2]), selected = factory === Float64Array ? Float64Array : factory === SpeciesSourceSibling ? SpeciesTargetChild : SpeciesTarget;
  const wanted: unknown[] = factory === Float64Array ? [] : [factory === SpeciesSourceSibling ? "sibling.species" : "species", factory, "target", selected, 1, 2];
  assert.compareArray(log, wanted); assert.sameValue(ArrayBuffer.isView(result), true); const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, selected.prototype);
  assert.compareArray([result instanceof SpeciesSource, result instanceof SpeciesSourceChild, result instanceof SpeciesSourceSibling, result instanceof SpeciesTarget, result instanceof SpeciesTargetChild, result instanceof Float64Array, result instanceof Int16Array, result instanceof Object], [false, false, false, factory !== Float64Array, factory === SpeciesSourceSibling, factory === Float64Array, factory !== Float64Array, true]);
  if (!(result instanceof Float64Array) && !(result instanceof Int16Array)) throw new Error("unexpected typed array");
  assert.sameValue(result.length, 2); assert.sameValue(result.buffer === view.buffer, false); assert.sameValue(made.length, factory === Float64Array ? 0 : 1);
  const keys: string[] = []; for (let i = 0; i < 2; i++) { assert.sameValue(result[i], factory === Float64Array ? values[i] : converted[i]); assert.sameValue(typeof result[i], "number"); assert.sameValue(Object.hasOwn(result, i), true); keys.push(String(i)); }
  if (result instanceof SpeciesTarget) { assert.sameValue(result.marker, 13); assert.sameValue(result, made[0]); keys.push("marker"); }
  if (result instanceof SpeciesTargetChild) { assert.sameValue(result.extra, 17); keys.push("extra"); }
  assert.compareArray(Reflect.ownKeys(result), keys); assert.sameValue(Object.hasOwn(result, "length"), false); for (let i = 0; i < 3; i++) assert.sameValue(view[i], values[i]);
}
