/*---
description: Uint8Array map rejects short species results before writing and retains longer results with their constructor-seeded tail.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-construct-signatures, ts-errors, ts-arrow-functions, ts-numbers, ts-interfaces]
---*/
// map crosses a interface route; node checks the species result length, preserves constructor effects on error, and constructs before map callbacks.
const log: unknown[] = [], made: Uint8Array[] = []; let allocationLength = 0;
class SpeciesResult extends Uint8Array {
  marker: number = 13;
  constructor(length: number) { super(allocationLength); log.push("result", new.target, arguments.length, length); made.push(this); for (let i = 0; i < this.length; i++) { this[i] = 99; log.push("seed", i, this[i]); } }
}
class SpeciesSource extends Uint8Array {
  constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("species", this); return SpeciesResult; }
}
class SpeciesChild extends SpeciesSource {}
function callback(value: number, index: number, view: Uint8Array): number { log.push("map", index, value, view, made[0][0], made[0][1], made[0][2]); return value + 10; }
interface Slot { view: Uint8Array; }
function apply(slot: Slot): Uint8Array { const view = slot.view; return view.map(callback); }
const factories: (new (length: number) => Uint8Array)[] = [SpeciesSource, SpeciesChild];
for (const size of [0, 2, 3, 5]) for (const factory of factories) {
  allocationLength = size; made.length = 0; log.length = 0; const view: Uint8Array = new factory(3), values = [1, 2, 3], kept = [11, 12, 13];
  assert.compareArray(log, ["source", factory, 1, 3]); for (let i = 0; i < 3; i++) view[i] = values[i]; log.length = 0;
  let result: Uint8Array | undefined;
  if (size < 3) { assert.throws(TypeError, () => { result = apply({ view }); }); assert.sameValue(result, undefined); } else { result = apply({ view }); assert.sameValue(result, made[0]); }
  const wanted: unknown[] = [];  wanted.push("species", factory, "result", SpeciesResult, 1, 3);
  for (let i = 0; i < size; i++) wanted.push("seed", i, 99); if (allocationLength >= 3) for (let i = 0; i < 3; i++) wanted.push("map", i, values[i], view, i > 0 ? kept[0] : 99, i > 1 ? kept[1] : 99, 99); assert.compareArray(log, wanted);
  assert.sameValue(made.length, 1); const out = made[0]; assert.sameValue(out.length, size); assert.sameValue(typeof out.length, "number");
  assert.compareArray([out instanceof SpeciesResult, out instanceof SpeciesSource, out instanceof SpeciesChild, out instanceof Uint8Array, out instanceof Object], [true, false, false, true, true]);
  const prototype: unknown = Object.getPrototypeOf(out); assert.sameValue(prototype, SpeciesResult.prototype); assert.sameValue(ArrayBuffer.isView(out), true);
  const keys: string[] = []; for (let i = 0; i < size; i++) { assert.sameValue(out[i], size < 3 || i >= 3 ? 99 : kept[i]); assert.sameValue(typeof out[i], "number"); assert.sameValue(Object.hasOwn(out, i), true); keys.push(String(i)); }
  if (out instanceof SpeciesResult) { assert.sameValue(out.marker, 13); keys.push("marker"); } assert.compareArray(Reflect.ownKeys(out), keys);
  assert.sameValue(Object.hasOwn(out, size), false); assert.sameValue(Object.hasOwn(out, "length"), false); assert.sameValue(out.buffer === view.buffer, false);
  for (let i = 0; i < 3; i++) assert.sameValue(view[i], values[i]);
}
