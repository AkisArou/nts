/*---
description: ArrayBuffer slice rejects invalid species results before copying any source byte. The control uses explicit construction, checks and byte operations.
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-numbers, ts-typeof-operator, ts-tuples, ts-class-fields, ts-symbols, ts-accessors, ts-errors, ts-arrow-functions, ts-narrowing, ts-null-undefined]
---*/
// slice crosses an ArrayBuffer parameter; node rejects short, identical, detached, ordinary, view, shared and forged results while preserving construction effects. The control spells out the operation.
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
const log: unknown[] = [], moved: ArrayBuffer[] = []; let destination: object = {}, seedBytes: Uint8Array = new Uint8Array(0), selected = "";
class Source extends ArrayBuffer { marker: number = 7; constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class Child extends Source {}
class Returner {
  constructor(length: number) { log.push("result", new.target, arguments.length, length); for (let i = 0; i < seedBytes.length; i++) { seedBytes[i] = 91; log.push("seed", i, seedBytes[i]); } if (selected === "detached") { if (!(destination instanceof ArrayBuffer)) throw new TypeError(); const copy: unknown = structuredClone(destination, { transfer: [destination] }); if (!(copy instanceof ArrayBuffer)) throw new TypeError(); moved.push(copy); log.push("detach-result", destination); } return destination; }
}
Object.defineProperty(Source, Symbol.species, { get() { log.push("species", this); return Returner; } });
function run(source: ArrayBuffer, count: number): ArrayBuffer { return explicit(source, 1, 1 + count); }
const rows: [string, number][] = [["short", 3], ["same", 0], ["same", 3], ["detached", 0], ["detached", 3], ["object", 3], ["view", 3], ["data", 3], ["shared", 3], ["forged", 3]];
for (const [kind, count] of rows) {
  selected = kind; log.length = 0; moved.length = 0; const source = new Child(6), input = [3, 5, 7, 11, 13, 17], bytes = new Uint8Array(source); for (let i = 0; i < 6; i++) bytes[i] = input[i];
  assert.compareArray(log, ["source", Child, 1, 6]); log.length = 0; seedBytes = new Uint8Array(0);
  if (kind === "short" || kind === "detached") { const buffer = new ArrayBuffer(kind === "short" ? 2 : 3); destination = buffer; seedBytes = new Uint8Array(buffer); }
  else if (kind === "same") destination = source;
  else if (kind === "object") destination = { marker: 37 };
  else if (kind === "forged") destination = Object.create(ArrayBuffer.prototype);
  else if (kind === "shared") { const buffer = new SharedArrayBuffer(4); destination = buffer; seedBytes = new Uint8Array(buffer); }
  else { const buffer = new ArrayBuffer(4); destination = kind === "view" ? new Uint8Array(buffer) : new DataView(buffer); seedBytes = new Uint8Array(buffer); }
  const seedCount = seedBytes.length; assert.throws(TypeError, () => run(source, count));
  const expectedLog: unknown[] = ["species", Child, "result", Returner, 1, count]; for (let i = 0; i < seedCount; i++) expectedLog.push("seed", i, 91); if (kind === "detached") expectedLog.push("detach-result", destination); assert.compareArray(log, expectedLog);
  assert.compareArray([destination instanceof Source, destination instanceof Child, destination instanceof Returner, destination instanceof ArrayBuffer, destination instanceof SharedArrayBuffer, destination instanceof Uint8Array, destination instanceof DataView], [kind === "same", kind === "same", false, kind === "same" || kind === "short" || kind === "detached" || kind === "forged", kind === "shared", kind === "view", kind === "data"]);
  const prototype: unknown = Object.getPrototypeOf(destination); assert.sameValue(prototype, kind === "same" ? Child.prototype : kind === "object" ? Object.prototype : kind === "view" ? Uint8Array.prototype : kind === "data" ? DataView.prototype : kind === "shared" ? SharedArrayBuffer.prototype : ArrayBuffer.prototype);
  assert.sameValue(ArrayBuffer.isView(destination), kind === "view" || kind === "data"); assert.compareArray(Reflect.ownKeys(destination), kind === "same" || kind === "object" ? ["marker"] : kind === "view" ? ["0", "1", "2", "3"] : []);
  assert.sameValue(moved.length, kind === "detached" ? 1 : 0); for (let i = 0; i < seedBytes.length; i++) { assert.sameValue(seedBytes[i], 91); assert.sameValue(typeof seedBytes[i], "number"); }
  if (kind === "detached") { if (!(destination instanceof ArrayBuffer)) throw new TypeError(); assert.sameValue(destination.detached, true); assert.sameValue(destination.byteLength, 0); const saved = new Uint8Array(moved[0]); assert.sameValue(saved.length, 3); for (let i = 0; i < 3; i++) assert.sameValue(saved[i], 91); }
  if (kind === "short") { if (!(destination instanceof ArrayBuffer)) throw new TypeError(); assert.sameValue(destination.byteLength, 2); assert.sameValue(destination.detached, false); }
  if (kind === "object") assert.sameValue(Reflect.get(destination, "marker"), 37);
  assert.sameValue(source.byteLength, 6); assert.sameValue(source.detached, false); assert.sameValue(source.marker, 7); for (let i = 0; i < 6; i++) assert.sameValue(bytes[i], input[i]);
}
