/*---
description: "Control: TextEncoder.encodeInto preserves pair boundaries after both ordinary prefixes and a lone-surrogate replacement."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-function-types, ts-arrow-functions, ts-closures, ts-class, ts-class-fields, ts-this, ts-tuples, ts-iteration]
---*/
// TextEncoder.encodeInto preserves pair boundaries after both ordinary prefixes and a lone-surrogate replacement. Route: a typed function field retaining the encoder receiver.
// Node prints: text-encoder-into-pair-boundary-function-field:ok
const literalWrites: readonly { read: number; written: number; bytes: readonly number[] }[] = [{"read": 2, "written": 4, "bytes": [240, 159, 152, 128]}, {"read": 3, "written": 5, "bytes": [240, 159, 152, 128, 65]}, {"read": 1, "written": 3, "bytes": [239, 191, 189]}, {"read": 3, "written": 7, "bytes": [239, 191, 189, 240, 144, 128, 128]}, {"read": 1, "written": 1, "bytes": [65]}, {"read": 3, "written": 5, "bytes": [65, 240, 159, 152, 128]}];
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
class Conversion {
  write: (input: string, output: Uint8Array) => TextEncoderEncodeIntoResult;
  constructor(encoder: TextEncoder) { this.write = (input, output) => encoder.encodeInto(input, output); }
}
const conversion: Conversion = new Conversion(new LiteralEncoder());
const rows: [string, number, number, number, number[]][] = [
  ["\uD83D\uDE00A", 4, 2, 4, [240, 159, 152, 128]], ["\uD83D\uDE00A", 5, 3, 5, [240, 159, 152, 128, 65]],
  ["\uD800\uD800\uDC00", 6, 1, 3, [239, 191, 189, 176, 176, 176]], ["\uD800\uD800\uDC00", 7, 3, 7, [239, 191, 189, 240, 144, 128, 128]],
  ["A\uD83D\uDE00", 4, 1, 1, [65, 176, 176, 176]], ["A\uD83D\uDE00", 5, 3, 5, [65, 240, 159, 152, 128]],
];
for (const [input, capacity, read, written, expected] of rows) {
  const output = new Uint8Array(capacity).fill(176), result = conversion.write(input, output);
  assert.sameValue(result.read, read); assert.sameValue(result.written, written);
  assert.compareArray(Array.from(output), expected);
}
console.log("text-encoder-into-pair-boundary-function-field:ok");
