/*---
description: "Control: TextEncoder.encode uses the exact UTF-8 bytes at every scalar-width boundary."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-class, ts-class-fields, ts-static, ts-tuples, ts-iteration]
---*/
// TextEncoder.encode uses the exact UTF-8 bytes at every scalar-width boundary. Route: a static encoder field used directly and through a static method.
// Node prints: text-encoder-scalar-boundaries-static-field:ok
const literalBytes: readonly (readonly number[])[] = [[127], [127], [194, 128], [194, 128], [223, 191], [223, 191], [224, 160, 128], [224, 160, 128], [239, 191, 191], [239, 191, 191], [240, 144, 128, 128], [240, 144, 128, 128], [244, 143, 191, 191], [244, 143, 191, 191]];
let literalIndex: number = 0;
class LiteralEncoder {
  readonly encoding: string = "utf-8";
  encode(input?: string): Uint8Array<ArrayBuffer> { return Uint8Array.of(...literalBytes[literalIndex++]); }
  encodeInto(input: string, output: Uint8Array): TextEncoderEncodeIntoResult { return { read: 0, written: 0 }; }
}
class EncoderHolder {
  static encoder: TextEncoder = new LiteralEncoder();
  static run(input: string): Uint8Array<ArrayBuffer> { return EncoderHolder.encoder.encode(input); }
}
const rows: [string, number[]][] = [
  ["\u007F", [127]], ["\u0080", [194, 128]], ["\u07FF", [223, 191]], ["\u0800", [224, 160, 128]],
  ["\uFFFF", [239, 191, 191]], ["\uD800\uDC00", [240, 144, 128, 128]], ["\uDBFF\uDFFF", [244, 143, 191, 191]],
];
for (const [input, expected] of rows) {
  const direct = EncoderHolder.encoder.encode(input), routed = EncoderHolder.run(input);
  assert.compareArray(Array.from(direct), expected); assert.compareArray(Array.from(routed), expected);
  assert.sameValue(direct.byteOffset, 0); assert.sameValue(routed.byteOffset, 0);
  assert.sameValue(direct.buffer.byteLength, expected.length); assert.sameValue(routed.buffer.byteLength, expected.length);
  assert.sameValue(direct === routed, false); assert.sameValue(direct.buffer === routed.buffer, false);
}
console.log("text-encoder-scalar-boundaries-static-field:ok");
