/*---
description: Typed map rejects primitive own constructors and nonconstructible species before any callback or result constructor. The control performs the specified constructor/species lookup and lets checked Reflect.construct reject nonconstructible functions.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-symbols, ts-accessors, ts-static, ts-this, ts-tuples, ts-errors, ts-arrow-functions, ts-numbers, ts-bigint]
---*/
// map crosses a Uint8Array tuple element; node throws TypeError after the exact constructor/species reads and leaves all source slots unchanged. The control uses explicit construction and element operations.
function choose(view: object, fallback: Function): Function {
  const ctor: unknown = Reflect.get(view, "constructor");
  if (ctor === undefined) return fallback;
  if ((typeof ctor !== "object" || ctor === null) && typeof ctor !== "function") throw new TypeError();
  const species: unknown = Reflect.get(ctor, Symbol.species);
  if (species === null || species === undefined) return fallback;
  if (typeof species !== "function") throw new TypeError(); return species;
}
function allocate(view: Uint8Array, length: number): Uint8Array {
  const result: unknown = Reflect.construct(choose(view, Uint8Array), [length]);
  if (!(result instanceof Uint8Array) || !ArrayBuffer.isView(result) || (result.buffer instanceof ArrayBuffer && result.buffer.detached) || result.length < length) throw new TypeError();
  return result;
}
const log: unknown[] = [];
class SpeciesSource extends Uint8Array {
  constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("wrong-default", this); return this; }
}
class SpeciesChild extends SpeciesSource {}
const arrow = (length: number): Uint8Array => { log.push("wrong-arrow-call", length); return new Uint8Array(length); };
const arrowHolder = { get [Symbol.species](): Function { log.push("species", this); return arrow; } };
const objectHolder = { get [Symbol.species](): object { log.push("species", this); return {}; } };
const numericHolder = { get [Symbol.species](): number { log.push("species", this); return 7; } };
function callback(value: number, index: number): number { log.push("wrong-callback", index, value); return value; }
function apply(pair: [Uint8Array, string]): Uint8Array { const view = pair[0], result = allocate(view, view.length); for (let i = 0; i < view.length; i++) result[i] = callback(view[i], i); return result; }
const replacements: [unknown, boolean][] = [[null, false], [17, false], ["bad", false], [false, false], [7n, false], [Symbol("ctor"), false], [arrowHolder, true], [objectHolder, true], [numericHolder, true]];
for (const factory of [SpeciesSource, SpeciesChild]) for (const [replacement, readsSpecies] of replacements) {
  log.length = 0; const view: Uint8Array = new factory(3); assert.compareArray(log, ["source", factory, 1, 3]);
  view[0] = 3; view[1] = 4; view[2] = 5;
  Object.defineProperty(view, "constructor", { configurable: true, get() { log.push("constructor", view); return replacement; } }); log.length = 0;
  assert.throws(TypeError, () => apply([view, "invalid"]));
  assert.compareArray(log, readsSpecies ? ["constructor", view, "species", replacement] : ["constructor", view]);
  assert.sameValue(view.length, 3); assert.compareArray([...view], [3, 4, 5]); assert.compareArray(Reflect.ownKeys(view), ["0", "1", "2", "constructor"]);
  assert.compareArray([view instanceof SpeciesSource, view instanceof SpeciesChild, view instanceof Uint8Array, view instanceof Object], [true, factory === SpeciesChild, true, true]);
  const prototype: unknown = Object.getPrototypeOf(view); assert.sameValue(prototype, factory.prototype); assert.sameValue(ArrayBuffer.isView(view), true);
  for (let i = 0; i < 3; i++) { assert.sameValue(typeof view[i], "number"); assert.sameValue(Object.hasOwn(view, i), true); }
}
