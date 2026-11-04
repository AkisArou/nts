/*---
description: BigInt64Array values iterates and completes without reading constructor or species through a interface route.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-override, ts-construct-signatures, ts-tuples, ts-errors, ts-bigint, ts-interfaces]
---*/
// values crosses a declared BigInt64Array interface route; node returns the exact yielded values and repeated completion with no species or constructor reads.
const log: unknown[] = [], failure = new RangeError("species must not be read");
class SpeciesBase extends BigInt64Array {
  marker: number = 7;
  constructor(length: number) { super(length); log.push("base", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("wrong-species", this); throw failure; }
}
class SpeciesChild extends SpeciesBase {}
class SpeciesSibling extends SpeciesBase { static override get [Symbol.species](): Function { log.push("wrong-sibling", this); return Array; } }
type Factory = { new (length: number): BigInt64Array; readonly prototype: object };
interface Slot { view: BigInt64Array; }
function inspect(slot: Slot): unknown[] { const view = slot.view;
  const iterator: Iterator<bigint, undefined, undefined> = view.values(); const seen: unknown[] = [];
  for (let i = 0; i < 5; i++) { const step = iterator.next(); seen.push(step.done, step.value); } return seen;
}
const factories: Factory[] = [SpeciesBase, SpeciesChild, SpeciesSibling, BigInt64Array];
for (const input of [2n, 9007199254740993n]) for (const factory of factories) {
  log.length = 0; const view: BigInt64Array = new factory(3), values = [input, 1n, 2n]; assert.compareArray(log, factory === BigInt64Array ? [] : ["base", factory, 1, 3]);
  for (let i = 0; i < 3; i++) view[i] = values[i]; Object.defineProperty(view, "constructor", { get() { log.push("wrong-constructor"); throw failure; } }); log.length = 0;
  const result = inspect({ view }); assert.compareArray(result, [false, input, false, 1n, false, 2n, true, undefined, true, undefined]); assert.compareArray(log, []);
  assert.sameValue(Array.isArray(result), true); assert.sameValue(result instanceof Array, true); assert.sameValue(ArrayBuffer.isView(result), false);
  assert.compareArray([view instanceof SpeciesBase, view instanceof SpeciesChild, view instanceof SpeciesSibling, view instanceof BigInt64Array, view instanceof Object], [factory !== BigInt64Array, factory === SpeciesChild, factory === SpeciesSibling, true, true]);
  const prototype: unknown = Object.getPrototypeOf(view); assert.sameValue(prototype, factory.prototype); assert.sameValue(ArrayBuffer.isView(view), true); assert.sameValue(view.length, 3);
  for (let i = 0; i < 3; i++) { assert.sameValue(view[i], values[i]); assert.sameValue(typeof view[i], "bigint"); assert.sameValue(Object.hasOwn(view, i), true); }
  const keys = ["0", "1", "2"]; if (view instanceof SpeciesBase) { assert.sameValue(view.marker, 7); keys.push("marker"); } keys.push("constructor"); assert.compareArray(Reflect.ownKeys(view), keys);
  const resultKeys: string[] = []; for (let i = 0; i < result.length; i++) { assert.sameValue(Object.hasOwn(result, i), true); resultKeys.push(String(i)); } resultKeys.push("length"); assert.compareArray(Reflect.ownKeys(result), resultKeys);
}
