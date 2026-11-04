/*---
description: "A second BOM in one stream stays; finishing that stream makes the same decoder remove a new initial BOM."
features: [ts-encoding-routes, ts-encoding-route-text-decoder, ts-strings, ts-arrays, ts-numbers, ts-functions, ts-iteration, ts-class, ts-class-fields, ts-this, ts-objects, ts-static]
---*/
// TextDecoder through a static decoder field; A second BOM in one stream stays; finishing that stream makes the same decoder remove a new initial BOM.
// Node prints: text-decoder-bom-reset-static-field:ok
function units(text: string): number[] { const result: number[] = []; for (let i = 0; i < text.length; i++) result.push(text.charCodeAt(i)); return result; }

class Reader { static decoder: TextDecoder = new TextDecoder(); }
const bom = Uint8Array.of(0xef, 0xbb, 0xbf);
assert.sameValue(Reader.decoder.decode(bom, { stream: true }), "");
assert.compareArray(units(Reader.decoder.decode(bom, { stream: true })), [0xfeff]);
assert.sameValue(Reader.decoder.decode(), "");
assert.sameValue(Reader.decoder.decode(bom, { stream: true }), "");
assert.sameValue(Reader.decoder.decode(Uint8Array.of(0x41)), "A");
console.log("text-decoder-bom-reset-static-field:ok");
