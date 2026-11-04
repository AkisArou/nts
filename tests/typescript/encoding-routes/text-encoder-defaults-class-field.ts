/*---
description: "TextEncoder.encode reports utf-8 and allocates distinct exact-size arrays for omitted, empty and ASCII input."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-class, ts-class-fields, ts-this, ts-iteration, ts-instanceof]
---*/
// TextEncoder.encode reports utf-8 and allocates distinct exact-size arrays for omitted, empty and ASCII input. Route: a public encoder field used directly and through a method.
// Node prints: text-encoder-defaults-class-field:ok
class EncoderHolder {
  encoder: TextEncoder = new TextEncoder();
  run(input: string): Uint8Array<ArrayBuffer> { return this.encoder.encode(input); }
}
const holder: EncoderHolder = new EncoderHolder();
assert.sameValue(holder.encoder.encoding, "utf-8");
const omitted = holder.encoder.encode(), empty = holder.run(""), ascii = holder.run("A");
assert.compareArray(Array.from(omitted), []); assert.compareArray(Array.from(empty), []);
assert.compareArray(Array.from(ascii), [65]);
assert.sameValue(omitted === empty, false); assert.sameValue(omitted.buffer === empty.buffer, false);
assert.sameValue(empty === ascii, false); assert.sameValue(empty.buffer === ascii.buffer, false);
for (const bytes of [omitted, empty, ascii]) {
  assert.sameValue(bytes instanceof Uint8Array, true);
  assert.sameValue(bytes.byteOffset, 0); assert.sameValue(bytes.buffer.byteLength, bytes.length);
}
assert.sameValue(omitted.buffer.byteLength, 0); assert.sameValue(ascii.buffer.byteLength, 1);
console.log("text-encoder-defaults-class-field:ok");
