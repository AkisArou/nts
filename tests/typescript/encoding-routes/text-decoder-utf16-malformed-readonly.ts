/*---
description: "Lone UTF-16 surrogates and an odd final byte produce replacement units without losing following valid text."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-tuples, ts-readonly]
---*/
// TextDecoder through readonly byte-and-unit tuples; Lone UTF-16 surrogates and an odd final byte produce replacement units without losing following valid text.
// Node prints: text-decoder-utf16-malformed-readonly:ok
function units(text: string): number[] { const result: number[] = []; for (let i = 0; i < text.length; i++) result.push(text.charCodeAt(i)); return result; }

const decoder: TextDecoder = new TextDecoder("utf-16le");
const rows: readonly (readonly [Uint8Array, readonly number[]])[] = [
  [Uint8Array.of(0x0, 0xd8), [0xfffd]],
  [Uint8Array.of(0x0, 0xdc), [0xfffd]],
  [Uint8Array.of(0x41), [0xfffd]],
  [Uint8Array.of(0x0, 0xd8, 0x41, 0x0), [0xfffd, 0x41]],
  [Uint8Array.of(0x0, 0xdc, 0x0, 0xd8), [0xfffd, 0xfffd]],
];
for (const [input, expected] of rows) assert.compareArray(units(decoder.decode(input)), expected);
console.log("text-decoder-utf16-malformed-readonly:ok");
