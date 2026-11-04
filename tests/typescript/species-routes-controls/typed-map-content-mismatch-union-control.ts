/*---
description: Typed map rejects species with the other number-or-bigint content type in both directions and preserves constructed result contents. The control constructs the species result, checks its brand and bounds, then rejects a content-type mismatch before any callback or write.
features: [ts-species-routes, ts-species-route-typed-arrays, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-typeof-operator, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-construct-signatures, ts-unions, ts-narrowing, ts-errors, ts-arrow-functions, ts-numbers, ts-bigint]
---*/
// map crosses a narrowed Float64Array-or-BigInt64Array union; node retains constructor-seeded results and throws TypeError, with only its known delayed callback timing unasserted. The control uses explicit construction and element operations.
function choose(view: object, fallback: Function): Function {
  const ctor: unknown = Reflect.get(view, "constructor");
  if (ctor === undefined) return fallback;
  if ((typeof ctor !== "object" || ctor === null) && typeof ctor !== "function") throw new TypeError();
  const species: unknown = Reflect.get(ctor, Symbol.species);
  if (species === null || species === undefined) return fallback;
  if (typeof species !== "function") throw new TypeError(); return species;
}
function explicit(view: Float64Array | BigInt64Array): ArrayBufferView {
  const result: unknown = Reflect.construct(choose(view, view instanceof BigInt64Array ? BigInt64Array : Float64Array), [view.length]);
  if (!(result instanceof Float64Array) && !(result instanceof BigInt64Array)) throw new TypeError();
  if (!ArrayBuffer.isView(result) || (result.buffer instanceof ArrayBuffer && result.buffer.detached) || result.length < view.length) throw new TypeError();
  if (view instanceof BigInt64Array && result instanceof BigInt64Array) { for (let i = 0; i < view.length; i++) result[i] = big(view[i], i); }
  else if (view instanceof Float64Array && result instanceof Float64Array) { for (let i = 0; i < view.length; i++) result[i] = numeric(view[i], i); } else throw new TypeError(); return result;
}
const log: unknown[] = [], callbacks: unknown[] = [], made: (Float64Array | BigInt64Array)[] = [];
// Pinned node calls callback 0 before its mismatch TypeError; that callback timing alone is unasserted (PR reproducer).
class WrongBig extends BigInt64Array { marker: number = 31; constructor(length: number) { super(length); log.push("result", new.target, arguments.length, length); made.push(this); for (let i = 0; i < length; i++) { this[i] = 77n; log.push("seed", i, this[i]); } } }
class WrongNumber extends Float64Array { marker: number = 37; constructor(length: number) { super(length); log.push("result", new.target, arguments.length, length); made.push(this); for (let i = 0; i < length; i++) { this[i] = -0; log.push("seed", i, this[i]); } } }
class NumberSource extends Float64Array {
  constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("species", this); return WrongBig; }
}
class NumberChild extends NumberSource {}
class BigSource extends BigInt64Array {
  constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); }
  static get [Symbol.species](): Function { log.push("species", this); return WrongNumber; }
}
class BigChild extends BigSource {}
function numeric(value: number, index: number): number { callbacks.push("callback", index, value); return value; }
function big(value: bigint, index: number): bigint { callbacks.push("callback", index, value); return value; }
function apply(view: Float64Array | BigInt64Array): ArrayBufferView { return explicit(view); }
const factories: (new (length: number) => Float64Array | BigInt64Array)[] = [NumberSource, NumberChild, BigSource, BigChild];
for (const factory of factories) {
  log.length = 0; callbacks.length = 0; made.length = 0; const view = new factory(3), numbers = [NaN, -0, 4.5], bigints = [2n, 9007199254740993n, -1n];
  assert.compareArray(log, ["source", factory, 1, 3]); for (let i = 0; i < 3; i++) { if (view instanceof BigInt64Array) view[i] = bigints[i]; else view[i] = numbers[i]; }
  const sourceBig = view instanceof BigInt64Array, target = sourceBig ? WrongNumber : WrongBig, seed = sourceBig ? -0 : 77n;
  log.length = 0; assert.throws(TypeError, () => apply(view)); assert.sameValue(made.length, 1); const result = made[0];
  assert.compareArray(log, ["species", factory, "result", target, 1, 3, "seed", 0, seed, "seed", 1, seed, "seed", 2, seed]);
  assert.compareArray([result instanceof WrongBig, result instanceof WrongNumber, result instanceof NumberSource, result instanceof NumberChild, result instanceof BigSource, result instanceof BigChild, result instanceof Float64Array, result instanceof BigInt64Array, result instanceof Object], [!sourceBig, sourceBig, false, false, false, false, sourceBig, !sourceBig, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, target.prototype); assert.sameValue(ArrayBuffer.isView(result), true); assert.sameValue(result.length, 3);
  for (let i = 0; i < 3; i++) { assert.sameValue(result[i], seed); assert.sameValue(typeof result[i], sourceBig ? "number" : "bigint"); assert.sameValue(Object.hasOwn(result, i), true); assert.sameValue(view[i], sourceBig ? bigints[i] : numbers[i]); }
  if (result instanceof WrongBig) assert.sameValue(result.marker, 31); if (result instanceof WrongNumber) assert.sameValue(result.marker, 37);
  assert.compareArray(Reflect.ownKeys(result), ["0", "1", "2", "marker"]); assert.sameValue(Object.hasOwn(result, "length"), false); assert.sameValue(result.buffer === view.buffer, false);
}
