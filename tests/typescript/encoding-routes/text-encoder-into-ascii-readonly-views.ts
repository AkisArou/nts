/*---
description: "TextEncoder.encodeInto handles zero capacity, exact one-byte fits and an untouched trailing byte for ASCII and NUL."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-readonly, ts-tuples, ts-iteration]
---*/
// TextEncoder.encodeInto handles zero capacity, exact one-byte fits and an untouched trailing byte for ASCII and NUL. Route: a readonly array of destination views.
// Node prints: text-encoder-into-ascii-readonly-views:ok
const encoder: TextEncoder = new TextEncoder();
const outputs: readonly Uint8Array[] = [Uint8Array.of(), Uint8Array.of(99), Uint8Array.of(99, 99)];
const rows: [string, number[][]][] = [["A", [[], [65], [65, 99]]], ["\u0000", [[], [0], [0, 99]]], ["Z", [[], [90], [90, 99]]]];
for (const [input, expected] of rows) {
  for (let index = 0; index < outputs.length; index++) {
    const output = outputs[index]; output.fill(99);
    const result = encoder.encodeInto(input, output);
    assert.sameValue(result.read, index === 0 ? 0 : 1); assert.sameValue(result.written, index === 0 ? 0 : 1);
    assert.compareArray(Array.from(output), expected[index]);
    assert.sameValue(output.byteOffset, 0); assert.sameValue(output.buffer.byteLength, index);
  }
}
console.log("text-encoder-into-ascii-readonly-views:ok");
