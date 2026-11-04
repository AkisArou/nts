/*---
description: "TextEncoder.encodeInto writes remain visible through overlapping aliases and preserve bytes beyond each shorter result."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-class, ts-class-fields, ts-this, ts-tuples, ts-iteration]
---*/
// TextEncoder.encodeInto writes remain visible through overlapping aliases and preserve bytes beyond each shorter result. Route: a public destination field with sibling views.
// Node prints: text-encoder-into-alias-class-field:ok
class Destination {
  view: Uint8Array;
  constructor(view: Uint8Array) { this.view = view; }
}
const encoder: TextEncoder = new TextEncoder(), backingBytes = Uint8Array.of(179, 179, 179, 179, 179, 179, 179, 179);
const destination: Destination = new Destination(backingBytes.subarray(2, 6)), alias = backingBytes.subarray(1, 7);
const rows: [string, number, number, number[], number[], number[]][] = [
  ["A", 1, 1, [65, 179, 179, 179], [179, 179, 65, 179, 179, 179, 179, 179], [179, 65, 179, 179, 179, 179]],
  ["\u00E9", 1, 2, [195, 169, 179, 179], [179, 179, 195, 169, 179, 179, 179, 179], [179, 195, 169, 179, 179, 179]],
  ["\uD83D\uDE00", 2, 4, [240, 159, 152, 128], [179, 179, 240, 159, 152, 128, 179, 179], [179, 240, 159, 152, 128, 179]],
  ["Z", 1, 1, [90, 159, 152, 128], [179, 179, 90, 159, 152, 128, 179, 179], [179, 90, 159, 152, 128, 179]],
];
for (const [input, read, written, expected, parentBytes, aliasBytes] of rows) {
  const result = encoder.encodeInto(input, destination.view);
  assert.sameValue(result.read, read); assert.sameValue(result.written, written);
  assert.compareArray(Array.from(destination.view), expected); assert.compareArray(Array.from(backingBytes), parentBytes); assert.compareArray(Array.from(alias), aliasBytes);
  assert.sameValue(destination.view.buffer, backingBytes.buffer); assert.sameValue(alias.buffer, backingBytes.buffer);
  assert.sameValue(destination.view.byteOffset, 2); assert.sameValue(destination.view.byteLength, 4); assert.sameValue(backingBytes.buffer.byteLength, 8);
}
console.log("text-encoder-into-alias-class-field:ok");
