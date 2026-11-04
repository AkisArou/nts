/*---
description: ArrayBuffer slice copies the still-present source bytes after construction resizes it.
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-numbers, ts-typeof-operator, ts-generics, ts-generic-constraints, ts-class-fields, ts-symbols, ts-accessors, ts-narrowing]
---*/
// slice crosses a generic ArrayBuffer parameter; node retains the originally requested result length but copies only bytes still present after species construction.
const log: unknown[] = []; let active = new ArrayBuffer(0), resizedLength = 0;
class Source extends ArrayBuffer { marker: number = 5; constructor(length: number) { super(length, { maxByteLength: 12 }); log.push("source", new.target, arguments.length, length); } }
class Child extends Source {}
class Output extends ArrayBuffer {
  marker: number = 29;
  constructor(length: number) { super(length + 2); log.push("output", new.target, arguments.length, length); const bytes = new Uint8Array(this); for (let i = 0; i < bytes.length; i++) { bytes[i] = 91; log.push("seed", i, bytes[i]); } active.resize(resizedLength); log.push("resize", active, resizedLength, active.byteLength); }
}
class OutputChild extends Output {}
Object.defineProperty(Source, Symbol.species, { get() { log.push("species", this); return this === Child ? OutputChild : Output; } });
function run<T extends ArrayBuffer>(source: T): ArrayBuffer { return source.slice(2, 7); }
for (const Ctor of [Source, Child]) for (const size of [0, 1, 2, 4, 8, 10]) {
  resizedLength = size; log.length = 0; const source = new Ctor(8), bytes = new Uint8Array(source); active = source; for (let i = 0; i < 8; i++) bytes[i] = 10 + i;
  assert.compareArray(log, ["source", Ctor, 1, 8]); log.length = 0; const result = run(source), Target = Ctor === Child ? OutputChild : Output;
  const expectedLog: unknown[] = ["species", Ctor, "output", Target, 1, 5]; for (let i = 0; i < 7; i++) expectedLog.push("seed", i, 91); expectedLog.push("resize", source, size, size); assert.compareArray(log, expectedLog);
  assert.compareArray([result instanceof Source, result instanceof Child, result instanceof Output, result instanceof OutputChild, result instanceof ArrayBuffer], [false, false, true, Ctor === Child, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, Target.prototype); assert.sameValue(ArrayBuffer.isView(result), false); assert.sameValue(result === source, false);
  assert.sameValue(result.byteLength, 7); assert.sameValue(result.maxByteLength, 7); assert.sameValue(result.resizable, false); assert.sameValue(result.detached, false);
  const copied = Math.max(0, Math.min(5, size - 2)), output = new Uint8Array(result); for (let i = 0; i < 7; i++) { assert.sameValue(output[i], i < copied ? 12 + i : 91); assert.sameValue(typeof output[i], "number"); }
  if (result instanceof Output) assert.sameValue(result.marker, 29); assert.compareArray(Reflect.ownKeys(result), ["marker"]); assert.sameValue(Object.hasOwn(result, "byteLength"), false);
  assert.sameValue(source.byteLength, size); assert.sameValue(source.maxByteLength, 12); assert.sameValue(source.resizable, true); assert.sameValue(source.detached, false); assert.sameValue(source.marker, 5);
  assert.sameValue(bytes.length, size); for (let i = 0; i < size; i++) assert.sameValue(bytes[i], i < 8 ? 10 + i : 0);
}
