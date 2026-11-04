/*---
description: "TextEncoder.encodeInto leaves three-byte destinations untouched for astral characters and reads two units on a four-byte fit."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-class, ts-class-fields, ts-static, ts-tuples, ts-iteration]
---*/
// TextEncoder.encodeInto leaves three-byte destinations untouched for astral characters and reads two units on a four-byte fit. Route: a static destination field.
// Node prints: text-encoder-into-four-byte-static-field:ok
const encoder: TextEncoder = new TextEncoder();
class Destination {
  static view: Uint8Array = Uint8Array.of();
  static write(input: string): TextEncoderEncodeIntoResult { return encoder.encodeInto(input, Destination.view); }
}
const rows: [string, number, number, number, number[]][] = [
  ["\uD800\uDC00", 3, 0, 0, [172, 172, 172]], ["\uD800\uDC00", 4, 2, 4, [240, 144, 128, 128]],
  ["\uD83D\uDE00", 3, 0, 0, [172, 172, 172]], ["\uD83D\uDE00", 4, 2, 4, [240, 159, 152, 128]],
  ["\uDBFF\uDFFF", 3, 0, 0, [172, 172, 172]], ["\uDBFF\uDFFF", 4, 2, 4, [244, 143, 191, 191]],
];
for (const [input, capacity, read, written, expected] of rows) {
  Destination.view = new Uint8Array(capacity).fill(172);
  const result = Destination.write(input);
  assert.sameValue(result.read, read); assert.sameValue(result.written, written);
  assert.compareArray(Array.from(Destination.view), expected);
  assert.sameValue(Destination.view.byteOffset, 0); assert.sameValue(Destination.view.buffer.byteLength, capacity);
}
console.log("text-encoder-into-four-byte-static-field:ok");
