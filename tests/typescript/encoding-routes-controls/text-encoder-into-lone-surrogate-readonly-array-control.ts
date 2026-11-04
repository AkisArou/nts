/*---
description: "Control: TextEncoder.encodeInto reads one unit for a complete surrogate replacement and leaves insufficient destination space untouched."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-readonly, ts-tuples, ts-iteration]
---*/
// TextEncoder.encodeInto reads one unit for a complete surrogate replacement and leaves insufficient destination space untouched. Route: a readonly array of surrogate input and capacity tuples.
// Node prints: text-encoder-into-lone-surrogate-readonly-array:ok
const literalWrites: readonly { read: number; written: number; bytes: readonly number[] }[] = [{"read": 0, "written": 0, "bytes": []}, {"read": 1, "written": 3, "bytes": [239, 191, 189]}, {"read": 1, "written": 3, "bytes": [239, 191, 189]}, {"read": 1, "written": 3, "bytes": [239, 191, 189]}, {"read": 1, "written": 1, "bytes": [65]}, {"read": 2, "written": 4, "bytes": [65, 239, 191, 189]}, {"read": 1, "written": 3, "bytes": [239, 191, 189]}];
let literalIndex: number = 0;
class LiteralEncoder {
  readonly encoding: string = "utf-8";
  encode(input?: string): Uint8Array<ArrayBuffer> { return Uint8Array.of(); }
  encodeInto(input: string, output: Uint8Array): TextEncoderEncodeIntoResult {
    const row = literalWrites[literalIndex++];
    for (let index = 0; index < row.bytes.length; index++) output[index] = row.bytes[index];
    return { read: row.read, written: row.written };
  }
}
const encoder: TextEncoder = new LiteralEncoder();
const rows: readonly [string, number, number, number, number[]][] = [
  ["\uD800", 2, 0, 0, [175, 175]], ["\uD800", 3, 1, 3, [239, 191, 189]], ["\uDC00", 3, 1, 3, [239, 191, 189]],
  ["\uD800A", 3, 1, 3, [239, 191, 189]], ["A\uDFFF", 3, 1, 1, [65, 175, 175]],
  ["A\uDFFF", 4, 2, 4, [65, 239, 191, 189]], ["\uD800\uD800\uDC00", 3, 1, 3, [239, 191, 189]],
];
for (const [input, capacity, read, written, expected] of rows) {
  const output = new Uint8Array(capacity).fill(175), result = encoder.encodeInto(input, output);
  assert.sameValue(result.read, read); assert.sameValue(result.written, written);
  assert.compareArray(Array.from(output), expected);
  assert.sameValue(output.byteOffset, 0); assert.sameValue(output.buffer.byteLength, capacity);
}
console.log("text-encoder-into-lone-surrogate-readonly-array:ok");
