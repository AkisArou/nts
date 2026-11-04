/*---
description: BigInt64Array slice writes into a species-selected BigUint64Array subclass and converts each stored element through a generic route. The control performs species lookup, checked construction, then sequential converted stores or same-type byte copies.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-symbols, ts-accessors, ts-static, ts-this, ts-override, ts-class-fields, ts-construct-signatures, ts-tuples, ts-errors, ts-bigint, ts-generics, ts-generic-constraints]
---*/
// slice crosses a declared BigInt64Array generic route; node constructs the selected result class with length 2 and keeps exact converted values and write order. The control uses explicit construction and element operations.
function choose(view: object, fallback: Function): Function {
  const ctor: unknown = Reflect.get(view, "constructor");
  if (ctor === undefined) return fallback;
  if ((typeof ctor !== "object" || ctor === null) && typeof ctor !== "function") throw new TypeError();
  const species: unknown = Reflect.get(ctor, Symbol.species);
  if (species === null || species === undefined) return fallback;
  if (typeof species !== "function") throw new TypeError(); return species;
}
function allocate(view: BigInt64Array, length: number): BigInt64Array | BigUint64Array {
  const result: unknown = Reflect.construct(choose(view, BigInt64Array), [length]);
  if (!(result instanceof BigInt64Array) && !(result instanceof BigUint64Array)) throw new TypeError();
  if (!ArrayBuffer.isView(result) || (result.buffer instanceof ArrayBuffer && result.buffer.detached) || result.length < length) throw new TypeError(); return result;
}
const log: unknown[] = [], made: BigUint64Array[] = [];
class SpeciesTarget extends BigUint64Array {
  marker: number = 13;
  constructor(length: number) { super(length); made.push(this); log.push("target", new.target, arguments.length, length); }
}
class SpeciesTargetChild extends SpeciesTarget { extra: number = 17; }
class SpeciesSource extends BigInt64Array {
  constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("species", this); return SpeciesTarget; }
}
class SpeciesSourceChild extends SpeciesSource {}
class SpeciesSourceSibling extends SpeciesSource { static override get [Symbol.species](): Function { log.push("sibling.species", this); return SpeciesTargetChild; } }
type Factory = { new (length: number): BigInt64Array; readonly prototype: object };


function apply<T extends BigInt64Array>(view: T): ArrayBufferView { const result = allocate(view, 2); if (result instanceof BigInt64Array) { const from = new Uint8Array(view.buffer, view.byteOffset, 2 * view.BYTES_PER_ELEMENT), into = new Uint8Array(result.buffer, result.byteOffset, from.length); for (let i = 0; i < from.length; i++) into[i] = from[i]; } else for (let i = 0; i < 2; i++) result[i] = view[i]; return result; }
const rows: [bigint[], bigint[]][] = [[[-1n, 0n, 9223372036854775807n], [18446744073709551615n, 0n]], [[-9223372036854775808n, 1n, 2n], [9223372036854775808n, 1n]]], factories: Factory[] = [SpeciesSource, SpeciesSourceChild, SpeciesSourceSibling, BigInt64Array];
for (const [values, converted] of rows) for (const factory of factories) {
  log.length = 0; made.length = 0; const view: BigInt64Array = new factory(3);
  assert.compareArray(log, factory === BigInt64Array ? [] : ["source", factory, 1, 3]); for (let i = 0; i < 3; i++) view[i] = values[i];
  log.length = 0; const result = apply(view), selected = factory === BigInt64Array ? BigInt64Array : factory === SpeciesSourceSibling ? SpeciesTargetChild : SpeciesTarget;
  const wanted: unknown[] = factory === BigInt64Array ? [] : [factory === SpeciesSourceSibling ? "sibling.species" : "species", factory, "target", selected, 1, 2];
  assert.compareArray(log, wanted); assert.sameValue(ArrayBuffer.isView(result), true); const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, selected.prototype);
  assert.compareArray([result instanceof SpeciesSource, result instanceof SpeciesSourceChild, result instanceof SpeciesSourceSibling, result instanceof SpeciesTarget, result instanceof SpeciesTargetChild, result instanceof BigInt64Array, result instanceof BigUint64Array, result instanceof Object], [false, false, false, factory !== BigInt64Array, factory === SpeciesSourceSibling, factory === BigInt64Array, factory !== BigInt64Array, true]);
  if (!(result instanceof BigInt64Array) && !(result instanceof BigUint64Array)) throw new Error("unexpected typed array");
  assert.sameValue(result.length, 2); assert.sameValue(result.buffer === view.buffer, false); assert.sameValue(made.length, factory === BigInt64Array ? 0 : 1);
  const keys: string[] = []; for (let i = 0; i < 2; i++) { assert.sameValue(result[i], factory === BigInt64Array ? values[i] : converted[i]); assert.sameValue(typeof result[i], "bigint"); assert.sameValue(Object.hasOwn(result, i), true); keys.push(String(i)); }
  if (result instanceof SpeciesTarget) { assert.sameValue(result.marker, 13); assert.sameValue(result, made[0]); keys.push("marker"); }
  if (result instanceof SpeciesTargetChild) { assert.sameValue(result.extra, 17); keys.push("extra"); }
  assert.compareArray(Reflect.ownKeys(result), keys); assert.sameValue(Object.hasOwn(result, "length"), false); for (let i = 0; i < 3; i++) assert.sameValue(view[i], values[i]);
}
