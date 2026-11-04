/*---
description: Subarray on interface-held Uint16Array subclasses passes the shared buffer, composed byte offset and element count to species. The control selects species and constructs the same buffer view with three arguments.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-interfaces, ts-construct-signatures, ts-tuples, ts-rest-parameters, ts-symbols, ts-accessors, ts-static, ts-this, ts-override, ts-numbers, ts-errors]
---*/
// subarray crosses Slot.view; node calls species with three arguments, preserves the selected class and aliases the receiver bytes. The control uses explicit construction and element operations.
function choose(view: object, fallback: Function): Function {
  const ctor: unknown = Reflect.get(view, "constructor");
  if (ctor === undefined) return fallback;
  if ((typeof ctor !== "object" || ctor === null) && typeof ctor !== "function") throw new TypeError();
  const species: unknown = Reflect.get(ctor, Symbol.species);
  if (species === null || species === undefined) return fallback;
  if (typeof species !== "function") throw new TypeError(); return species;
}
function part(view: Uint16Array): Uint16Array {
  const result: unknown = Reflect.construct(choose(view, Uint16Array), [view.buffer, view.byteOffset + 2, 2]);
  if (!(result instanceof Uint16Array) || !ArrayBuffer.isView(result) || (result.buffer instanceof ArrayBuffer && result.buffer.detached)) throw new TypeError(); return result;
}
const log: unknown[] = [];
class SpeciesWords extends Uint16Array {
  marker: number = 7;
  constructor(...args: [ArrayBuffer, number?, number?]) { super(args[0], args[1], args[2]); log.push("words", new.target, args.length, ...args); }
  static get [Symbol.species](): Function { log.push("species", this); return this; }
}
class SpeciesWordChild extends SpeciesWords {}
class SpeciesWordSibling extends SpeciesWords { static override get [Symbol.species](): Function { log.push("sibling.species", this); return Uint16Array; } }
interface Slot { view: Uint16Array; }
type Factory = { new (...args: [ArrayBuffer, number?, number?]): Uint16Array; readonly prototype: object };
function apply(slot: Slot): Uint16Array { return part(slot.view); }
const factories: Factory[] = [SpeciesWords, SpeciesWordChild, SpeciesWordSibling, Uint16Array];
for (const input of [0, 127, 65530]) for (const factory of factories) {
  const buffer = new ArrayBuffer(16); log.length = 0; const view: Uint16Array = new factory(buffer, 2, 4);
  assert.compareArray(log, factory === Uint16Array ? [] : ["words", factory, 3, buffer, 2, 4]);
  for (let i = 0; i < 4; i++) view[i] = input + i;
  const slot: Slot = { view }; log.length = 0; const result = apply(slot), selected = factory === SpeciesWordSibling ? Uint16Array : factory;
  const wanted: unknown[] = factory === Uint16Array ? [] : [factory === SpeciesWordSibling ? "sibling.species" : "species", factory];
  if (selected !== Uint16Array) wanted.push("words", selected, 3, buffer, 4, 2);
  assert.compareArray(log, wanted); assert.sameValue(result.length, 2); assert.sameValue(result.byteOffset, 4); assert.sameValue(result.byteLength, 4); assert.sameValue(result.buffer, buffer);
  assert.compareArray([result instanceof SpeciesWords, result instanceof SpeciesWordChild, result instanceof SpeciesWordSibling, result instanceof Uint16Array, result instanceof Object], [selected !== Uint16Array, selected === SpeciesWordChild, false, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, selected.prototype); assert.sameValue(ArrayBuffer.isView(result), true);
  assert.sameValue(result[0], input + 1); assert.sameValue(result[1], input + 2); assert.sameValue(typeof result[0], "number");
  const keys = ["0", "1"]; if (result instanceof SpeciesWords) { assert.sameValue(result.marker, 7); keys.push("marker"); }
  assert.compareArray(Reflect.ownKeys(result), keys); assert.sameValue(Object.hasOwn(result, 0), true); assert.sameValue(Object.hasOwn(result, 1), true); assert.sameValue(Object.hasOwn(result, 2), false);
  result[0] = 50000; view[2] = 49999; assert.sameValue(view[1], 50000); assert.sameValue(result[1], 49999);
  const full = new Uint16Array(buffer); assert.compareArray([...full], [0, input, 50000, 49999, input + 3, 0, 0, 0]);
}
