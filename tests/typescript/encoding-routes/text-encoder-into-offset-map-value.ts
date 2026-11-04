/*---
description: "TextEncoder.encodeInto starts at each view offset, stops at its capacity and preserves both surrounding sentinel regions."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-map-set, ts-tuples, ts-iteration, ts-narrowing, ts-null-undefined]
---*/
// TextEncoder.encodeInto starts at each view offset, stops at its capacity and preserves both surrounding sentinel regions. Route: destination views safely read from a typed Map.
// Node prints: text-encoder-into-offset-map-value:ok
const encoder: TextEncoder = new TextEncoder();
const shortParent = Uint8Array.of(91, 91, 91, 91, 91, 91, 91, 91, 91, 91);
const longParent = Uint8Array.of(92, 92, 92, 92, 92, 92, 92, 92, 92, 92, 92);
const outputs: Map<string, Uint8Array> = new Map<string, Uint8Array>();
outputs.set("short", shortParent.subarray(2, 6)); outputs.set("long", longParent.subarray(1, 9));
const rows: [string, string, number, number, number, number[]][] = [
  ["short", "A\u20AC\uD83D\uDE00", 2, 2, 4, [91, 91, 65, 226, 130, 172, 91, 91, 91, 91]],
  ["long", "\u20ACA\uD83D\uDE00", 1, 4, 8, [92, 226, 130, 172, 65, 240, 159, 152, 128, 92, 92]],
];
for (const [key, input, offset, read, written, expected] of rows) {
  const output = outputs.get(key);
  if (output === undefined) throw new Error("missing destination");
  const result = encoder.encodeInto(input, output);
  assert.sameValue(result.read, read); assert.sameValue(result.written, written);
  assert.sameValue(output.byteOffset, offset); assert.sameValue(output.byteLength, written);
  assert.compareArray(Array.from(new Uint8Array(output.buffer)), expected);
  assert.sameValue(output.buffer.byteLength, expected.length);
}
console.log("text-encoder-into-offset-map-value:ok");
