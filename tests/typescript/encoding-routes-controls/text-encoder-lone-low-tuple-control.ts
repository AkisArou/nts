/*---
description: "Control: TextEncoder.encode replaces lone low surrogates at every position and replaces each half of a reversed pair."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-tuples, ts-iteration]
---*/
// TextEncoder.encode replaces lone low surrogates at every position and replaces each half of a reversed pair. Route: a fixed tuple of input strings.
// Node prints: text-encoder-lone-low-tuple:ok
const literalBytes: readonly (readonly number[])[] = [[239, 191, 189, 65, 66], [65, 239, 191, 189, 66], [65, 66, 239, 191, 189], [239, 191, 189, 239, 191, 189]];
let literalIndex: number = 0;
class LiteralEncoder {
  readonly encoding: string = "utf-8";
  encode(input?: string): Uint8Array<ArrayBuffer> { return Uint8Array.of(...literalBytes[literalIndex++]); }
  encodeInto(input: string, output: Uint8Array): TextEncoderEncodeIntoResult { return { read: 0, written: 0 }; }
}
const encoder: TextEncoder = new LiteralEncoder();
const inputs: [string, string, string, string] = ["\uDC00AB", "A\uDFFFB", "AB\uDC00", "\uDC00\uD800"];
const expected: number[][] = [[239, 191, 189, 65, 66], [65, 239, 191, 189, 66], [65, 66, 239, 191, 189], [239, 191, 189, 239, 191, 189]];
for (let index = 0; index < inputs.length; index++) {
  const bytes = encoder.encode(inputs[index]);
  assert.compareArray(Array.from(bytes), expected[index]);
  assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.buffer.byteLength, expected[index].length);
}
console.log("text-encoder-lone-low-tuple:ok");
