/*---
description: "TextEncoder.encodeInto stops before a whole character that cannot fit and counts UTF-16 input units separately from bytes."
features: [ts-encoding-routes, ts-encoding-route-text-encoder, ts-strings, ts-arrays, ts-numbers, ts-tuples, ts-iteration]
---*/
// TextEncoder.encodeInto stops before a whole character that cannot fit and counts UTF-16 input units separately from bytes. Route: typed tuples of mixed text and destination capacities.
// Node prints: text-encoder-into-mixed-capacities-tuple:ok
const encoder: TextEncoder = new TextEncoder();
const rows: [string, number, number, number, number[]][] = [
  ["A\u20AC\uD83D\uDE00", 3, 1, 1, [65, 99, 99]], ["A\u20AC\uD83D\uDE00", 4, 2, 4, [65, 226, 130, 172]],
  ["A\u20AC\uD83D\uDE00", 7, 2, 4, [65, 226, 130, 172, 99, 99, 99]], ["A\u20AC\uD83D\uDE00", 8, 4, 8, [65, 226, 130, 172, 240, 159, 152, 128]],
  ["\u20ACA\uD83D\uDE00", 3, 1, 3, [226, 130, 172]], ["\u20ACA\uD83D\uDE00", 7, 2, 4, [226, 130, 172, 65, 99, 99, 99]],
];
for (const [input, capacity, read, written, expected] of rows) {
  const output = new Uint8Array(capacity).fill(99), result = encoder.encodeInto(input, output);
  assert.sameValue(result.read, read); assert.sameValue(result.written, written);
  assert.compareArray(Array.from(output), expected);
  assert.sameValue(output.byteOffset, 0); assert.sameValue(output.buffer.byteLength, capacity);
}
console.log("text-encoder-into-mixed-capacities-tuple:ok");
