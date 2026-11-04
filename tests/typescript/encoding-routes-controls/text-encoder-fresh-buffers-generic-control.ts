/*---
description: "Control: TextEncoder.encode returns fresh exact-length arrays and buffers even for repeated equal or empty inputs."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-generics, ts-generic-constraints, ts-literal-types, ts-iteration]
---*/
// TextEncoder.encode returns fresh exact-length arrays and buffers even for repeated equal or empty inputs. Route: a constrained string helper called at literal and string type arguments.
// Node prints: text-encoder-fresh-buffers-generic:ok
const literalBytes: readonly (readonly number[])[] = [[65], [65], [], [], [195, 169]];
let literalIndex: number = 0;
class LiteralEncoder {
  readonly encoding: string = "utf-8";
  encode(input?: string): Uint8Array<ArrayBuffer> { return Uint8Array.of(...literalBytes[literalIndex++]); }
  encodeInto(input: string, output: Uint8Array): TextEncoderEncodeIntoResult { return { read: 0, written: 0 }; }
}
const encoder: TextEncoder = new LiteralEncoder();
function encodeText<T extends string>(text: T): Uint8Array<ArrayBuffer> { return encoder.encode(text); }
const first = encodeText<"A">("A"), second = encodeText<string>("A");
const emptyFirst = encodeText<"">(""), emptySecond = encodeText<string>("");
const wide = encodeText<string>("\u00E9");
assert.compareArray(Array.from(first), [65]); assert.compareArray(Array.from(second), [65]);
assert.compareArray(Array.from(emptyFirst), []); assert.compareArray(Array.from(emptySecond), []);
assert.compareArray(Array.from(wide), [195, 169]);
const arrays: Uint8Array<ArrayBuffer>[] = [first, second, emptyFirst, emptySecond, wide];
for (let left = 0; left < arrays.length; left++) {
  assert.sameValue(arrays[left].byteOffset, 0); assert.sameValue(arrays[left].buffer.byteLength, arrays[left].length);
  for (let right = left + 1; right < arrays.length; right++) {
    assert.sameValue(arrays[left] === arrays[right], false); assert.sameValue(arrays[left].buffer === arrays[right].buffer, false);
  }
}
first[0] = 90;
assert.compareArray(Array.from(first), [90]); assert.compareArray(Array.from(second), [65]); assert.compareArray(Array.from(wide), [195, 169]);
console.log("text-encoder-fresh-buffers-generic:ok");
