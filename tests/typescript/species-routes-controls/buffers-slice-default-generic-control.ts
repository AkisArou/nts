/*---
description: ArrayBuffer slice retains default species ancestry through a generic base return. The control uses explicit construction, checks and byte operations.
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-numbers, ts-typeof-operator, ts-generics, ts-generic-constraints, ts-tuples, ts-construct-signatures, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-narrowing, ts-errors, ts-null-undefined]
---*/
// slice crosses a generic ArrayBuffer return; node constructs the runtime subclass with one slice-length argument and copies independent exact bytes. The control spells out the operation.
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
const log: unknown[] = [];
class BufferBase extends ArrayBuffer {
  marker: number = 7;
  constructor(length: number) { super(length); log.push("base", new.target, arguments.length, length); }
  static get [Symbol.species](): ArrayBufferConstructor { log.push("species", this); return super[Symbol.species]; }
}
class BufferMiddle extends BufferBase { constructor(length: number) { super(length); log.push("middle", new.target, arguments.length, length); } }
class BufferLeaf extends BufferMiddle { extra: number = 11; }
class BufferSibling extends BufferBase {}
function carry<T extends ArrayBuffer>(value: T): ArrayBuffer { return value; }
const factories: (new (length: number) => ArrayBuffer)[] = [BufferBase, BufferMiddle, BufferLeaf, BufferSibling, ArrayBuffer];
const ranges: [number, number, number[]][] = [[0, 0, []], [1, 4, [17, 128, 255]], [-3, 99, [255, 1, 64]]];
for (const Ctor of factories) for (const [start, end, expected] of ranges) {
  log.length = 0; const source = new Ctor(6), input = [0, 17, 128, 255, 1, 64], bytes = new Uint8Array(source);
  for (let i = 0; i < input.length; i++) bytes[i] = input[i];
  const calls: unknown[] = Ctor === ArrayBuffer ? [] : ["base", Ctor, 1, 6]; if (Ctor === BufferMiddle || Ctor === BufferLeaf) calls.push("middle", Ctor, 1, 6);
  assert.compareArray(log, calls); log.length = 0; const result = explicit(carry(source), start, end);
  const expectedLog: unknown[] = Ctor === ArrayBuffer ? [] : ["species", Ctor, "base", Ctor, 1, expected.length]; if (Ctor === BufferMiddle || Ctor === BufferLeaf) expectedLog.push("middle", Ctor, 1, expected.length);
  assert.compareArray(log, expectedLog);
  assert.compareArray([result instanceof BufferBase, result instanceof BufferMiddle, result instanceof BufferLeaf, result instanceof BufferSibling, result instanceof ArrayBuffer, result instanceof Object], [Ctor !== ArrayBuffer, Ctor === BufferMiddle || Ctor === BufferLeaf, Ctor === BufferLeaf, Ctor === BufferSibling, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, Ctor.prototype); assert.sameValue(ArrayBuffer.isView(result), false); assert.sameValue(result === source, false);
  assert.sameValue(result.byteLength, expected.length); assert.sameValue(result.maxByteLength, expected.length); assert.sameValue(result.resizable, false); assert.sameValue(result.detached, false);
  const output = new Uint8Array(result); for (let i = 0; i < expected.length; i++) { assert.sameValue(output[i], expected[i]); assert.sameValue(typeof output[i], "number"); }
  if (result instanceof BufferBase) assert.sameValue(result.marker, 7); if (result instanceof BufferLeaf) assert.sameValue(result.extra, 11);
  assert.compareArray(Reflect.ownKeys(result), Ctor === ArrayBuffer ? [] : Ctor === BufferLeaf ? ["marker", "extra"] : ["marker"]); assert.sameValue(Object.hasOwn(result, "byteLength"), false);
  if (output.length > 0) output[0] = 99; for (let i = 0; i < input.length; i++) assert.sameValue(bytes[i], input[i]);
  assert.sameValue(source.byteLength, 6); assert.sameValue(source.detached, false);
}
