/*---
description: "Control: TextEncoder.encode preserves mixed one-, two-, three- and four-byte characters through one shared encoder."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-class, ts-class-fields, ts-private-fields, ts-this, ts-tuples, ts-iteration]
---*/
// TextEncoder.encode preserves mixed one-, two-, three- and four-byte characters through one shared encoder. Route: a private encoder field reached through two methods.
// Node prints: text-encoder-widths-private-field:ok
const literalBytes: readonly (readonly number[])[] = [[65], [65], [195, 169], [195, 169], [226, 130, 172], [226, 130, 172], [240, 159, 152, 128], [240, 159, 152, 128], [65, 195, 169, 226, 130, 172, 240, 159, 152, 128], [65, 195, 169, 226, 130, 172, 240, 159, 152, 128]];
let literalIndex: number = 0;
class LiteralEncoder {
  readonly encoding: string = "utf-8";
  encode(input?: string): Uint8Array<ArrayBuffer> { return Uint8Array.of(...literalBytes[literalIndex++]); }
  encodeInto(input: string, output: Uint8Array): TextEncoderEncodeIntoResult { return { read: 0, written: 0 }; }
}
class EncoderHolder {
  #encoder: TextEncoder = new LiteralEncoder();
  first(input: string): Uint8Array<ArrayBuffer> { return this.#encoder.encode(input); }
  second(input: string): Uint8Array<ArrayBuffer> { return this.#encoder.encode(input); }
}
const holder: EncoderHolder = new EncoderHolder();
const rows: [string, number[]][] = [["A", [65]], ["\u00E9", [195, 169]], ["\u20AC", [226, 130, 172]], ["\uD83D\uDE00", [240, 159, 152, 128]], ["A\u00E9\u20AC\uD83D\uDE00", [65, 195, 169, 226, 130, 172, 240, 159, 152, 128]]];
for (const [input, expected] of rows) {
  const first = holder.first(input), second = holder.second(input);
  assert.compareArray(Array.from(first), expected); assert.compareArray(Array.from(second), expected);
  assert.sameValue(first === second, false); assert.sameValue(first.buffer === second.buffer, false);
  assert.sameValue(first.byteOffset, 0); assert.sameValue(second.byteOffset, 0);
  assert.sameValue(first.buffer.byteLength, expected.length); assert.sameValue(second.buffer.byteLength, expected.length);
}
console.log("text-encoder-widths-private-field:ok");
