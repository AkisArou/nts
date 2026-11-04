/*---
description: "Control: TextEncoder.encode consumes each lone surrogate once and preserves the valid pair immediately after it."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-function-types, ts-arrow-functions, ts-closures]
---*/
// TextEncoder.encode consumes each lone surrogate once and preserves the valid pair immediately after it. Route: a mutable string binding captured by a typed closure.
// Node prints: text-encoder-surrogate-replacement-captured-let:ok
const literalBytes: readonly (readonly number[])[] = [[239, 191, 189, 240, 144, 128, 128], [239, 191, 189, 240, 144, 128, 128], [239, 191, 189, 240, 144, 128, 128, 239, 191, 189]];
let literalIndex: number = 0;
class LiteralEncoder {
  readonly encoding: string = "utf-8";
  encode(input?: string): Uint8Array<ArrayBuffer> { return Uint8Array.of(...literalBytes[literalIndex++]); }
  encodeInto(input: string, output: Uint8Array): TextEncoderEncodeIntoResult { return { read: 0, written: 0 }; }
}
const encoder: TextEncoder = new LiteralEncoder();
let input: string = "\uD800\uD800\uDC00";
const run: () => Uint8Array<ArrayBuffer> = () => encoder.encode(input);
const first = run();
input = "\uDC00\uD800\uDC00"; const second = run();
input = "\uD800\uD800\uDC00\uDFFF"; const third = run();
assert.compareArray(Array.from(first), [239, 191, 189, 240, 144, 128, 128]);
assert.compareArray(Array.from(second), [239, 191, 189, 240, 144, 128, 128]);
assert.compareArray(Array.from(third), [239, 191, 189, 240, 144, 128, 128, 239, 191, 189]);
assert.sameValue(first === second, false); assert.sameValue(first.buffer === second.buffer, false);
assert.sameValue(first.buffer.byteLength, 7); assert.sameValue(third.buffer.byteLength, 10);
assert.sameValue(input.length, 4); assert.sameValue(input.charCodeAt(0), 55296); assert.sameValue(input.charCodeAt(3), 57343);
console.log("text-encoder-surrogate-replacement-captured-let:ok");
