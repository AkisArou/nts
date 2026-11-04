/*---
description: ArrayBuffer slice preserves the full longer species result and its seeded tail. The control uses explicit construction, checks and byte operations.
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-numbers, ts-typeof-operator, ts-tuples, ts-class-fields, ts-symbols, ts-accessors, ts-null-undefined, ts-narrowing, ts-errors]
---*/
// slice crosses an ArrayBuffer tuple element; node copies the requested prefix into a longer species result without truncating its seeded tail or resizability. The control spells out the operation.
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
const log: unknown[] = []; let extra = 0, resizable = false;
class Source extends ArrayBuffer { constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class SourceChild extends Source {}
class Output extends ArrayBuffer {
  marker: number = 23;
  constructor(length: number) { super(length + extra, resizable ? { maxByteLength: length + extra + 2 } : undefined); log.push("output", new.target, arguments.length, length); const bytes = new Uint8Array(this); for (let i = 0; i < bytes.length; i++) { bytes[i] = 90 + i; log.push("seed", i, bytes[i]); } }
}
class OutputChild extends Output {}
Object.defineProperty(Source, Symbol.species, { get() { log.push("species", this); return this === SourceChild ? OutputChild : Output; } });
function run(route: [ArrayBuffer]): ArrayBuffer { return explicit(route[0], 1, 4); }
for (const Ctor of [Source, SourceChild]) for (const tail of [0, 2]) for (const growable of [false, true]) {
  extra = tail; resizable = growable; log.length = 0; const source = new Ctor(5), input = [7, 1, 128, 255, 9], bytes = new Uint8Array(source); for (let i = 0; i < 5; i++) bytes[i] = input[i];
  assert.compareArray(log, ["source", Ctor, 1, 5]); log.length = 0; const route: [ArrayBuffer] = [source], result = run(route), Target = Ctor === SourceChild ? OutputChild : Output;
  const expectedLog: unknown[] = ["species", Ctor, "output", Target, 1, 3]; for (let i = 0; i < 3 + tail; i++) expectedLog.push("seed", i, 90 + i); assert.compareArray(log, expectedLog);
  assert.compareArray([result instanceof Source, result instanceof SourceChild, result instanceof Output, result instanceof OutputChild, result instanceof ArrayBuffer, result instanceof Object], [false, false, true, Ctor === SourceChild, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, Target.prototype); assert.sameValue(ArrayBuffer.isView(result), false); assert.sameValue(result === source, false);
  assert.sameValue(result.byteLength, 3 + tail); assert.sameValue(result.maxByteLength, 3 + tail + (growable ? 2 : 0)); assert.sameValue(result.resizable, growable); assert.sameValue(result.detached, false);
  const output = new Uint8Array(result); for (let i = 0; i < output.length; i++) { assert.sameValue(output[i], i < 3 ? input[i + 1] : 90 + i); assert.sameValue(typeof output[i], "number"); }
  if (result instanceof Output) assert.sameValue(result.marker, 23); assert.compareArray(Reflect.ownKeys(result), ["marker"]); assert.sameValue(Object.hasOwn(result, "byteLength"), false);
  output[0] = 55; for (let i = 0; i < 5; i++) assert.sameValue(bytes[i], input[i]); assert.sameValue(source.detached, false);
}
