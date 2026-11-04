/*---
description: Own constructor and invalid species values govern ArrayBuffer slice through a tuple. The control uses explicit construction, checks and byte operations.
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-numbers, ts-typeof-operator, ts-tuples, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-errors, ts-arrow-functions, ts-null-undefined, ts-bigint, ts-narrowing]
---*/
// slice crosses an ArrayBuffer tuple element; node respects own constructor lookup, defaults missing species and rejects primitive constructors or nonconstructor species. The control spells out the operation.
function explicit(source: ArrayBuffer, start: number, end?: number): ArrayBuffer {
  if (source.detached) throw new TypeError();
  const length = source.byteLength, first = start < 0 ? Math.max(length + start, 0) : Math.min(start, length), final = end === undefined ? length : end < 0 ? Math.max(length + end, 0) : Math.min(end, length), size = Math.max(final - first, 0);
  let ctor: unknown = Reflect.get(source, "constructor");
  if (ctor === undefined) ctor = ArrayBuffer;
  else { if ((typeof ctor !== "object" || ctor === null) && typeof ctor !== "function") throw new TypeError(); ctor = Reflect.get(ctor, Symbol.species); if (ctor === null || ctor === undefined) ctor = ArrayBuffer; }
  if (typeof ctor !== "function") throw new TypeError(); const result: unknown = Reflect.construct(ctor, [size]);
  if (!(result instanceof ArrayBuffer) || result.detached || result === source || result.byteLength < size) throw new TypeError();
  if (source.detached) throw new TypeError();
  const from = new Uint8Array(source), to = new Uint8Array(result), count = Math.max(0, Math.min(size, source.byteLength - first));
  for (let i = 0; i < count; i++) to[i] = from[first + i]; return result;
}
const log: unknown[] = []; let selected: unknown;
class Source extends ArrayBuffer {
  marker: number = 7;
  constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); }
  static get [Symbol.species](): ArrayBufferConstructor { log.push("wrong-inherited-species", this); throw new Error("own constructor ignored"); }
}
class Child extends Source {}
class Output extends ArrayBuffer { marker: number = 31; constructor(length: number) { super(length); log.push("output", new.target, arguments.length, length); } }
const holder = { get [Symbol.species]() { log.push("species", this, selected); return selected; } };
const arrow = () => { log.push("arrow-called"); return new ArrayBuffer(3); };
function run(route: [ArrayBuffer]): ArrayBuffer { return explicit(route[0], 1, 4); }
const rows: [unknown, unknown, boolean, boolean][] = [[undefined, undefined, true, false], [arrow, undefined, true, false], [{}, undefined, true, false], [null, undefined, false, false], [0, undefined, false, false], ["x", undefined, false, false], [false, undefined, false, false], [1n, undefined, false, false], [Symbol("x"), undefined, false, false], [holder, arrow, false, true], [holder, {}, false, true], [holder, 0, false, true], [holder, null, true, true], [holder, undefined, true, true], [holder, Output, true, true]];
for (const [choice, species, passes, reads] of rows) {
  selected = species; log.length = 0; const source = new Child(5), input = [3, 17, 128, 255, 7], bytes = new Uint8Array(source); for (let i = 0; i < 5; i++) bytes[i] = input[i];
  assert.compareArray(log, ["source", Child, 1, 5]); log.length = 0; Object.defineProperty(source, "constructor", { get() { log.push("constructor", this); return choice; } });
  const route: [ArrayBuffer] = [source]; if (!passes) assert.throws(TypeError, () => run(route)); else {
    const result = run(route), Target = species === Output ? Output : ArrayBuffer;
    assert.compareArray([result instanceof Source, result instanceof Child, result instanceof Output, result instanceof ArrayBuffer], [false, false, species === Output, true]); const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, Target.prototype); assert.sameValue(ArrayBuffer.isView(result), false);
    assert.sameValue(result.byteLength, 3); assert.sameValue(result.detached, false); assert.sameValue(result === source, false); const output = new Uint8Array(result); for (let i = 0; i < 3; i++) { assert.sameValue(output[i], input[i + 1]); assert.sameValue(typeof output[i], "number"); }
    if (result instanceof Output) assert.sameValue(result.marker, 31); assert.compareArray(Reflect.ownKeys(result), species === Output ? ["marker"] : []);
  }
  const expectedLog: unknown[] = ["constructor", source]; if (reads) expectedLog.push("species", holder, species); if (species === Output) expectedLog.push("output", Output, 1, 3); assert.compareArray(log, expectedLog);
  assert.sameValue(source.byteLength, 5); assert.sameValue(source.detached, false); assert.sameValue(source.marker, 7); for (let i = 0; i < 5; i++) assert.sameValue(bytes[i], input[i]); assert.compareArray(Reflect.ownKeys(source), ["marker", "constructor"]);
}
