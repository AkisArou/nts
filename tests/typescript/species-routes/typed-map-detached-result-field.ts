/*---
description: Typed map rejects a detached species result after construction and preserves its transferred pre-error bytes.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-interfaces, ts-errors, ts-arrow-functions, ts-numbers, ts-null-undefined]
---*/
// map crosses an interface field; node runs and detaches the result constructor once, then throws TypeError before callbacks while transferred seed bytes survive.
const log: unknown[] = [], made: Uint8Array[] = [], saved: ArrayBuffer[] = [];
class DetachedResult extends Uint8Array {
  marker: number = 13;
  constructor(length: number) {
    super(length); log.push("result", new.target, arguments.length, length); made.push(this); this[0] = 91; log.push("seed", 0, this[0]);
    const buffer = this.buffer; if (!(buffer instanceof ArrayBuffer)) throw new Error("unexpected buffer"); saved.push(buffer.transfer()); log.push("detach", this, buffer.detached);
  }
}
class SpeciesSource extends Uint8Array {
  constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("species", this); return DetachedResult; }
}
class SpeciesChild extends SpeciesSource {}
interface Slot { view: Uint8Array; }
function callback(value: number, index: number): number { log.push("wrong-callback", index, value); return value; }
function apply(slot: Slot): Uint8Array { return slot.view.map(callback); }
for (const size of [0, 2, 4]) for (const factory of [SpeciesSource, SpeciesChild]) {
  log.length = 0; made.length = 0; saved.length = 0; const view: Uint8Array = new factory(size); assert.compareArray(log, ["source", factory, 1, size]);
  for (let i = 0; i < size; i++) view[i] = i + 1; const slot: Slot = { view }; log.length = 0; assert.throws(TypeError, () => apply(slot));
  assert.sameValue(made.length, 1); assert.sameValue(saved.length, 1); const result = made[0], retained = new Uint8Array(saved[0]);
  assert.compareArray(log, ["species", factory, "result", DetachedResult, 1, size, "seed", 0, size === 0 ? undefined : 91, "detach", result, true]);
  assert.compareArray([result instanceof DetachedResult, result instanceof SpeciesSource, result instanceof SpeciesChild, result instanceof Uint8Array, result instanceof Object], [true, false, false, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, DetachedResult.prototype); assert.sameValue(ArrayBuffer.isView(result), true);
  assert.sameValue(result.length, 0); assert.sameValue(result.byteLength, 0); assert.sameValue(result.byteOffset, 0); assert.sameValue(Object.hasOwn(result, 0), false);
  const buffer = result.buffer; if (!(buffer instanceof ArrayBuffer)) throw new Error("unexpected buffer"); assert.sameValue(buffer.detached, true);
  if (result instanceof DetachedResult) assert.sameValue(result.marker, 13); assert.compareArray(Reflect.ownKeys(result), ["marker"]); assert.sameValue(retained.length, size);
  for (let i = 0; i < size; i++) { assert.sameValue(retained[i], i === 0 ? 91 : 0); assert.sameValue(view[i], i + 1); assert.sameValue(typeof retained[i], "number"); }
}
