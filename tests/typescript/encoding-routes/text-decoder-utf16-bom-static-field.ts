/*---
description: "UTF-16LE removes FF FE only at the beginning; FE FF is U+FFFE and a second FF FE is U+FEFF."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this, ts-static]
---*/
// TextDecoder through a static decoder field; UTF-16LE removes FF FE only at the beginning; FE FF is U+FFFE and a second FF FE is U+FEFF.
// Node prints: text-decoder-utf16-bom-static-field:ok
function units(text: string): number[] { const result: number[] = []; for (let i = 0; i < text.length; i++) result.push(text.charCodeAt(i)); return result; }

class Reader { static decoder: TextDecoder = new TextDecoder("utf-16le"); }
assert.compareArray(units(Reader.decoder.decode(Uint8Array.of(0xff, 0xfe, 0x41, 0))), [0x41]);
assert.compareArray(units(Reader.decoder.decode(Uint8Array.of(0xfe, 0xff, 0x41, 0))), [0xfffe, 0x41]);
assert.compareArray(units(Reader.decoder.decode(Uint8Array.of(0xff, 0xfe, 0xff, 0xfe, 0x41, 0))), [0xfeff, 0x41]);
console.log("text-decoder-utf16-bom-static-field:ok");
