/*---
description: "UTF-8 boundary bytes decode to exact UTF-16 units from NUL and DEL through U+10FFFF."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-tuples, ts-readonly]
---*/
// TextDecoder through readonly byte-and-unit tuples; UTF-8 boundary bytes decode to exact UTF-16 units from NUL and DEL through U+10FFFF.
// Node prints: text-decoder-utf8-length-edges-tuple:ok
function units(text: string): number[] { const result: number[] = []; for (let i = 0; i < text.length; i++) result.push(text.charCodeAt(i)); return result; }
const decoder: TextDecoder = new TextDecoder();
const rows: readonly (readonly [Uint8Array, readonly number[]])[] = [
  [Uint8Array.of(0x0), [0x0]],
  [Uint8Array.of(0x7f), [0x7f]],
  [Uint8Array.of(0xc2, 0x80), [0x80]],
  [Uint8Array.of(0xdf, 0xbf), [0x7ff]],
  [Uint8Array.of(0xe0, 0xa0, 0x80), [0x800]],
  [Uint8Array.of(0xef, 0xbf, 0xbf), [0xffff]],
  [Uint8Array.of(0xf0, 0x90, 0x80, 0x80), [0xd800, 0xdc00]],
  [Uint8Array.of(0xf4, 0x8f, 0xbf, 0xbf), [0xdbff, 0xdfff]],
];
for (const [input, expected] of rows) assert.compareArray(units(decoder.decode(input)), expected);
console.log("text-decoder-utf8-length-edges-tuple:ok");
