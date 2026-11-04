/*---
description: "TextEncoder.encodeInto writes complete three-byte characters at exact capacity and preserves two-byte destinations."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-tuples, ts-iteration]
---*/
// TextEncoder.encodeInto writes complete three-byte characters at exact capacity and preserves two-byte destinations. Route: a private destination field.
// Node prints: text-encoder-into-three-byte-private-field:ok
const encoder: TextEncoder = new TextEncoder();
class Destination {
  #view: Uint8Array;
  constructor(capacity: number) { this.#view = new Uint8Array(capacity).fill(171); }
  write(input: string): TextEncoderEncodeIntoResult { return encoder.encodeInto(input, this.#view); }
  bytes(): Uint8Array { return this.#view; }
}
const rows: [string, number, number, number, number[]][] = [
  ["\u0800", 2, 0, 0, [171, 171]], ["\u0800", 3, 1, 3, [224, 160, 128]], ["\u20AC", 2, 0, 0, [171, 171]],
  ["\u20AC", 3, 1, 3, [226, 130, 172]], ["\uFFFF", 2, 0, 0, [171, 171]], ["\uFFFF", 3, 1, 3, [239, 191, 191]],
];
for (const [input, capacity, read, written, expected] of rows) {
  const destination: Destination = new Destination(capacity), result = destination.write(input), bytes = destination.bytes();
  assert.sameValue(result.read, read); assert.sameValue(result.written, written);
  assert.compareArray(Array.from(bytes), expected);
  assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.buffer.byteLength, capacity);
}
console.log("text-encoder-into-three-byte-private-field:ok");
