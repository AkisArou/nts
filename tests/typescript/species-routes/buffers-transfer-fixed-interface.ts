/*---
description: ArrayBuffer transferToFixedLength bypasses species through a interface ArrayBuffer field.
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-numbers, ts-typeof-operator, ts-interfaces, ts-class-fields, ts-symbols, ts-accessors, ts-static, ts-this, ts-errors, ts-arrow-functions, ts-null-undefined, ts-unions, ts-construct-signatures, ts-narrowing]
---*/
// transferToFixedLength crosses a interface ArrayBuffer field; node returns a plain buffer with exact copied or zero-filled bytes, detaches the source and never reads constructor or species.
const log: unknown[] = [];
class BufferBase extends ArrayBuffer {
  marker: number = 7;
  constructor(length: number, options?: { maxByteLength: number }) { super(length, options); log.push("base", new.target, arguments.length, length, options); }
  static get [Symbol.species](): ArrayBufferConstructor { log.push("species", this); throw new Error("species read"); }
}
class BufferMiddle extends BufferBase { constructor(length: number, options?: { maxByteLength: number }) { super(length, options); log.push("middle", new.target, arguments.length, length, options); } }
class BufferLeaf extends BufferMiddle { extra: number = 11; }
class BufferSibling extends BufferBase {}
interface Holder { buffer: ArrayBuffer; }
function run(holder: Holder, length?: number): ArrayBuffer { return holder.buffer.transferToFixedLength(length); }
const factories: (new (length: number, options?: { maxByteLength: number }) => ArrayBuffer)[] = [BufferBase, BufferMiddle, BufferLeaf, BufferSibling, ArrayBuffer];
const lengths: (number | undefined)[] = [undefined, 0, 2, 4, 6, 10];
for (const Ctor of factories) for (const growable of [false, true]) for (const own of [false, true]) for (const requested of lengths) {
  log.length = 0; const options = growable ? { maxByteLength: 8 } : undefined, source = new Ctor(4, options), bytes = new Uint8Array(source), input = [0, 17, 128, 255]; for (let i = 0; i < 4; i++) bytes[i] = input[i];
  const expectedLog: unknown[] = Ctor === ArrayBuffer ? [] : ["base", Ctor, 2, 4, options]; if (Ctor === BufferMiddle || Ctor === BufferLeaf) expectedLog.push("middle", Ctor, 2, 4, options); assert.compareArray(log, expectedLog); log.length = 0;
  if (own) Object.defineProperty(source, "constructor", { get() { log.push("constructor", this); throw new Error("constructor read"); } });
  const result = run({ buffer: source }, requested), length = requested === undefined ? 4 : requested; assert.compareArray(log, []);
  assert.compareArray([result instanceof BufferBase, result instanceof BufferMiddle, result instanceof BufferLeaf, result instanceof BufferSibling, result instanceof ArrayBuffer, result instanceof Object], [false, false, false, false, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, ArrayBuffer.prototype); assert.sameValue(ArrayBuffer.isView(result), false); assert.sameValue(result === source, false); assert.sameValue(typeof result, "object");
  assert.sameValue(result.byteLength, length); assert.sameValue(result.maxByteLength, length); assert.sameValue(result.resizable, false); assert.sameValue(result.detached, false); assert.compareArray(Reflect.ownKeys(result), []);
  const output = new Uint8Array(result); for (let i = 0; i < length; i++) { assert.sameValue(output[i], i < 4 ? input[i] : 0); assert.sameValue(typeof output[i], "number"); }
  assert.compareArray([source instanceof BufferBase, source instanceof BufferMiddle, source instanceof BufferLeaf, source instanceof BufferSibling, source instanceof ArrayBuffer], [Ctor !== ArrayBuffer, Ctor === BufferMiddle || Ctor === BufferLeaf, Ctor === BufferLeaf, Ctor === BufferSibling, true]);
  const sourcePrototype: unknown = Object.getPrototypeOf(source); assert.sameValue(sourcePrototype, Ctor.prototype); assert.sameValue(source.detached, true); assert.sameValue(source.byteLength, 0); assert.sameValue(source.maxByteLength, 0); assert.sameValue(source.resizable, growable);
  if (source instanceof BufferBase) assert.sameValue(source.marker, 7); if (source instanceof BufferLeaf) assert.sameValue(source.extra, 11);
  const keys: string[] = Ctor === ArrayBuffer ? [] : Ctor === BufferLeaf ? ["marker", "extra"] : ["marker"]; if (own) keys.push("constructor"); assert.compareArray(Reflect.ownKeys(source), keys);
  assert.sameValue(bytes.buffer, source); assert.sameValue(bytes.length, 0); assert.sameValue(bytes.byteLength, 0); assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes[0], undefined);
  assert.throws(TypeError, () => new Uint8Array(source)); assert.throws(TypeError, () => run({ buffer: source }, requested)); assert.compareArray(log, []);
}
