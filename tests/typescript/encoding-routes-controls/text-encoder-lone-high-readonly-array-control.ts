/*---
description: "Control: TextEncoder.encode replaces lone high surrogates at the beginning, middle and end without dropping adjacent ASCII."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-readonly, ts-iteration]
---*/
// TextEncoder.encode replaces lone high surrogates at the beginning, middle and end without dropping adjacent ASCII. Route: a readonly array of input strings.
// Node prints: text-encoder-lone-high-readonly-array:ok
const literalBytes: readonly (readonly number[])[] = [[239, 191, 189, 65, 66], [65, 239, 191, 189, 66], [65, 66, 239, 191, 189], [239, 191, 189]];
let literalIndex: number = 0;
class LiteralEncoder {
  readonly encoding: string = "utf-8";
  encode(input?: string): Uint8Array<ArrayBuffer> { return Uint8Array.of(...literalBytes[literalIndex++]); }
  encodeInto(input: string, output: Uint8Array): TextEncoderEncodeIntoResult { return { read: 0, written: 0 }; }
}
const encoder: TextEncoder = new LiteralEncoder();
const inputs: readonly string[] = ["\uD800AB", "A\uDBFFB", "AB\uD800", "\uDBFF"];
const expected: readonly number[][] = [[239, 191, 189, 65, 66], [65, 239, 191, 189, 66], [65, 66, 239, 191, 189], [239, 191, 189]];
for (let index = 0; index < inputs.length; index++) {
  const bytes = encoder.encode(inputs[index]);
  assert.compareArray(Array.from(bytes), expected[index]);
  assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.buffer.byteLength, expected[index].length);
}
console.log("text-encoder-lone-high-readonly-array:ok");
