/*---
description: Logged ArrayBuffer species choices select intrinsic and sibling buffers through an interface.
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-numbers, ts-typeof-operator, ts-interfaces, ts-tuples, ts-construct-signatures, ts-class-fields, ts-symbols, ts-accessors, ts-null-undefined, ts-narrowing]
---*/
// slice crosses an interface ArrayBuffer field; node honors ArrayBuffer, sibling, further-sibling and nullish species choices with exact constructor histories.
const log: unknown[] = []; let selected: unknown;
class Source extends ArrayBuffer { marker: number = 5; constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class SourceChild extends Source {}
class Output extends ArrayBuffer { marker: number = 13; constructor(length: number) { super(length); log.push("output", new.target, arguments.length, length); } }
class OutputChild extends Output { extra: number = 19; }
Object.defineProperty(Source, Symbol.species, { get() { log.push("species", this, selected); return selected; } });
interface Holder { buffer: ArrayBuffer; }
function run(holder: Holder): ArrayBuffer { return holder.buffer.slice(1, 4); }
const choices: [unknown, new (length: number) => ArrayBuffer][] = [[ArrayBuffer, ArrayBuffer], [Output, Output], [OutputChild, OutputChild], [undefined, ArrayBuffer], [null, ArrayBuffer]];
for (const Ctor of [Source, SourceChild]) for (const [choice, Target] of choices) {
  selected = choice; log.length = 0; const source = new Ctor(5), input = [3, 128, 255, 17, 9], bytes = new Uint8Array(source); for (let i = 0; i < 5; i++) bytes[i] = input[i];
  assert.compareArray(log, ["source", Ctor, 1, 5]); log.length = 0; const holder: Holder = { buffer: source }, result = run(holder);
  const expectedLog: unknown[] = ["species", Ctor, choice]; if (Target !== ArrayBuffer) expectedLog.push("output", Target, 1, 3); assert.compareArray(log, expectedLog);
  assert.compareArray([result instanceof Source, result instanceof SourceChild, result instanceof Output, result instanceof OutputChild, result instanceof ArrayBuffer, result instanceof Object], [false, false, Target !== ArrayBuffer, Target === OutputChild, true, true]);
  const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, Target.prototype); assert.sameValue(ArrayBuffer.isView(result), false); assert.sameValue(result === source, false);
  assert.sameValue(result.byteLength, 3); assert.sameValue(result.maxByteLength, 3); assert.sameValue(result.detached, false); assert.sameValue(result.resizable, false);
  const output = new Uint8Array(result); for (let i = 0; i < 3; i++) { assert.sameValue(output[i], input[i + 1]); assert.sameValue(typeof output[i], "number"); }
  if (result instanceof Output) assert.sameValue(result.marker, 13); if (result instanceof OutputChild) assert.sameValue(result.extra, 19);
  assert.compareArray(Reflect.ownKeys(result), Target === ArrayBuffer ? [] : Target === OutputChild ? ["marker", "extra"] : ["marker"]); assert.sameValue(Object.hasOwn(result, "byteLength"), false);
  output[0] = 99; for (let i = 0; i < 5; i++) assert.sameValue(bytes[i], input[i]); assert.sameValue(source.marker, 5); assert.sameValue(source.detached, false);
}
