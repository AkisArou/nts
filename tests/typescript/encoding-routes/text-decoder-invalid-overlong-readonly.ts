/*---
description: "Overlong sequences replace each invalid maximal part, including two replacements before an ASCII A."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-tuples, ts-readonly]
---*/
// TextDecoder through readonly input tuples; Overlong sequences replace each invalid maximal part, including two replacements before an ASCII A.
// Node prints: text-decoder-invalid-overlong-readonly:ok
function units(text: string): number[] { const result: number[] = []; for (let i = 0; i < text.length; i++) result.push(text.charCodeAt(i)); return result; }
const decoder: TextDecoder = new TextDecoder();
const rows: readonly (readonly [Uint8Array, readonly number[]])[] = [
  [Uint8Array.of(0xc0, 0x80), [0xfffd, 0xfffd]],
  [Uint8Array.of(0xe0, 0x80, 0x80), [0xfffd, 0xfffd, 0xfffd]],
  [Uint8Array.of(0xe0, 0x80, 0x41), [0xfffd, 0xfffd, 0x41]],
];
for (const [input, expected] of rows) assert.compareArray(units(decoder.decode(input)), expected);
console.log("text-decoder-invalid-overlong-readonly:ok");
