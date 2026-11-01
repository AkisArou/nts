/*---
description: A memoized manual copy checks this route. Transfer through an interface parameter detaches the original buffer while preserving aliases and a cycle in the copy.
features: [ts-structuredclone-route-buffers, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-objects, ts-unknown, ts-interfaces, ts-map-set, ts-unions, ts-type-aliases, ts-instanceof, ts-overloads]
---*/
// A cyclic interface carries a buffer and repeated view through transfer; node detaches only the original backing store.
interface Packet { buffer: ArrayBuffer; view: Uint8Array<ArrayBuffer>; again: Uint8Array<ArrayBuffer>; mark: number; self?: Packet; }
type CopyNode = Packet | Uint8Array<ArrayBuffer> | ArrayBuffer;
function copyValue(value: Packet, memory?: Map<object, CopyNode>): Packet;
function copyValue(value: Uint8Array<ArrayBuffer>, memory?: Map<object, CopyNode>): Uint8Array<ArrayBuffer>;
function copyValue(value: ArrayBuffer, memory?: Map<object, CopyNode>): ArrayBuffer;
function copyValue(value: CopyNode, memory = new Map<object, CopyNode>()): CopyNode {
  const known = memory.get(value); if (known !== undefined) return known;
  if (value instanceof ArrayBuffer) {
    const result = new ArrayBuffer(value.byteLength); memory.set(value, result); const bytes = new Uint8Array(value), target = new Uint8Array(result);
    for (let i = 0; i < bytes.length; i++) target[i] = bytes[i]; return result;
  }
  if (value instanceof Uint8Array) { const result = new Uint8Array(copyValue(value.buffer, memory), value.byteOffset, value.length); memory.set(value, result); return result; }
  const result: Packet = { buffer: new ArrayBuffer(0), view: new Uint8Array(0), again: new Uint8Array(0), mark: value.mark }; memory.set(value, result);
  result.buffer = copyValue(value.buffer, memory); result.view = copyValue(value.view, memory); result.again = copyValue(value.again, memory);
  if (value.self !== undefined) result.self = copyValue(value.self, memory); return result;
}
function transferPacket(value: Packet): Packet { const result = copyValue(value); value.buffer.transfer(0); return result; }
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
