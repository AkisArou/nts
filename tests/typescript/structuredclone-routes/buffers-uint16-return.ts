/*---
description: Uint16Array clones through a typed return with its offset, complete backing bytes and independent storage.
features: [ts-structuredclone-route-buffers, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-objects, ts-unknown]
---*/
// Uint16Array crosses a return; node keeps the exact view and backing bytes in fresh, independent storage.
function sameClone(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function returned(value: Uint16Array<ArrayBuffer>): Uint16Array<ArrayBuffer> { return value; }
const inputs: number[][] = [[], [0], [0, 1, 32768, 65535], [65535, 0, 32768, 65535]];
for (const sample of inputs) {
  const whole = new Uint16Array(sample.length + 2); whole[0] = 11; whole[whole.length - 1] = 22; whole.set(sample, 1);
  const source: Uint16Array<ArrayBuffer> = whole.subarray(1, sample.length + 1), bytes = Array.from(new Uint8Array(whole.buffer));
  const result = structuredClone(returned(source));
  sameClone(result === source, false);
  sameClone(result.buffer === source.buffer, false); sameClone(Object.getPrototypeOf(result), Uint16Array.prototype);
  sameClone(Object.getPrototypeOf(result.buffer), ArrayBuffer.prototype); assert.compareArray(Object.getOwnPropertyNames(result.buffer), []);
  sameClone(result.length, sample.length); sameClone(result.byteOffset, Uint16Array.BYTES_PER_ELEMENT);
  sameClone(result.byteLength, sample.length * Uint16Array.BYTES_PER_ELEMENT); sameClone(result.buffer.byteLength, source.buffer.byteLength);
  assert.compareArray(Object.getOwnPropertyNames(result), sample.map((_, i) => String(i))); assert.compareArray(Array.from(result), sample);
  for (let i = 0; i < sample.length; i++) sameClone(result[i], sample[i]);
  const copiedBytes = new Uint8Array(result.buffer), originalBytes = new Uint8Array(source.buffer);
  assert.compareArray(Array.from(copiedBytes), bytes); assert.compareArray(Array.from(originalBytes), bytes);
  for (let i = 0; i < bytes.length; i++) sameClone(copiedBytes[i], bytes[i]);
  copiedBytes[0] = 77; sameClone(originalBytes[0], bytes[0]); originalBytes[0] = 99; sameClone(copiedBytes[0], 77);
  if (sample.length > 0) { result[0] = 42; sameClone(source[0], sample[0]); source[0] = 17; sameClone(result[0], 42); }
}
