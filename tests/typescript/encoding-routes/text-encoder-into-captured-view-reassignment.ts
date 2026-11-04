/*---
description: "TextEncoder.encodeInto uses the current captured view after reassignment while preserving a previously rejected destination."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-function-types, ts-arrow-functions, ts-closures]
---*/
// TextEncoder.encodeInto uses the current captured view after reassignment while preserving a previously rejected destination. Route: a mutable destination binding captured by a typed closure.
// Node prints: text-encoder-into-captured-view-reassignment:ok
const encoder: TextEncoder = new TextEncoder();
const initial = Uint8Array.of(7, 7, 7);
let output: Uint8Array = initial;
const write: (input: string) => TextEncoderEncodeIntoResult = (input) => encoder.encodeInto(input, output);
const rejected = write("\uD83D\uDE00");
assert.sameValue(rejected.read, 0); assert.sameValue(rejected.written, 0); assert.compareArray(Array.from(initial), [7, 7, 7]);
const backingBytes = Uint8Array.of(8, 8, 8, 8, 8, 8); output = backingBytes.subarray(1, 5);
const complete = write("\uD83D\uDE00");
assert.sameValue(complete.read, 2); assert.sameValue(complete.written, 4);
assert.compareArray(Array.from(backingBytes), [8, 240, 159, 152, 128, 8]); assert.sameValue(output.byteOffset, 1);
output = backingBytes.subarray(2, 4); const narrow = write("\u00E9");
assert.sameValue(narrow.read, 1); assert.sameValue(narrow.written, 2); assert.sameValue(output.byteOffset, 2);
assert.compareArray(Array.from(backingBytes), [8, 240, 195, 169, 128, 8]); assert.compareArray(Array.from(output), [195, 169]);
assert.compareArray(Array.from(initial), [7, 7, 7]); assert.sameValue(output.buffer, backingBytes.buffer);
console.log("text-encoder-into-captured-view-reassignment:ok");
