/*---
description: A memoized manual copy checks this route. ArrayBuffer values through a declared parameter retain every byte in fresh storage.
features: [ts-structuredclone-route-buffers, ts-arrays, ts-numbers, ts-iteration, ts-functions, ts-objects, ts-unknown, ts-map-set, ts-unions, ts-typeof-operator, ts-overloads]
---*/
// ArrayBuffer crosses a typed parameter; node copies empty and populated byte sequences into independent storage.
function copyValue(value: ArrayBuffer, memory?: Map<ArrayBuffer, ArrayBuffer>): ArrayBuffer;
function copyValue(value: number, memory: Map<ArrayBuffer, ArrayBuffer>): number;
function copyValue(value: ArrayBuffer | number, memory = new Map<ArrayBuffer, ArrayBuffer>()): ArrayBuffer | number {
  if (typeof value === "number") return value;
  const known = memory.get(value); if (known !== undefined) return known;
  const result = new ArrayBuffer(value.byteLength); memory.set(value, result);
  const bytes = new Uint8Array(value), target = new Uint8Array(result);
  for (let i = 0; i < bytes.length; i++) target[i] = copyValue(bytes[i], memory); return result;
}
function sameClone(actual: unknown, expected: unknown): void { assert.sameValue(Object.is(actual, expected), true); }
function duplicate(value: ArrayBuffer): ArrayBuffer { return copyValue(value); }
const inputs: number[][] = [[], [0], [0, 1, 127, 128, 255], [255, 0, 255, 0]];
for (const sample of inputs) {
  const source = new ArrayBuffer(sample.length), bytes = new Uint8Array(source); bytes.set(sample);
  const result = duplicate(source), copied = new Uint8Array(result);
  sameClone(result === source, false); sameClone(Object.getPrototypeOf(result), ArrayBuffer.prototype);
  assert.compareArray(Object.getOwnPropertyNames(result), []); sameClone(result.byteLength, sample.length);
  assert.compareArray(Array.from(copied), sample); assert.compareArray(Array.from(bytes), sample);
  for (let i = 0; i < sample.length; i++) sameClone(copied[i], sample[i]);
  if (sample.length > 0) { copied[0] = 77; sameClone(bytes[0], sample[0]); bytes[0] = 99; sameClone(copied[0], 77); }
}
