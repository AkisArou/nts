/*---
description: A memoized manual copy checks this route. Float64Array clones through a typed readonly field with its offset, complete backing bytes and independent storage.
features: [ts-structuredclone-route-buffers, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-objects, ts-unknown, ts-interfaces, ts-readonly, ts-map-set, ts-unions, ts-type-aliases, ts-instanceof, ts-overloads]
---*/
// Float64Array crosses a readonly field; node keeps the exact view and backing bytes in fresh, independent storage.
type CopyNode = Float64Array<ArrayBuffer> | ArrayBuffer;
function copyValue(value: Float64Array<ArrayBuffer>, memory?: Map<object, CopyNode>): Float64Array<ArrayBuffer>;
function copyValue(value: ArrayBuffer, memory?: Map<object, CopyNode>): ArrayBuffer;
function copyValue(value: CopyNode, memory = new Map<object, CopyNode>()): CopyNode {
  const known = memory.get(value); if (known !== undefined) return known;
  if (value instanceof ArrayBuffer) {
    const result = new ArrayBuffer(value.byteLength); memory.set(value, result);
    const bytes = new Uint8Array(value), target = new Uint8Array(result);
    for (let i = 0; i < bytes.length; i++) target[i] = bytes[i]; return result;
  }
  const result = new Float64Array(copyValue(value.buffer, memory), value.byteOffset, value.length);
  memory.set(value, result); return result;
}
function sameClone(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
interface ViewHolder { readonly view: Float64Array<ArrayBuffer>; }
const inputs: number[][] = [[], [-0], [-Infinity, -1.5, -0, 0, 1.5, Infinity, NaN], [NaN, -0, NaN, 0]];
for (const sample of inputs) {
  const whole = new Float64Array(sample.length + 2); whole[0] = 11; whole[whole.length - 1] = 22; whole.set(sample, 1);
  const source: Float64Array<ArrayBuffer> = whole.subarray(1, sample.length + 1), bytes = Array.from(new Uint8Array(whole.buffer));
  const holder: ViewHolder = { view: source };
  const result = copyValue(holder.view);
  sameClone(result === source, false);
  sameClone(result.buffer === source.buffer, false); sameClone(Object.getPrototypeOf(result), Float64Array.prototype);
  sameClone(Object.getPrototypeOf(result.buffer), ArrayBuffer.prototype); assert.compareArray(Object.getOwnPropertyNames(result.buffer), []);
  sameClone(result.length, sample.length); sameClone(result.byteOffset, Float64Array.BYTES_PER_ELEMENT);
  sameClone(result.byteLength, sample.length * Float64Array.BYTES_PER_ELEMENT); sameClone(result.buffer.byteLength, source.buffer.byteLength);
  assert.compareArray(Object.getOwnPropertyNames(result), sample.map((_, i) => String(i))); assert.compareArray(Array.from(result), sample);
  for (let i = 0; i < sample.length; i++) sameClone(result[i], sample[i]);
  const copiedBytes = new Uint8Array(result.buffer), originalBytes = new Uint8Array(source.buffer);
  assert.compareArray(Array.from(copiedBytes), bytes); assert.compareArray(Array.from(originalBytes), bytes);
  for (let i = 0; i < bytes.length; i++) sameClone(copiedBytes[i], bytes[i]);
  copiedBytes[0] = 77; sameClone(originalBytes[0], bytes[0]); originalBytes[0] = 99; sameClone(copiedBytes[0], 77);
  if (sample.length > 0) { result[0] = 42; sameClone(source[0], sample[0]); source[0] = 17; sameClone(result[0], 42); }
}
