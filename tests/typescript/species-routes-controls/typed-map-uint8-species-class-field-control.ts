/*---
description: Float64Array map writes into a species-selected Uint8Array subclass and converts each stored element through a class route. The control performs species lookup, checked construction, then sequential converted stores or same-type byte copies.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-symbols, ts-accessors, ts-static, ts-this, ts-override, ts-class-fields, ts-construct-signatures, ts-tuples, ts-errors, ts-numbers]
---*/
// map crosses a declared Float64Array class route; node constructs the selected result class with length 3 and keeps exact converted values and write order. The control uses explicit construction and element operations.
function choose(view: object, fallback: Function): Function {
  const ctor: unknown = Reflect.get(view, "constructor");
  if (ctor === undefined) return fallback;
  if ((typeof ctor !== "object" || ctor === null) && typeof ctor !== "function") throw new TypeError();
  const species: unknown = Reflect.get(ctor, Symbol.species);
  if (species === null || species === undefined) return fallback;
  if (typeof species !== "function") throw new TypeError(); return species;
}
function allocate(view: Float64Array, length: number): Float64Array | Uint8Array {
  const result: unknown = Reflect.construct(choose(view, Float64Array), [length]);
  if (!(result instanceof Float64Array) && !(result instanceof Uint8Array)) throw new TypeError();
  if (!ArrayBuffer.isView(result) || (result.buffer instanceof ArrayBuffer && result.buffer.detached) || result.length < length) throw new TypeError(); return result;
}
const log: unknown[] = [], made: Uint8Array[] = [];
class SpeciesTarget extends Uint8Array {
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
class Slot { view: Float64Array; constructor(view: Float64Array) { this.view = view; } }
function callback(value: number, index: number, view: Float64Array): number { log.push("map", index, value, view, made.length === 0 || index === 0 ? undefined : made[0][index - 1]); return value; }
function apply(slot: Slot): ArrayBufferView { const view = slot.view; const result = allocate(view, view.length); for (let i = 0; i < view.length; i++) result[i] = callback(view[i], i, view); return result; }
const rows: [number[], number[]][] = [[[-129.5, 130.5, 257.75], [127, 130, 1]], [[NaN, Infinity, -Infinity], [0, 0, 0]], [[-0, 0.5, 255.9], [0, 0, 255]]], factories: Factory[] = [SpeciesSource, SpeciesSourceChild, SpeciesSourceSibling, Float64Array];
for (const [values, converted] of rows) for (const factory of factories) {
  log.length = 0; made.length = 0; const view: Float64Array = new factory(3);
  assert.compareArray(log, factory === Float64Array ? [] : ["source", factory, 1, 3]); for (let i = 0; i < 3; i++) view[i] = values[i];
  log.length = 0; const result = apply(new Slot(view)), selected = factory === Float64Array ? Float64Array : factory === SpeciesSourceSibling ? SpeciesTargetChild : SpeciesTarget;
  const wanted: unknown[] = factory === Float64Array ? [] : [factory === SpeciesSourceSibling ? "sibling.species" : "species", factory, "target", selected, 1, 3]; for (let i = 0; i < 3; i++) wanted.push("map", i, values[i], view, selected === Float64Array || i === 0 ? undefined : converted[i - 1]);
  assert.compareArray(log, wanted); assert.sameValue(ArrayBuffer.isView(result), true); const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, selected.prototype);
  assert.compareArray([result instanceof SpeciesSource, result instanceof SpeciesSourceChild, result instanceof SpeciesSourceSibling, result instanceof SpeciesTarget, result instanceof SpeciesTargetChild, result instanceof Float64Array, result instanceof Uint8Array, result instanceof Object], [false, false, false, factory !== Float64Array, factory === SpeciesSourceSibling, factory === Float64Array, factory !== Float64Array, true]);
  if (!(result instanceof Float64Array) && !(result instanceof Uint8Array)) throw new Error("unexpected typed array");
  assert.sameValue(result.length, 3); assert.sameValue(result.buffer === view.buffer, false); assert.sameValue(made.length, factory === Float64Array ? 0 : 1);
  const keys: string[] = []; for (let i = 0; i < 3; i++) { assert.sameValue(result[i], factory === Float64Array ? values[i] : converted[i]); assert.sameValue(typeof result[i], "number"); assert.sameValue(Object.hasOwn(result, i), true); keys.push(String(i)); }
  if (result instanceof SpeciesTarget) { assert.sameValue(result.marker, 13); assert.sameValue(result, made[0]); keys.push("marker"); }
  if (result instanceof SpeciesTargetChild) { assert.sameValue(result.extra, 17); keys.push("extra"); }
  assert.compareArray(Reflect.ownKeys(result), keys); assert.sameValue(Object.hasOwn(result, "length"), false); for (let i = 0; i < 3; i++) assert.sameValue(view[i], values[i]);
}
