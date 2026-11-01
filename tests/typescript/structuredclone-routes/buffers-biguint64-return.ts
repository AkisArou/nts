/*---
description: BigUint64Array clones through a typed return with its offset, complete backing bytes and independent storage.
features: [ts-structuredclone-route-buffers, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-objects, ts-unknown, ts-bigint]
---*/
// BigUint64Array crosses a return; node keeps the exact view and backing bytes in fresh, independent storage.
function sameClone(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function returned(value: BigUint64Array<ArrayBuffer>): BigUint64Array<ArrayBuffer> { return value; }
const inputs: bigint[][] = [[], [0n], [0n, 1n, 9223372036854775808n, 18446744073709551615n], [18446744073709551615n, 0n, 9223372036854775808n]];
for (const sample of inputs) {
  const whole = new BigUint64Array(sample.length + 2); whole[0] = 11n; whole[whole.length - 1] = 22n; whole.set(sample, 1);
  const source: BigUint64Array<ArrayBuffer> = whole.subarray(1, sample.length + 1), bytes = Array.from(new Uint8Array(whole.buffer));
  const result = structuredClone(returned(source));
  sameClone(result === source, false);
  sameClone(result.buffer === source.buffer, false); sameClone(Object.getPrototypeOf(result), BigUint64Array.prototype);
  sameClone(Object.getPrototypeOf(result.buffer), ArrayBuffer.prototype); assert.compareArray(Object.getOwnPropertyNames(result.buffer), []);
  sameClone(result.length, sample.length); sameClone(result.byteOffset, BigUint64Array.BYTES_PER_ELEMENT);
  sameClone(result.byteLength, sample.length * BigUint64Array.BYTES_PER_ELEMENT); sameClone(result.buffer.byteLength, source.buffer.byteLength);
  assert.compareArray(Object.getOwnPropertyNames(result), sample.map((_, i) => String(i))); assert.compareArray(Array.from(result), sample);
  for (let i = 0; i < sample.length; i++) sameClone(result[i], sample[i]);
  const copiedBytes = new Uint8Array(result.buffer), originalBytes = new Uint8Array(source.buffer);
  assert.compareArray(Array.from(copiedBytes), bytes); assert.compareArray(Array.from(originalBytes), bytes);
  for (let i = 0; i < bytes.length; i++) sameClone(copiedBytes[i], bytes[i]);
  copiedBytes[0] = 77; sameClone(originalBytes[0], bytes[0]); originalBytes[0] = 99; sameClone(copiedBytes[0], 77);
  if (sample.length > 0) { result[0] = 42n; sameClone(source[0], sample[0]); source[0] = 17n; sameClone(result[0], 42n); }
}
