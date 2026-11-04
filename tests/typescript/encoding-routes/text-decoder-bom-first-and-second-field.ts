/*---
description: "Only the first UTF-8 BOM is removed; a second BOM and a BOM after ordinary text remain as U+FEFF."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this]
---*/
// TextDecoder through a class decoder field; Only the first UTF-8 BOM is removed; a second BOM and a BOM after ordinary text remain as U+FEFF.
// Node prints: text-decoder-bom-first-and-second-field:ok
function units(text: string): number[] { const result: number[] = []; for (let i = 0; i < text.length; i++) result.push(text.charCodeAt(i)); return result; }

class Reader { decoder: TextDecoder = new TextDecoder(); }
const reader = new Reader();
assert.compareArray(units(reader.decoder.decode(Uint8Array.of(0xef, 0xbb, 0xbf, 0x41))), [0x41]);
assert.compareArray(units(reader.decoder.decode(Uint8Array.of(0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x41))), [0xfeff, 0x41]);
assert.compareArray(units(reader.decoder.decode(Uint8Array.of(0x41, 0xef, 0xbb, 0xbf))), [0x41, 0xfeff]);
console.log("text-decoder-bom-first-and-second-field:ok");
