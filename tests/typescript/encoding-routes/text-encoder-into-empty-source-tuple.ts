/*---
description: "TextEncoder.encodeInto leaves empty and nonempty destinations untouched for empty input and remains usable afterward."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-tuples, ts-iteration]
---*/
// TextEncoder.encodeInto leaves empty and nonempty destinations untouched for empty input and remains usable afterward. Route: a fixed tuple of offset destination views.
// Node prints: text-encoder-into-empty-source-tuple:ok
const encoder: TextEncoder = new TextEncoder(), backingBytes = Uint8Array.of(0, 127, 128, 255, 64, 200);
const outputs: [Uint8Array, Uint8Array, Uint8Array] = [backingBytes.subarray(0, 0), backingBytes.subarray(1, 4), backingBytes.subarray(4, 6)];
const offsets: number[] = [], sizes: number[] = [];
for (const output of outputs) {
  const result = encoder.encodeInto("", output);
  assert.sameValue(result.read, 0); assert.sameValue(result.written, 0);
  assert.compareArray(Array.from(backingBytes), [0, 127, 128, 255, 64, 200]);
  assert.sameValue(output.buffer, backingBytes.buffer); offsets.push(output.byteOffset); sizes.push(output.byteLength);
}
assert.compareArray(offsets, [0, 1, 4]); assert.compareArray(sizes, [0, 3, 2]);
const later = encoder.encodeInto("Z", outputs[2]);
assert.sameValue(later.read, 1); assert.sameValue(later.written, 1);
assert.compareArray(Array.from(outputs[2]), [90, 200]); assert.compareArray(Array.from(backingBytes), [0, 127, 128, 255, 90, 200]);
console.log("text-encoder-into-empty-source-tuple:ok");
