/*---
description: "ASCII whitespace and case normalize UTF-8 labels; the utf-16 alias has canonical encoding utf-16le."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-tuples, ts-readonly]
---*/
// TextDecoder through readonly label-and-name tuples; ASCII whitespace and case normalize UTF-8 labels; the utf-16 alias has canonical encoding utf-16le.
// Node prints: text-decoder-labels-aliases-readonly:ok
const labels: readonly (readonly [string, string])[] = [
  ["UTF-8", "utf-8"], ["uTf8", "utf-8"], [" UTF8 ", "utf-8"], ["\tUTF-8\n", "utf-8"],
  ["\futf8\r", "utf-8"], ["unicode-1-1-utf-8", "utf-8"], ["utf-16", "utf-16le"], ["\tUtF-16lE ", "utf-16le"],
];
for (const [label, expected] of labels) {
  const decoder: TextDecoder = new TextDecoder(label);
  assert.sameValue(decoder.encoding, expected);
  const input = expected === "utf-16le" ? Uint8Array.of(0x41, 0) : Uint8Array.of(0x41);
  assert.sameValue(decoder.decode(input), "A");
}
console.log("text-decoder-labels-aliases-readonly:ok");
