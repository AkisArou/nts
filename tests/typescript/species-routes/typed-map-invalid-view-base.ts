/*---
description: Typed map rejects ordinary objects, DataViews and typed-array-prototype impostors returned by species, retaining every constructor effect.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-symbols, ts-accessors, ts-static, ts-this, ts-typeof-type, ts-errors, ts-arrow-functions, ts-numbers]
---*/
// map crosses a Uint8Array parameter; node constructs once then throws TypeError before callbacks or result writes, even when instanceof resembles a typed array.
const log: unknown[] = [], made: object[] = []; let mode = "object";
class SpeciesBad {
  constructor(length: number) {
    log.push("bad", new.target, arguments.length, length);
    const result: object = mode === "object" ? { 0: 99, length } : mode === "dataview" ? new DataView(new ArrayBuffer(length)) : Object.create(Uint8Array.prototype);
    if (result instanceof DataView) result.setUint8(0, 99); else Object.defineProperty(result, "0", { value: 99, writable: true, enumerable: true, configurable: true });
    Object.defineProperty(result, "stamp", { value: 41, enumerable: true, configurable: true }); made.push(result); log.push("seed", result); return result;
  }
}
class SpeciesBadChild extends SpeciesBad {}
let selected: typeof SpeciesBad = SpeciesBad;
class SpeciesSource extends Uint8Array {
  constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("species", this); return selected; }
}
class SpeciesSourceChild extends SpeciesSource {}
function callback(value: number, index: number): number { log.push("wrong-callback", index, value); return value; }
function apply(view: Uint8Array): Uint8Array { return view.map(callback); }
for (const kind of ["object", "dataview", "prototype"]) for (const target of [SpeciesBad, SpeciesBadChild]) for (const factory of [SpeciesSource, SpeciesSourceChild]) {
  mode = kind; selected = target; log.length = 0; made.length = 0; const view: Uint8Array = new factory(3); assert.compareArray(log, ["source", factory, 1, 3]);
  view[0] = 1; view[1] = 2; view[2] = 3; log.length = 0; assert.throws(TypeError, () => apply(view)); assert.sameValue(made.length, 1); const result = made[0];
  assert.compareArray(log, ["species", factory, "bad", target, 1, 3, "seed", result]);
  assert.compareArray([result instanceof SpeciesBad, result instanceof SpeciesBadChild, result instanceof SpeciesSource, result instanceof SpeciesSourceChild, result instanceof Uint8Array, result instanceof DataView, result instanceof Object], [false, false, false, false, kind === "prototype", kind === "dataview", true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, kind === "object" ? Object.prototype : kind === "dataview" ? DataView.prototype : Uint8Array.prototype);
  assert.sameValue(ArrayBuffer.isView(result), kind === "dataview"); const stamp: unknown = Reflect.get(result, "stamp"); assert.sameValue(stamp, 41); assert.sameValue(typeof stamp, "number");
  if (result instanceof DataView) { assert.sameValue(result.byteLength, 3); assert.sameValue(result.getUint8(0), 99); assert.sameValue(result.getUint8(1), 0); assert.sameValue(result.getUint8(2), 0); }
  else { const cell: unknown = Reflect.get(result, "0"); assert.sameValue(cell, 99); assert.sameValue(typeof cell, "number"); assert.sameValue(Object.hasOwn(result, "1"), false); }
  assert.compareArray(Reflect.ownKeys(result), kind === "object" ? ["0", "length", "stamp"] : kind === "dataview" ? ["stamp"] : ["0", "stamp"]);
  assert.sameValue(view.length, 3); assert.compareArray([...view], [1, 2, 3]); assert.compareArray(Reflect.ownKeys(view), ["0", "1", "2"]);
}
