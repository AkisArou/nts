/*---
description: A memoized manual copy checks this route. An interface graph keeps a repeated view, sibling backing buffer and self-cycle shared inside its independent clone.
features: [ts-structuredclone-route-buffers, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-objects, ts-unknown, ts-interfaces, ts-map-set, ts-unions, ts-type-aliases, ts-instanceof, ts-overloads]
---*/
// Uint8Array and DataView siblings cross a recursive interface; node preserves repeated views and cycles on one fresh buffer.
interface Views { first: Uint8Array<ArrayBuffer>; second: DataView<ArrayBuffer>; again: Uint8Array<ArrayBuffer>; self?: Views; }
type CopyNode = Views | Uint8Array<ArrayBuffer> | DataView<ArrayBuffer> | ArrayBuffer;
function copyValue(value: Views, memory?: Map<object, CopyNode>): Views;
function copyValue(value: Uint8Array<ArrayBuffer>, memory?: Map<object, CopyNode>): Uint8Array<ArrayBuffer>;
function copyValue(value: DataView<ArrayBuffer>, memory?: Map<object, CopyNode>): DataView<ArrayBuffer>;
function copyValue(value: ArrayBuffer, memory?: Map<object, CopyNode>): ArrayBuffer;
function copyValue(value: CopyNode, memory = new Map<object, CopyNode>()): CopyNode {
  const known = memory.get(value); if (known !== undefined) return known;
  if (value instanceof ArrayBuffer) {
    const result = new ArrayBuffer(value.byteLength); memory.set(value, result); const bytes = new Uint8Array(value), target = new Uint8Array(result);
    for (let i = 0; i < bytes.length; i++) target[i] = bytes[i]; return result;
  }
  if (value instanceof Uint8Array) { const result = new Uint8Array(copyValue(value.buffer, memory), value.byteOffset, value.length); memory.set(value, result); return result; }
  if (value instanceof DataView) { const result = new DataView(copyValue(value.buffer, memory), value.byteOffset, value.byteLength); memory.set(value, result); return result; }
  const result: Views = { first: new Uint8Array(0), second: new DataView(new ArrayBuffer(0)), again: new Uint8Array(0) }; memory.set(value, result);
  result.first = copyValue(value.first, memory); result.second = copyValue(value.second, memory); result.again = copyValue(value.again, memory);
  if (value.self !== undefined) result.self = copyValue(value.self, memory); return result;
}
function sameClone(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
const inputs: number[][] = [[], [0], [0, 1, 127, 128, 255], [255, 0, 255, 0]];
for (const sample of inputs) {
  const buffer = new ArrayBuffer(sample.length + 2), original = new Uint8Array(buffer); original.fill(11); original.set(sample, 1);
  const first = new Uint8Array(buffer, 1, sample.length), second = new DataView(buffer, 1, sample.length);
  const source: Views = { first, second, again: first }; if (sample.length > 0) source.self = source;
  const bytes = Array.from(original), result = copyValue(source), copied = new Uint8Array(result.first.buffer);
  sameClone(result === source, false); sameClone(result.first === first, false); sameClone(result.second === second, false);
  sameClone(result.first.buffer === buffer, false); sameClone(result.again, result.first); sameClone(result.second.buffer, result.first.buffer);
  sameClone(result.self, sample.length > 0 ? result : undefined);
  sameClone(Object.getPrototypeOf(result), Object.prototype); sameClone(Object.getPrototypeOf(result.first), Uint8Array.prototype);
  sameClone(Object.getPrototypeOf(result.second), DataView.prototype); sameClone(Object.getPrototypeOf(result.first.buffer), ArrayBuffer.prototype);
  assert.compareArray(Object.getOwnPropertyNames(result), sample.length > 0 ? ["first", "second", "again", "self"] : ["first", "second", "again"]);
  assert.compareArray(Object.getOwnPropertyNames(result.first), sample.map((_, i) => String(i)));
  assert.compareArray(Object.getOwnPropertyNames(result.second), []); assert.compareArray(Object.getOwnPropertyNames(result.first.buffer), []);
  sameClone(result.first.byteOffset, 1); sameClone(result.second.byteOffset, 1); sameClone(result.first.length, sample.length); sameClone(result.second.byteLength, sample.length);
  sameClone(result.first.byteLength, sample.length); sameClone(result.first.buffer.byteLength, bytes.length);
  assert.compareArray(Array.from(copied), bytes); assert.compareArray(Array.from(original), bytes); for (let i = 0; i < bytes.length; i++) sameClone(copied[i], bytes[i]);
  for (let i = 0; i < sample.length; i++) { sameClone(result.first[i], sample[i]); sameClone(result.second.getUint8(i), sample[i]); }
  copied[0] = 77; sameClone(original[0], 11); original[0] = 99; sameClone(copied[0], 77);
  if (sample.length > 0) { result.first[0] = 42; sameClone(result.second.getUint8(0), 42); sameClone(first[0], sample[0]); second.setUint8(0, 17); sameClone(result.first[0], 42); }
}
