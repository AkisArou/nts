/*---
description: "UTF-16LE reads low bytes first and preserves BMP and supplementary UTF-16 units."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-generics, ts-generic-constraints, ts-unions]
---*/
// TextDecoder through a constrained helper at Uint8Array and DataView; UTF-16LE reads low bytes first and preserves BMP and supplementary UTF-16 units.
// Node prints: text-decoder-utf16-values-generic:ok
function units(text: string): number[] { const result: number[] = []; for (let i = 0; i < text.length; i++) result.push(text.charCodeAt(i)); return result; }

const decoder: TextDecoder = new TextDecoder("utf-16le");
function decode<T extends Uint8Array | DataView>(input: T): string { return decoder.decode(input); }
const bmp = Uint8Array.of(0, 0, 0x41, 0, 0xe9, 0, 0xac, 0x20, 0xff, 0xff);
assert.compareArray(units(decode<Uint8Array>(bmp)), [0, 0x41, 0xe9, 0x20ac, 0xffff]);
const pairs = Uint8Array.of(0, 0xd8, 0, 0xdc, 0xff, 0xdb, 0xff, 0xdf);
assert.compareArray(units(decode<DataView>(new DataView(pairs.buffer))), [0xd800, 0xdc00, 0xdbff, 0xdfff]);
console.log("text-decoder-utf16-values-generic:ok");
