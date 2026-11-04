/*---
description: Uint8Array keys iterates and completes without reading constructor or species through a tuple route. The control uses a typed index iterator with the same ordered yields and permanent completed state.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-override, ts-construct-signatures, ts-tuples, ts-errors, ts-numbers]
---*/
// keys crosses a declared Uint8Array tuple route; node returns the exact yielded values and repeated completion with no species or constructor reads. The control uses explicit construction and element operations.
const log: unknown[] = [], failure = new RangeError("species must not be read");
class SpeciesBase extends Uint8Array {
  marker: number = 7;
  constructor(length: number) { super(length); log.push("base", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("wrong-species", this); throw failure; }
}
class SpeciesChild extends SpeciesBase {}
class SpeciesSibling extends SpeciesBase { static override get [Symbol.species](): Function { log.push("wrong-sibling", this); return Array; } }
type Factory = { new (length: number): Uint8Array; readonly prototype: object };
function inspect(pair: [Uint8Array, string]): unknown[] { const view = pair[0];
  let index = 0, done = false; const iterator: Iterator<number, undefined, undefined> = { next(): IteratorResult<number, undefined> { if (done || index >= view.length) { done = true; return { done: true, value: undefined }; } return { done: false, value: index++ }; } }; const seen: unknown[] = [];
  for (let i = 0; i < 5; i++) { const step = iterator.next(); seen.push(step.done, step.value); } return seen;
}
const factories: Factory[] = [SpeciesBase, SpeciesChild, SpeciesSibling, Uint8Array];
for (const input of [1, 250]) for (const factory of factories) {
  log.length = 0; const view: Uint8Array = new factory(3), values = [input, 1, 2]; assert.compareArray(log, factory === Uint8Array ? [] : ["base", factory, 1, 3]);
  for (let i = 0; i < 3; i++) view[i] = values[i]; Object.defineProperty(view, "constructor", { get() { log.push("wrong-constructor"); throw failure; } }); log.length = 0;
  const result = inspect([view, "keys"]); assert.compareArray(result, [false, 0, false, 1, false, 2, true, undefined, true, undefined]); assert.compareArray(log, []);
  assert.sameValue(Array.isArray(result), true); assert.sameValue(result instanceof Array, true); assert.sameValue(ArrayBuffer.isView(result), false);
  assert.compareArray([view instanceof SpeciesBase, view instanceof SpeciesChild, view instanceof SpeciesSibling, view instanceof Uint8Array, view instanceof Object], [factory !== Uint8Array, factory === SpeciesChild, factory === SpeciesSibling, true, true]);
  const prototype: unknown = Object.getPrototypeOf(view); assert.sameValue(prototype, factory.prototype); assert.sameValue(ArrayBuffer.isView(view), true); assert.sameValue(view.length, 3);
  for (let i = 0; i < 3; i++) { assert.sameValue(view[i], values[i]); assert.sameValue(typeof view[i], "number"); assert.sameValue(Object.hasOwn(view, i), true); }
  const keys = ["0", "1", "2"]; if (view instanceof SpeciesBase) { assert.sameValue(view.marker, 7); keys.push("marker"); } keys.push("constructor"); assert.compareArray(Reflect.ownKeys(view), keys);
  const resultKeys: string[] = []; for (let i = 0; i < result.length; i++) { assert.sameValue(Object.hasOwn(result, i), true); resultKeys.push(String(i)); } resultKeys.push("length"); assert.compareArray(Reflect.ownKeys(result), resultKeys);
}
