/*---
description: Subarray accepts a shorter species view because its three-argument construction does not apply the single-length minimum check. The control constructs a three-argument species view and validates its brand and attachment without imposing a single-length minimum.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-generics, ts-generic-constraints, ts-tuples, ts-rest-parameters, ts-numbers, ts-errors]
---*/
// subarray crosses a constrained generic parameter; node passes buffer, offset and requested length, accepts a one-element result and preserves its aliasing. The control uses explicit construction and element operations.
function choose(view: object, fallback: Function): Function {
  const ctor: unknown = Reflect.get(view, "constructor");
  if (ctor === undefined) return fallback;
  if ((typeof ctor !== "object" || ctor === null) && typeof ctor !== "function") throw new TypeError();
  const species: unknown = Reflect.get(ctor, Symbol.species);
  if (species === null || species === undefined) return fallback;
  if (typeof species !== "function") throw new TypeError(); return species;
}
function explicit(view: Uint16Array): Uint16Array {
  const result: unknown = Reflect.construct(choose(view, Uint16Array), [view.buffer, view.byteOffset + 2, 3]);
  if (!(result instanceof Uint16Array) || !ArrayBuffer.isView(result) || (result.buffer instanceof ArrayBuffer && result.buffer.detached)) throw new TypeError(); return result;
}
const log: unknown[] = [];
class SmallResult extends Uint16Array {
  marker: number = 13;
  constructor(...args: [ArrayBuffer, number, number]) { super(args[0], args[1], 1); log.push("small", new.target, args.length, ...args); }
}
class SpeciesSource extends Uint16Array {
  constructor(buffer: ArrayBuffer) { super(buffer); log.push("source", new.target, arguments.length, buffer); }
  static get [Symbol.species](): Function { log.push("species", this); return SmallResult; }
}
class SpeciesChild extends SpeciesSource {}
function apply<T extends Uint16Array>(view: T): Uint16Array { return explicit(view); }
for (const input of [1, 1000, 65530]) for (const factory of [SpeciesSource, SpeciesChild]) {
  const buffer = new ArrayBuffer(8); log.length = 0; const view: Uint16Array = new factory(buffer); assert.compareArray(log, ["source", factory, 1, buffer]);
  for (let i = 0; i < 4; i++) view[i] = input + i; log.length = 0; const result = apply(view);
  assert.compareArray(log, ["species", factory, "small", SmallResult, 3, buffer, 2, 3]);
  assert.sameValue(result.length, 1); assert.sameValue(result.byteLength, 2); assert.sameValue(result.byteOffset, 2); assert.sameValue(result.buffer, buffer);
  assert.compareArray([result instanceof SmallResult, result instanceof SpeciesSource, result instanceof SpeciesChild, result instanceof Uint16Array, result instanceof Object], [true, false, false, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, SmallResult.prototype); assert.sameValue(ArrayBuffer.isView(result), true);
  assert.sameValue(result[0], input + 1); assert.sameValue(typeof result[0], "number"); assert.sameValue(Object.hasOwn(result, 0), true); assert.sameValue(Object.hasOwn(result, 1), false);
  if (result instanceof SmallResult) assert.sameValue(result.marker, 13); assert.compareArray(Reflect.ownKeys(result), ["0", "marker"]);
  result[0] = 77; assert.compareArray([...view], [input, 77, input + 2, input + 3]); assert.sameValue(view.length, 4);
}
