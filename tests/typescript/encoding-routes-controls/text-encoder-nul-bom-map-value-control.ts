/*---
description: "Control: TextEncoder.encode retains NUL and every BOM code point as ordinary UTF-8 input."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-map-set, ts-tuples, ts-iteration, ts-narrowing, ts-null-undefined]
---*/
// TextEncoder.encode retains NUL and every BOM code point as ordinary UTF-8 input. Route: encoder values safely read from a typed Map.
// Node prints: text-encoder-nul-bom-map-value:ok
const literalBytes: readonly (readonly number[])[] = [[0], [239, 187, 191], [65, 0, 66], [239, 187, 191, 65, 239, 187, 191]];
let literalIndex: number = 0;
class LiteralEncoder {
  readonly encoding: string = "utf-8";
  encode(input?: string): Uint8Array<ArrayBuffer> { return Uint8Array.of(...literalBytes[literalIndex++]); }
  encodeInto(input: string, output: Uint8Array): TextEncoderEncodeIntoResult { return { read: 0, written: 0 }; }
}
const encoders: Map<string, TextEncoder> = new Map<string, TextEncoder>();
encoders.set("first", new LiteralEncoder()); encoders.set("second", new LiteralEncoder());
const rows: [string, string, number[]][] = [
  ["first", "\u0000", [0]], ["second", "\uFEFF", [239, 187, 191]],
  ["first", "A\u0000B", [65, 0, 66]], ["second", "\uFEFFA\uFEFF", [239, 187, 191, 65, 239, 187, 191]],
];
for (const [key, input, expected] of rows) {
  const encoder = encoders.get(key);
  if (encoder === undefined) throw new Error("missing encoder");
  const bytes = encoder.encode(input);
  assert.compareArray(Array.from(bytes), expected);
  assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.buffer.byteLength, expected.length);
}
assert.sameValue(encoders.size, 2);
console.log("text-encoder-nul-bom-map-value:ok");
