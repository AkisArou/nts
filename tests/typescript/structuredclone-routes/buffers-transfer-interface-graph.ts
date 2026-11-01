/*---
description: Transfer through an interface parameter detaches the original buffer while preserving aliases and a cycle in the copy.
features: [ts-structuredclone-route-buffers, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-objects, ts-unknown, ts-interfaces]
---*/
// A cyclic interface carries a buffer and repeated view through transfer; node detaches only the original backing store.
interface Packet { buffer: ArrayBuffer; view: Uint8Array<ArrayBuffer>; again: Uint8Array<ArrayBuffer>; mark: number; self?: Packet; }
function transferPacket(value: Packet): Packet { return structuredClone(value, { transfer: [value.buffer] }); }
function sameClone(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const inputs: number[][] = [[], [0], [0, 1, 127, 128, 255], [255, 0, 255, 0]];
for (const sample of inputs) {
  const buffer = new ArrayBuffer(sample.length), view = new Uint8Array(buffer); view.set(sample);
  const source: Packet = { buffer, view, again: view, mark: -0 }; source.self = source;
  const result = transferPacket(source);
  assert.throws(TypeError, () => { new Uint8Array(buffer); });
  sameClone(buffer.byteLength, 0); sameClone(view.length, 0); sameClone(view.buffer, buffer); sameClone(source.self, source);
  sameClone(source.buffer, buffer); sameClone(source.view, view); sameClone(source.again, view);
  assert.compareArray(Object.getOwnPropertyNames(source), ["buffer", "view", "again", "mark", "self"]);
  sameClone(result === source, false); sameClone(result.buffer === buffer, false); sameClone(result.view === view, false);
  sameClone(result.view.buffer, result.buffer); sameClone(result.again, result.view); sameClone(result.self, result); sameClone(result.mark, -0);
  sameClone(Object.getPrototypeOf(result), Object.prototype); sameClone(Object.getPrototypeOf(result.buffer), ArrayBuffer.prototype);
  sameClone(Object.getPrototypeOf(result.view), Uint8Array.prototype); sameClone(result.buffer.byteLength, sample.length); sameClone(result.view.byteOffset, 0);
  sameClone(result.view.length, sample.length); sameClone(result.view.byteLength, sample.length);
  assert.compareArray(Object.getOwnPropertyNames(result), ["buffer", "view", "again", "mark", "self"]); assert.compareArray(Object.getOwnPropertyNames(result.buffer), []);
  assert.compareArray(Object.getOwnPropertyNames(result.view), sample.map((_, i) => String(i))); assert.compareArray(Array.from(result.view), sample);
  for (let i = 0; i < sample.length; i++) sameClone(result.view[i], sample[i]);
  result.mark = 7; sameClone(source.mark, -0); source.mark = 3; sameClone(result.mark, 7);
  if (sample.length > 0) { result.view[0] = 77; sameClone(new Uint8Array(result.buffer)[0], 77); sameClone(view.length, 0); }
}
