/*---
description: ArrayBuffer slice checks source attachment both before and after species construction.
features: [ts-species-routes, ts-species-route-regexp-buffers, ts-class, ts-inheritance, ts-builtin-subclass, ts-functions, ts-arrays, ts-iteration, ts-objects, ts-unknown, ts-instanceof, ts-new-target, ts-numbers, ts-typeof-operator, ts-interfaces, ts-class-fields, ts-symbols, ts-accessors, ts-errors, ts-arrow-functions, ts-narrowing]
---*/
// slice crosses an interface ArrayBuffer field; node rejects sources detached before entry or during constructor lookup, species lookup or result construction.
const log: unknown[] = [], made: ArrayBuffer[] = [], copies: ArrayBuffer[] = []; let phase = "", active = new ArrayBuffer(0);
function detach(): void { const copy: unknown = structuredClone(active, { transfer: [active] }); if (!(copy instanceof ArrayBuffer)) throw new TypeError(); copies.push(copy); log.push("detach", phase, active); }
class Source extends ArrayBuffer { marker: number = 5; constructor(length: number) { super(length); log.push("source", new.target, arguments.length, length); } }
class Child extends Source {}
class Output extends ArrayBuffer {
  marker: number = 17;
  constructor(length: number) { super(length); log.push("output", new.target, arguments.length, length); made.push(this); const bytes = new Uint8Array(this); for (let i = 0; i < length; i++) { bytes[i] = 91; log.push("seed", i, bytes[i]); } if (phase === "construct") detach(); }
}
class OutputChild extends Output {}
const holder = { get [Symbol.species]() { log.push("species", this); if (phase === "species") detach(); return OutputChild; } };
interface Slot { buffer: ArrayBuffer; }
function run(slot: Slot): ArrayBuffer { return slot.buffer.slice(1, 4); }
for (const current of ["none", "before", "constructor", "species", "construct"]) {
  phase = current; log.length = 0; made.length = 0; copies.length = 0; const source = new Child(5), input = [3, 17, 128, 255, 7], bytes = new Uint8Array(source); active = source;
  for (let i = 0; i < 5; i++) bytes[i] = input[i]; assert.compareArray(log, ["source", Child, 1, 5]); log.length = 0;
  Object.defineProperty(source, "constructor", { get() { log.push("constructor", this); if (phase === "constructor") detach(); return holder; } });
  if (phase === "before") detach(); const before: unknown[] = []; if (phase === "before") before.push("detach", phase, source); assert.compareArray(log, before); log.length = 0;
  const slot: Slot = { buffer: source }; if (phase === "none") assert.sameValue(run(slot), made[0]); else assert.throws(TypeError, () => run(slot));
  const expectedLog: unknown[] = []; if (phase !== "before") { expectedLog.push("constructor", source); if (phase === "constructor") expectedLog.push("detach", phase, source); expectedLog.push("species", holder); if (phase === "species") expectedLog.push("detach", phase, source); expectedLog.push("output", OutputChild, 1, 3, "seed", 0, 91, "seed", 1, 91, "seed", 2, 91); if (phase === "construct") expectedLog.push("detach", phase, source); } assert.compareArray(log, expectedLog);
  assert.sameValue(made.length, phase === "before" ? 0 : 1); for (const result of made) {
    assert.compareArray([result instanceof Source, result instanceof Child, result instanceof Output, result instanceof OutputChild, result instanceof ArrayBuffer], [false, false, true, true, true]); const prototype: unknown = Object.getPrototypeOf(result); assert.sameValue(prototype, OutputChild.prototype); assert.sameValue(ArrayBuffer.isView(result), false);
    assert.sameValue(result.byteLength, 3); assert.sameValue(result.detached, false); assert.sameValue(result === source, false); if (result instanceof Output) assert.sameValue(result.marker, 17); assert.compareArray(Reflect.ownKeys(result), ["marker"]);
    const output = new Uint8Array(result); for (let i = 0; i < 3; i++) { assert.sameValue(output[i], phase === "none" ? input[i + 1] : 91); assert.sameValue(typeof output[i], "number"); }
  }
  assert.sameValue(source.detached, phase !== "none"); assert.sameValue(source.byteLength, phase === "none" ? 5 : 0); assert.sameValue(source.marker, 5); assert.compareArray(Reflect.ownKeys(source), ["marker", "constructor"]);
  assert.sameValue(copies.length, phase === "none" ? 0 : 1); const saved = phase === "none" ? bytes : new Uint8Array(copies[0]); for (let i = 0; i < 5; i++) assert.sameValue(saved[i], input[i]);
}
