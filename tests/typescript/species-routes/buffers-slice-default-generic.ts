/*---
description: ArrayBuffer slice retains default species ancestry through a generic base return.
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-numbers, ts-typeof-operator, ts-generics, ts-generic-constraints, ts-tuples, ts-construct-signatures, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-narrowing]
---*/
// slice crosses a generic ArrayBuffer return; node constructs the runtime subclass with one slice-length argument and copies independent exact bytes.
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
  assert.compareArray(log, calls); log.length = 0; const result = carry(source).slice(start, end);
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
