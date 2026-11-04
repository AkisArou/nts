/*---
description: "Control: TextEncoder.encodeInto writes complete two-byte characters at exact capacity and preserves one-byte-short destinations."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-class, ts-class-fields, ts-this, ts-tuples, ts-iteration]
---*/
// TextEncoder.encodeInto writes complete two-byte characters at exact capacity and preserves one-byte-short destinations. Route: a public destination field.
// Node prints: text-encoder-into-two-byte-class-field:ok
const literalWrites: readonly { read: number; written: number; bytes: readonly number[] }[] = [{"read": 0, "written": 0, "bytes": []}, {"read": 1, "written": 2, "bytes": [194, 128]}, {"read": 0, "written": 0, "bytes": []}, {"read": 1, "written": 2, "bytes": [195, 169]}, {"read": 0, "written": 0, "bytes": []}, {"read": 1, "written": 2, "bytes": [223, 191]}];
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
class Destination {
  view: Uint8Array;
  constructor(capacity: number) { this.view = new Uint8Array(capacity).fill(170); }
}
const encoder: TextEncoder = new LiteralEncoder();
const rows: [string, number, number, number, number[]][] = [
  ["\u0080", 1, 0, 0, [170]], ["\u0080", 2, 1, 2, [194, 128]], ["\u00E9", 1, 0, 0, [170]],
  ["\u00E9", 2, 1, 2, [195, 169]], ["\u07FF", 1, 0, 0, [170]], ["\u07FF", 2, 1, 2, [223, 191]],
];
for (const [input, capacity, read, written, expected] of rows) {
  const destination: Destination = new Destination(capacity);
  const result = encoder.encodeInto(input, destination.view);
  assert.sameValue(result.read, read); assert.sameValue(result.written, written);
  assert.compareArray(Array.from(destination.view), expected);
  assert.sameValue(destination.view.byteOffset, 0); assert.sameValue(destination.view.buffer.byteLength, capacity);
}
console.log("text-encoder-into-two-byte-class-field:ok");
