/*---
description: A memoized manual copy checks this route. DataView values through an interface field retain offsets, lengths and all backing bytes.
features: [ts-structuredclone-route-buffers, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-objects, ts-unknown, ts-interfaces, ts-map-set, ts-unions, ts-type-aliases, ts-instanceof, ts-overloads]
---*/
// DataView crosses an interface field; node retains its window over a complete new backing buffer.
type CopyNode = DataView<ArrayBuffer> | ArrayBuffer;
function copyValue(value: DataView<ArrayBuffer>, memory?: Map<object, CopyNode>): DataView<ArrayBuffer>;
function copyValue(value: ArrayBuffer, memory?: Map<object, CopyNode>): ArrayBuffer;
function copyValue(value: CopyNode, memory = new Map<object, CopyNode>()): CopyNode {
  const known = memory.get(value); if (known !== undefined) return known;
  if (value instanceof ArrayBuffer) {
    const result = new ArrayBuffer(value.byteLength); memory.set(value, result);
    const bytes = new Uint8Array(value), target = new Uint8Array(result);
    for (let i = 0; i < bytes.length; i++) target[i] = bytes[i]; return result;
  }
  const result = new DataView(copyValue(value.buffer, memory), value.byteOffset, value.byteLength);
  memory.set(value, result); return result;
}
function sameClone(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
interface WindowHolder { view: DataView<ArrayBuffer>; }
const inputs: number[][] = [[], [0], [0, 1, 127, 128, 255], [255, 0, 255, 0]];
for (const sample of inputs) {
  const buffer = new ArrayBuffer(sample.length + 4), original = new Uint8Array(buffer); original.fill(11); original.set(sample, 2);
  const source = new DataView(buffer, 2, sample.length), holder: WindowHolder = { view: source }, bytes = Array.from(original);
  const result = copyValue(holder.view), copied = new Uint8Array(result.buffer);
  sameClone(result === source, false); sameClone(result.buffer === buffer, false);
  sameClone(Object.getPrototypeOf(result), DataView.prototype); sameClone(Object.getPrototypeOf(result.buffer), ArrayBuffer.prototype);
  assert.compareArray(Object.getOwnPropertyNames(result), []); assert.compareArray(Object.getOwnPropertyNames(result.buffer), []);
  sameClone(result.byteOffset, 2); sameClone(result.byteLength, sample.length); sameClone(result.buffer.byteLength, bytes.length);
  assert.compareArray(Array.from(copied), bytes); assert.compareArray(Array.from(original), bytes); for (let i = 0; i < bytes.length; i++) sameClone(copied[i], bytes[i]);
  for (let i = 0; i < sample.length; i++) sameClone(result.getUint8(i), sample[i]);
  copied[0] = 77; sameClone(original[0], 11); original[0] = 99; sameClone(copied[0], 77);
  if (sample.length > 0) { result.setUint8(0, 42); sameClone(source.getUint8(0), sample[0]); source.setUint8(0, 17); sameClone(result.getUint8(0), 42); }
}
