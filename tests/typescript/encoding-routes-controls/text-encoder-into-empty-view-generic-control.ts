/*---
description: "Control: TextEncoder.encodeInto makes no progress or writes for empty views, including nonzero offsets in sentinel buffers."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-generics, ts-generic-constraints, ts-class, ts-class-fields, ts-inheritance, ts-builtin-subclass, ts-iteration]
---*/
// TextEncoder.encodeInto makes no progress or writes for empty views, including nonzero offsets in sentinel buffers. Route: a constrained destination helper called with Uint8Array and a declared subclass.
// Node prints: text-encoder-into-empty-view-generic:ok
const literalWrites: readonly { read: number; written: number; bytes: readonly number[] }[] = [{"read": 0, "written": 0, "bytes": []}, {"read": 0, "written": 0, "bytes": []}, {"read": 0, "written": 0, "bytes": []}];
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
const encoder: TextEncoder = new LiteralEncoder();
class TaggedBytes extends Uint8Array { label: string = "empty"; }
function write<V extends Uint8Array>(input: string, output: V): TextEncoderEncodeIntoResult { return encoder.encodeInto(input, output); }
const firstBuffer = Uint8Array.of(10, 20, 30, 40, 50).buffer, secondBuffer = Uint8Array.of(60, 70, 80, 90).buffer;
const first: Uint8Array<ArrayBuffer> = new Uint8Array(firstBuffer, 2, 0), second: TaggedBytes = new TaggedBytes(secondBuffer, 1, 0);
const results: TextEncoderEncodeIntoResult[] = [write<Uint8Array<ArrayBuffer>>("", first), write<TaggedBytes>("A\u20AC\uD83D\uDE00", second), write<Uint8Array<ArrayBuffer>>("\uD800", first)];
for (const result of results) { assert.sameValue(result.read, 0); assert.sameValue(result.written, 0); }
assert.compareArray(Array.from(first), []); assert.compareArray(Array.from(second), []);
assert.compareArray(Array.from(new Uint8Array(firstBuffer)), [10, 20, 30, 40, 50]);
assert.compareArray(Array.from(new Uint8Array(secondBuffer)), [60, 70, 80, 90]);
assert.sameValue(first.byteOffset, 2); assert.sameValue(second.byteOffset, 1); assert.sameValue(second.label, "empty");
assert.sameValue(first.buffer.byteLength, 5); assert.sameValue(second.buffer.byteLength, 4);
console.log("text-encoder-into-empty-view-generic:ok");
